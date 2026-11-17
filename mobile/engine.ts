import { encodeResource, decodeResource } from './storage/compressed-resources.ts';
import type { CompressedResource } from '../src/paged-library.ts';
import { targetKey } from '../src/target.ts';
import { compareWords } from '../src/library-index.ts';
import type { Catalog, Entry } from '../src/types.ts';
import { backupFormat, validateBackup, type Backup } from '../src/backup.ts';
import { buildPractice, addPractice, savePracticeAnswer } from '../src/practice-builder.ts';
import { SnapshotStore, type JsonIO } from './storage/snapshot-store.ts';
import { SerialQueue } from '../src/serial-queue.ts';
import { yieldToUI } from '../src/serial-queue.ts';
import { libraryPolicy } from '../src/policy.ts';
import { planImportBatch } from '../src/import-batch.ts';
import { buildLibraryView } from './library-view.ts';
import {
  wordRow,
  questionRow,
  type WordRow,
  type QuestionRow,
  type BootProgress,
  type BundleIndex,
  type BundleAccess,
  type LibraryOverlay,
} from '../src/library-index.ts';
import { submitPractice } from '../src/practice-session.ts';
import { recordQuestionTest } from '../src/question-progress.ts';
import { recordWordTest } from '../src/word-progress.ts';
import { emptyCatalog, hash, kinds, latest, planImport } from '../src/catalog.ts';
import { emptyUserState, recordAttempt, saveNote, markMastered } from '../src/notebook.ts';
import { invariant, validateUserState, validatePack } from '../src/validation.ts';
import { scheduleReview, type Rating } from '../src/learning.ts';
import type {
  EntityByKind,
  ContentPack,
  ContentEntity,
  Word,
  Question,
  Passage,
  Target,
  Note,
  Attempt,
  UserState,
  Kind,
} from '../src/types.ts';

export type { JsonIO } from './storage/snapshot-store.ts';
export type {
  WordRow,
  QuestionRow,
  BootProgress,
  BundleIndex,
  BundleAccess,
} from '../src/library-index.ts';
export type { Backup } from '../src/backup.ts';

