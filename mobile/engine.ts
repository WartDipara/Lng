import { canonical, emptyCatalog, hash, kinds, latest, planImport } from '../src/catalog.ts';
import { emptyUserState, recordAttempt, saveNote, markMastered } from '../src/notebook.ts';
import { invariant, validatePack, validateUserState } from '../src/validation.ts';
import { scheduleReview, type Rating, targetKey } from '../src/learning.ts';
import type { Catalog, ContentPack, ContentEntity, Word, Question, Passage, Target, Note, Attempt, UserState, Kind } from '../src/types.ts';

export interface JsonIO { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> }
export interface WordRow { id: string; headword: string; tags: string[]; ready: string[] }
export interface QuestionRow { id: string; title: string; type: string; tags: string[] }
export interface BundleIndex { catalog: Catalog; words: WordRow[]; questions: QuestionRow[]; notices?: { title: string; text: string }[] }
export interface BundleAccess { index(): Promise<BundleIndex>; pack(file: string): Promise<ContentPack | null> }
interface Overlay { catalog: Catalog; words: WordRow[]; questions: QuestionRow[] }
interface Envelope<T> { sequence: number; checksum: string; data: T }
export interface Backup { format: 'engdictionary-backup'; version: 1; createdAt: string; user: UserState; packs: ContentPack[] }