export function id(prefix: string) {
  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
/** Platform-independent mobile repository. All data commits use two checksummed slots. */
export class StudyEngine {
  catalog = emptyCatalog();
  words: WordRow[] = [];
  questions: QuestionRow[] = [];
  wordCount = 0;
  readyCount = 0;
  wordTags: string[] = [];
  private pinned = new Map<string, { exists: boolean; tags: string[] }>();
  private recent = new Map<string, { exists: boolean; tags: string[] }>();
  user = emptyUserState();
  get recovered() {
    return this.snapshots.recovered;
  }
  private base!: BundleIndex;
  private overlay: LibraryOverlay = { catalog: emptyCatalog(), words: [], questions: [] };
  private snapshots: SnapshotStore;
  private queue = new SerialQueue();
  private cache = new Map<string, ContentPack>();
  private senseOwners = new Map<string, { wordId: string; revision: number }>();
  private io: JsonIO;
  private bundled: BundleAccess;
  constructor(io: JsonIO, bundled: BundleAccess) {
    this.io = io;
    this.bundled = bundled;
    this.snapshots = new SnapshotStore(io);
  }

  async initialize(onProgress?: (progress: BootProgress) => void) {
    this.base = await this.bundled.index(onProgress);
    onProgress?.({ phase: 'Opening saved progress', completed: 0, total: 2 });
    await yieldToUI();
    this.overlay = await this.snapshots.read('content', this.overlay);
    onProgress?.({ phase: 'Opening saved progress', completed: 1, total: 2 });
    this.user = await this.snapshots.read('user', emptyUserState(), validateUserState);
    if (!this.user.profile)
      await this.updateUser((user) => ({
        ...user,
        profile: { id: id('learner'), name: 'My learning', createdAt: new Date().toISOString() },
      }));
    onProgress?.({ phase: 'Opening saved progress', completed: 2, total: 2 });
    await this.reindex(onProgress);
    onProgress?.({ phase: 'Ready', completed: 1, total: 1 });
  }
  async notices() {
    return this.bundled.lazy ? this.bundled.lazy.notices() : (this.base.notices ?? []);
  }
  private async reindex(onProgress?: (progress: BootProgress) => void) {
    const view = await buildLibraryView(
      this.base,
      this.overlay,
      { catalog: this.catalog, senseOwners: this.senseOwners },
      onProgress,
    );
    // Publish the complete derived view together after asynchronous preparation.
    this.catalog = view.catalog;
    this.words = view.words;
    this.questions = view.questions;
    this.senseOwners = view.senseOwners;
    this.wordCount = this.words.length;
    if (this.bundled.lazy) {
      this.wordCount = this.bundled.lazy.metadata.wordCount;
      for (const row of this.overlay.words)
        if (!(await this.bundled.lazy.versions('vocabulary', row.id))) this.wordCount++;
    }
    this.readyCount = this.words.filter((word) => word.ready.length).length;
    this.wordTags = [
      ...new Set([
        ...(this.bundled.lazy?.metadata.tags ?? []),
        ...this.words.flatMap((word) => word.tags),
      ]),
    ].sort();
    this.pinned = await this.pinnedTargets(this.user, true);
  }
  async pack(file: string): Promise<ContentPack> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const descriptorText = this.io.readBytes ? await this.io.read(`packs/${file}.meta.json`) : null;
    let pack: ContentPack | null;
    let local = false;
    if (descriptorText && this.io.readBytes) {
      local = true;
      const descriptor = JSON.parse(descriptorText) as CompressedResource;
      const read = async () => {
        const bytes = await this.io.readBytes!(`packs/${file}.gz`);
        invariant(bytes, 'The saved content block is missing.');
        return bytes;
      };
      pack = (
        this.bundled.lazy
          ? await this.bundled.lazy.external(`user-pack/${file}`, descriptor, read)
          : decodeResource(await read(), descriptor)
      ) as ContentPack;
    } else {
      const text = await this.io.read(`packs/${file}`);
      local = text !== null;
      pack = text ? (JSON.parse(text) as ContentPack) : await this.bundled.pack(file);
    }
    invariant(pack, 'This content is unavailable. Import its original package.');
    if (local) invariant(hash(pack) + '.json' === file, 'The saved content package is damaged.');
    if (this.bundled.lazy && (!local || descriptorText)) return pack;
    this.cache.set(file, pack);
    if (this.cache.size > libraryPolicy.cachedPacks)
      this.cache.delete(this.cache.keys().next().value!);
    return pack;
  }
  async entity<K extends Kind>(
    kind: K,
    entityId: string,
    revision?: number,
  ): Promise<EntityByKind[K] | null> {
    const versions = await this.versions(kind, entityId);
    const entry = revision ? versions?.[revision] : latest(versions);
    if (!entry) return null;
    const pack = await this.pack(entry.file);
    return (
      (((pack[kind] ?? []) as ContentEntity[]).find(
        (e) => e.id === entityId && e.revision === entry.revision,
      ) as EntityByKind[K]) ?? null
    );
  }
  async word(wordId: string, revision?: number) {
    const word = await this.entity('vocabulary', wordId, revision);
    if (word)
      for (const sense of word.senses) {
        const key = targetKey({ kind: 'sense', id: sense.id, revision: word.revision });
        this.recent.delete(key);
        this.recent.set(key, { exists: true, tags: word.tags });
        while (this.recent.size > 256) this.recent.delete(this.recent.keys().next().value!);
      }
    return word;
  }
  async question(qid: string, revision?: number) {
    return this.entity('questions', qid, revision);
  }
  async passage(pid: string, revision: number) {
    return this.entity('passages', pid, revision);
  }
  async sense(sid: string, revision?: number) {
    const owner = await this.owner(sid);
    if (!owner) return null;
    const word = await this.word(owner.wordId, revision ?? owner.revision);
    const sense = word?.senses.find((s) => s.id === sid);
    return word && sense ? { word, sense } : null;
  }
  targetExists(target: Target) {
    const known = this.pinned.get(targetKey(target)) ?? this.recent.get(targetKey(target));
    if (known) return known.exists;
    if (target.kind === 'question')
      return Boolean(this.catalog.entities.questions[target.id]?.[target.revision]);
    const owner = this.senseOwners.get(target.id);
    return Boolean(
      owner &&
        this.catalog.entities.vocabulary[owner.wordId]?.[target.revision]?.senseIds?.includes(
          target.id,
        ),
    );
  }
  private async versions(kind: Kind, id: string): Promise<Record<string, Entry> | undefined> {
    const local = this.catalog.entities[kind][id];
    if (local && !this.overlay.catalog.entities[kind][id]) return local;
    const remote = await this.bundled.lazy?.versions(kind, id);
    return remote ? { ...remote, ...local } : local;
  }
  private async owner(id: string) {
    const local = this.senseOwners.get(id);
    const remote = await this.bundled.lazy?.owner(id);
    return local && (!remote || local.revision >= remote.revision) ? local : remote;
  }
  private async targetInfo(target: Target) {
    if (target.kind === 'question')
      return {
        exists: Boolean((await this.versions('questions', target.id))?.[target.revision]),
        tags: this.questions.find((q) => q.id === target.id)?.tags ?? [],
      };
    const owner = await this.owner(target.id);
    if (!owner) return { exists: false, tags: [] };
    const entries = await this.versions('vocabulary', owner.wordId);
    const row =
      this.overlay.words.find((word) => word.id === owner.wordId) ??
      (await this.bundled.lazy?.row(owner.wordId)) ??
      this.words.find((word) => word.id === owner.wordId);
    return {
      exists: Boolean(entries?.[target.revision]?.senseIds?.includes(target.id)),
      tags: row?.tags ?? [],
    };
  }
  private async pinnedTargets(user: UserState, force = false) {
    const result = new Map<string, { exists: boolean; tags: string[] }>();
    const targets = [
      ...user.reviews.map((r) => r.target),
      ...user.mistakes.map((m) => m.target),
      ...user.notes.flatMap((n) => (n.target ? [n.target] : [])),
    ];
    for (const target of targets) {
      const key = targetKey(target);
      if (!result.has(key))
        result.set(key, (!force && this.pinned.get(key)) || (await this.targetInfo(target)));
    }
    return result;
  }
  targetTags(target: Target): string[] {
    return (
      this.pinned.get(targetKey(target))?.tags ??
      this.recent.get(targetKey(target))?.tags ??
      (target.kind === 'question'
        ? this.questions.find((q) => q.id === target.id)?.tags
        : this.words.find((w) => w.ready.includes(target.id))?.tags) ??
      []
    );
  }
  /** Query only candidate compressed pages; resident words are learning/imported summaries. */
  async findWords(
    query: string,
    tag = '',
    readyOnly = false,
    limit: number = libraryPolicy.searchLimit,
    signal?: AbortSignal,
  ) {
    if (!this.bundled.lazy) return this.searchWords(query, tag, readyOnly, limit);
    const remote = await this.bundled.lazy.search({
      query,
      tag,
      readyOnly,
      limit,
      signal,
      excludeIds: new Set(this.overlay.words.map((word) => word.id)),
    });
    const local = this.searchWords(query, tag, readyOnly, limit);
    const byId = new Map(remote.map((row) => [row.id, row]));
    for (const row of local) byId.set(row.id, row);
    const seen = new Set<string>();
    return [...byId.values()]
      .sort(compareWords)
      .filter((row) => {
        if (seen.has(row.headword)) return false;
        seen.add(row.headword);
        return true;
      })
      .slice(0, limit);
  }
  /** Load only revisions and references needed to validate an import, not the whole catalog. */
  private async importCatalog(inputs: unknown[]): Promise<Catalog> {
    const projected: Catalog = {
      ...this.catalog,
      entities: {
        sources: { ...this.catalog.entities.sources },
        vocabulary: { ...this.catalog.entities.vocabulary },
        passages: { ...this.catalog.entities.passages },
        questions: { ...this.catalog.entities.questions },
      },
    };
    if (!this.bundled.lazy) return projected;
    const wanted = new Map<Kind, Set<string>>(kinds.map((kind) => [kind, new Set<string>()]));
    const senses = new Set<string>();
    for (const input of inputs) {
      validatePack(input);
      for (const kind of kinds)
        for (const entity of (input[kind] ?? []) as ContentEntity[]) {
          wanted.get(kind)!.add(entity.id);
          if ('sourceIds' in entity)
            for (const id of entity.sourceIds) wanted.get('sources')!.add(id);
        }
      for (const word of input.vocabulary ?? [])
        for (const sense of word.senses) {
          senses.add(sense.id);
          for (const id of sense.sourceIds) wanted.get('sources')!.add(id);
        }
      for (const question of input.questions ?? []) {
        for (const id of question.senseIds) senses.add(id);
        if (question.passageId) wanted.get('passages')!.add(question.passageId);
      }
    }
    for (const id of senses) {
      const owner = await this.owner(id);
      if (owner) wanted.get('vocabulary')!.add(owner.wordId);
    }
    for (const [kind, ids] of wanted)
      for (const id of ids) {
        const entries = await this.versions(kind, id);
        if (entries) projected.entities[kind][id] = entries;
      }
    return projected;
  }
  async previewBatch(inputs: unknown[], onProgress?: (completed: number) => Promise<void>) {
    return planImportBatch(await this.importCatalog(inputs), inputs, onProgress);
  }
  searchWords(
    query: string,
    tag = '',
    readyOnly = false,
    limit: number = libraryPolicy.searchLimit,
  ) {
    // English search needs Unicode case folding, not a fresh locale service for
    // each of 131k entries. Locale casing is particularly expensive on Android.
    const needle = query.trim().toLowerCase();
    const result: WordRow[] = [];
    const seen = new Set<string>();
    for (const word of this.words) {
      if (
        (readyOnly && !word.ready.length) ||
        (tag && !word.tags.includes(tag)) ||
        (needle && !word.headword.toLowerCase().includes(needle))
      )
        continue;
      // A curated course entry wins over the same reference headword, except when filtering by source tag.
      if (seen.has(word.headword)) continue;
      seen.add(word.headword);
      result.push(word);
      if (result.length === limit) break;
    }
    return result;
  }
  async preview(pack: unknown) {
    return planImport(await this.importCatalog([pack]), pack).counts;
  }
  async import(pack: unknown) {
    return this.queue.run(() => this.importContent(pack));
  }
  private async importContent(pack: unknown) {
    const result = planImport(await this.importCatalog([pack]), pack);
    if (!result.changed) return { ...result.counts, duplicate: true };
    const overlay = structuredClone(this.overlay);
    overlay.catalog.packs[result.pack.packId] = result.catalog.packs[result.pack.packId];
    for (const kind of kinds)
      for (const entity of (result.pack[kind] ?? []) as ContentEntity[]) {
        overlay.catalog.entities[kind][entity.id] = result.catalog.entities[kind][entity.id];
      }
    const words = new Map(overlay.words.map((w) => [w.id, w]));
    for (const word of result.pack.vocabulary ?? [])
      if (latest(result.catalog.entities.vocabulary[word.id])?.hash === hash(word))
        words.set(word.id, wordRow(word));
    overlay.words = [...words.values()];
    const questions = new Map(overlay.questions.map((q) => [q.id, q]));
    for (const q of result.pack.questions ?? [])
      if (latest(result.catalog.entities.questions[q.id])?.hash === hash(q))
        questions.set(q.id, questionRow(q));
    overlay.questions = [...questions.values()];
    if (this.io.writeBytes) {
      const encoded = encodeResource(result.pack);
      await this.io.writeBytes(`packs/${result.digest}.json.gz`, encoded.bytes);
      await this.io.write(
        `packs/${result.digest}.json.meta.json`,
        JSON.stringify(encoded.descriptor),
      );
    } else await this.io.write(`packs/${result.digest}.json`, JSON.stringify(result.pack));
    await this.snapshots.commit('content', overlay);
    this.overlay = overlay;
    await this.reindex();
    return { ...result.counts, duplicate: false };
  }
  async updateUser(update: (user: UserState) => UserState) {
    return this.queue.run(() => this.commitUser(update));
  }
  private async commitUser(update: (user: UserState) => UserState) {
    const next = update(this.user);
    validateUserState(next);
    if (next === this.user) return;
    const pinned = await this.pinnedTargets(next);
    await this.snapshots.commit('user', next);
    this.user = next;
    this.pinned = pinned;
  }
  async attempt(attempt: Attempt, rating: Rating) {
    invariant(
      (await this.targetInfo(attempt.target)).exists,
      'The content for this answer is unavailable.',
    );
    return this.updateUser((user) => {
      if (user.attempts.some((a) => a.id === attempt.id)) return recordAttempt(user, attempt);
      return scheduleReview(
        recordAttempt(user, attempt),
        attempt.target,
        rating,
        new Date(attempt.createdAt),
      );
    });
  }
  async startPractice(count: number, questionIds: string[]) {
    return this.queue.run(async () => {
      invariant(
        !this.user.practiceSessions?.some((session) => !session.submittedAt),
        'Resume your unfinished practice first.',
      );
      const session = await buildPractice(this, {
        count,
        questionIds,
        id: id('practice'),
        createdAt: new Date().toISOString(),
      });
      await this.commitUser((user) => addPractice(user, session));
      return session.id;
    });
  }
  async savePracticeAnswer(sessionId: string, index: number, answer: unknown) {
    await this.updateUser((user) => savePracticeAnswer(user, sessionId, index, answer));
  }
  async submitPractice(sessionId: string) {
    await this.updateUser((user) => submitPractice(user, sessionId, new Date().toISOString()));
  }
  async questionTest(input: { id: string; target: Target; answer: unknown; createdAt: string }) {
    const question = await this.question(input.target.id, input.target.revision);
    invariant(input.target.kind === 'question' && question, 'This question is unavailable.');
    let result!: ReturnType<typeof recordQuestionTest>;
    await this.updateUser((user) => {
      result = recordQuestionTest(user, question!, input);
      return result.state;
    });
    return { score: result.score, maxScore: result.maxScore, outcome: result.outcome };
  }
  async wordTest(input: {
    id: string;
    target: Target;
    text: string;
    assisted: boolean;
    revealed?: boolean;
    createdAt: string;
  }) {
    const found = await this.sense(input.target.id, input.target.revision);
    invariant(input.target.kind === 'sense' && found, 'This meaning is unavailable.');
    return this.updateUser(
      (user) =>
        recordWordTest(user, {
          ...input,
          accepted: [found!.word.headword, ...found!.word.variants],
        }).state,
    );
  }
  async note(note: Note) {
    return this.updateUser((user) => saveNote(user, note));
  }
  async deleteNote(noteId: string) {
    return this.updateUser((user) => ({
      ...user,
      notes: user.notes.filter((n) => n.id !== noteId),
    }));
  }
  async mastery(target: Target, mastered: boolean) {
    return this.updateUser((user) =>
      markMastered(user, target, mastered, new Date().toISOString()),
    );
  }
  async backup(): Promise<Backup> {
    return this.queue.run(async () => {
      const packs: ContentPack[] = [];
      const bundledFiles = new Set(
        Object.values(this.base.catalog.packs).flatMap((p) => Object.values(p.versions)),
      );
      const files = new Set(
        Object.values(this.overlay.catalog.packs).flatMap((p) => Object.values(p.versions)),
      );
      for (const file of files)
        if (!bundledFiles.has(file)) packs.push(await this.pack(file + '.json'));
      return {
        format: backupFormat,
        version: 1 as const,
        createdAt: new Date().toISOString(),
        user: structuredClone(this.user),
        packs,
      };
    });
  }
  async restore(input: unknown) {
    validateBackup(input);
    const backup = structuredClone(input);
    return this.queue.run(async () => {
      const { packs } = await this.previewBatch(backup.packs);
      for (const pack of packs) await this.importContent(pack);
      // Content additions are safe if a later write fails; progress changes in one commit.
      await this.commitUser((user) => ({
        ...backup.user,
        profile: backup.user.profile ?? user.profile,
      }));
    });
  }
}