export function id(prefix: string) { return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
const wordRow = (word: Word): WordRow => ({ id: word.id, headword: word.headword, tags: word.tags, ready: word.senses.filter(s => s.status === 'ready').map(s => s.id) });
const questionRow = (q: Question): QuestionRow => ({ id: q.id, title: q.title, type: q.type, tags: q.tags });
function overlayCatalog(base: Catalog, overlay: Catalog): Catalog {
  const result: Catalog = { schemaVersion: 1, packs: { ...base.packs, ...overlay.packs }, entities: { sources: {}, vocabulary: {}, passages: {}, questions: {} } };
  for (const kind of kinds) result.entities[kind] = { ...base.entities[kind], ...overlay.entities[kind] };
  return result;
}

/** Platform-independent mobile repository. All data commits use two checksummed slots. */
export class StudyEngine {
  catalog = emptyCatalog();
  words: WordRow[] = [];
  questions: QuestionRow[] = [];
  user = emptyUserState();
  recovered = false;
  private base!: BundleIndex;
  private overlay: Overlay = { catalog: emptyCatalog(), words: [], questions: [] };
  private sequences: Record<string, number> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, ContentPack>();
  private senseOwners = new Map<string, { wordId: string; revision: number }>();
  private io: JsonIO;
  private bundled: BundleAccess;
  constructor(io: JsonIO, bundled: BundleAccess) { this.io = io; this.bundled = bundled; }

  private async readSlots<T>(name: string, fallback: T, validate?: (value: unknown) => void): Promise<T> {
    const results: Envelope<T>[] = []; let present = 0;
    for (const slot of [0, 1]) {
      const text = await this.io.read(`${name}-${slot}.json`);
      if (text !== null) {
        present++;
        try {
          const item = JSON.parse(text) as Envelope<T>;
          invariant(Number.isSafeInteger(item.sequence) && item.sequence > 0 && hash(item.data) === item.checksum, 'Invalid snapshot');
          validate?.(item.data); results.push(item);
        } catch { this.recovered = true; }
      }
    }
    invariant(!present || results.length, `Both ${name} snapshots are damaged. Restore a backup; existing files were not overwritten.`);
    results.sort((a, b) => b.sequence - a.sequence);
    this.sequences[name] = results[0]?.sequence ?? 0;
    return results[0]?.data ?? fallback;
  }
  private async commit(name: string, data: unknown) {
    const sequence = (this.sequences[name] ?? 0) + 1;
    await this.io.write(`${name}-${sequence % 2}.json`, JSON.stringify({ sequence, checksum: hash(data), data }));
    this.sequences[name] = sequence;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action); this.queue = task.catch(() => {}); return task;
  }
  async initialize() {
    this.base = await this.bundled.index();
    this.overlay = await this.readSlots('content', this.overlay);
    this.user = await this.readSlots('user', emptyUserState(), validateUserState);
    this.reindex();
  }
  notices() { return this.base.notices ?? []; }
  private reindex() {
    this.catalog = overlayCatalog(this.base.catalog, this.overlay.catalog);
    const wordMap = new Map(this.base.words.map(w => [w.id, w]));
    for (const word of this.overlay.words) wordMap.set(word.id, word);
    this.words = [...wordMap.values()].sort((a, b) => Number(b.ready.length > 0) - Number(a.ready.length > 0) || a.headword.localeCompare(b.headword));
    const questionMap = new Map(this.base.questions.map(q => [q.id, q]));
    for (const q of this.overlay.questions) questionMap.set(q.id, q);
    this.questions = [...questionMap.values()];
    this.senseOwners.clear();
    for (const [wordId, revisions] of Object.entries(this.catalog.entities.vocabulary)) {
      for (const version of Object.values(revisions)) for (const senseId of version.senseIds ?? []) {
        const old = this.senseOwners.get(senseId);
        if (!old || version.revision > old.revision) this.senseOwners.set(senseId, { wordId, revision: version.revision });
      }
    }
  }
  async pack(file: string): Promise<ContentPack> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const text = await this.io.read(`packs/${file}`);
    const pack = text ? JSON.parse(text) as ContentPack : await this.bundled.pack(file);
    invariant(pack, 'This content is unavailable. Import its original package.');
    if (text) invariant(hash(pack) + '.json' === file, 'The saved content package is damaged.');
    this.cache.set(file, pack);
    if (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    return pack;
  }
  async entity<T extends ContentEntity>(kind: Kind, entityId: string, revision?: number): Promise<T | null> {
    const versions = this.catalog.entities[kind][entityId];
    const entry = revision ? versions?.[revision] : latest(versions);
    if (!entry) return null;
    const pack = await this.pack(entry.file);
    return ((pack[kind] ?? []) as ContentEntity[]).find(e => e.id === entityId && e.revision === entry.revision) as T ?? null;
  }
  async word(wordId: string, revision?: number) { return this.entity<Word>('vocabulary', wordId, revision); }
  async question(qid: string, revision?: number) { return this.entity<Question>('questions', qid, revision); }
  async passage(pid: string, revision: number) { return this.entity<Passage>('passages', pid, revision); }
  async sense(sid: string, revision?: number) {
    const owner = this.senseOwners.get(sid);
    if (!owner) return null;
    const word = await this.word(owner.wordId, revision ?? owner.revision);
    const sense = word?.senses.find(s => s.id === sid);
    return word && sense ? { word, sense } : null;
  }
  targetExists(target: Target) {
    if (target.kind === 'question') return Boolean(this.catalog.entities.questions[target.id]?.[target.revision]);
    const owner = this.senseOwners.get(target.id);
    return Boolean(owner && this.catalog.entities.vocabulary[owner.wordId]?.[target.revision]?.senseIds?.includes(target.id));
  }
  searchWords(query: string, tag = '', readyOnly = false, limit = 100) {
    const needle = query.trim().toLocaleLowerCase('en');
    const result: WordRow[] = []; const seen = new Set<string>();
    for (const word of this.words) {
      if (readyOnly && !word.ready.length || tag && !word.tags.includes(tag) || needle && !word.headword.toLocaleLowerCase('en').includes(needle)) continue;
      // A curated course entry wins over the same reference headword, except when filtering by source tag.
      if (seen.has(word.headword)) continue;
      seen.add(word.headword); result.push(word);
      if (result.length === limit) break;
    }
    return result;
  }
  preview(pack: unknown) { return planImport(this.catalog, pack).counts; }
  async import(pack: unknown) {
    return this.serialize(async () => {
      const result = planImport(this.catalog, pack);
      if (!result.changed) return { ...result.counts, duplicate: true };
      const overlay = structuredClone(this.overlay);
      overlay.catalog.packs[result.pack.packId] = result.catalog.packs[result.pack.packId];
      for (const kind of kinds) for (const entity of (result.pack[kind] ?? []) as ContentEntity[]) {
        overlay.catalog.entities[kind][entity.id] = result.catalog.entities[kind][entity.id];
      }
      const words = new Map(overlay.words.map(w => [w.id, w]));
      for (const word of result.pack.vocabulary ?? []) if (latest(result.catalog.entities.vocabulary[word.id])?.hash === hash(word)) words.set(word.id, wordRow(word));
      overlay.words = [...words.values()];
      const questions = new Map(overlay.questions.map(q => [q.id, q]));
      for (const q of result.pack.questions ?? []) if (latest(result.catalog.entities.questions[q.id])?.hash === hash(q)) questions.set(q.id, questionRow(q));
      overlay.questions = [...questions.values()];
      await this.io.write(`packs/${result.digest}.json`, JSON.stringify(result.pack));
      await this.commit('content', overlay);
      this.overlay = overlay; this.reindex();
      return { ...result.counts, duplicate: false };
    });
  }
  async updateUser(update: (user: UserState) => UserState) {
    return this.serialize(async () => {
      const next = update(this.user); validateUserState(next);
      await this.commit('user', next); this.user = next;
    });
  }
  async attempt(attempt: Attempt, rating: Rating) {
    invariant(this.targetExists(attempt.target), 'The content for this answer is unavailable.');
    return this.updateUser(user => {
      if (user.attempts.some(a => a.id === attempt.id)) return recordAttempt(user, attempt);
      return scheduleReview(recordAttempt(user, attempt), attempt.target, rating, new Date(attempt.createdAt));
    });
  }
  async note(note: Note) { return this.updateUser(user => saveNote(user, note)); }
  async deleteNote(noteId: string) { return this.updateUser(user => ({ ...user, notes: user.notes.filter(n => n.id !== noteId) })); }
  async mastery(target: Target, mastered: boolean) { return this.updateUser(user => markMastered(user, target, mastered, new Date().toISOString())); }
  async backup(): Promise<Backup> {
    await this.queue;
    const packs: ContentPack[] = [];
    const bundledFiles = new Set(Object.values(this.base.catalog.packs).flatMap(p => Object.values(p.versions)));
    const files = new Set(Object.values(this.overlay.catalog.packs).flatMap(p => Object.values(p.versions)));
    for (const file of files) if (!bundledFiles.has(file)) packs.push(await this.pack(file + '.json'));
    return { format: 'engdictionary-backup', version: 1, createdAt: new Date().toISOString(), user: structuredClone(this.user), packs };
  }
  async restore(input: unknown) {
    const backup = input as Backup;
    invariant(backup?.format === 'engdictionary-backup' && backup.version === 1 && Array.isArray(backup.packs), 'This is not an EngDictionary backup.');
    validateUserState(backup.user);
    // Version histories can interleave across packages. Restore dependencies and
    // earlier revisions first rather than relying on the grouping order in a backup.
    let simulated = this.catalog;
    const remaining = [...backup.packs]; const ordered: ContentPack[] = [];
    for (const pack of remaining) validatePack(pack);
    while (remaining.length) {
      const position = remaining.findIndex(pack =>
        pack.requires.every(r => (simulated.packs[r.packId]?.version ?? 0) >= r.minVersion)
        && !remaining.some(p => p.packId === pack.packId && p.packVersion < pack.packVersion));
      invariant(position >= 0, 'This backup is missing an earlier required content package.');
      const pack = remaining.splice(position, 1)[0];
      simulated = planImport(simulated, pack).catalog; ordered.push(pack);
    }
    for (const pack of ordered) await this.import(pack);
    // Content additions are safe if a later disk write fails; user state is replaced in one commit.
    await this.updateUser(() => structuredClone(backup.user));
  }
}
