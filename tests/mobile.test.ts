import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import { StudyEngine } from '../mobile/engine.ts';
import type { BundleAccess, BundleIndex, JsonIO } from '../mobile/engine.ts';
import { emptyCatalog, planImport } from '../src/catalog.ts';
import { emptyUserState } from '../src/notebook.ts';
import { dueReviews, newSensesToday, scheduleReview, studiedToday } from '../src/learning.ts';
import type { Attempt, ContentPack, Note, Target, UserState } from '../src/types.ts';

const NOW = '2026-11-15T10:00:00Z';
const questionTarget: Target = { kind: 'question', id: 'example:comprehension', revision: 1 };
const senseTarget: Target = { kind: 'sense', id: 'example:contingent-dependent', revision: 1 };

class MemoryIO implements JsonIO {
  files = new Map<string, string>();
  failNextWrite = false;
  writes: string[] = [];
  async read(path: string) { return this.files.get(path) ?? null; }
  async write(path: string, text: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('Simulated disk full'); }
    this.writes.push(path); this.files.set(path, text);
  }
}

function basePack(): ContentPack { return structuredClone(fixture) as ContentPack; }
function bundle(pack = basePack()): BundleAccess {
  const imported = planImport(emptyCatalog(), pack);
  const index: BundleIndex = {
    catalog: imported.catalog,
    words: (pack.vocabulary ?? []).map(word => ({ id: word.id, headword: word.headword, tags: word.tags, ready: word.senses.filter(s => s.status === 'ready').map(s => s.id) })),
    questions: (pack.questions ?? []).map(q => ({ id: q.id, title: q.title, type: q.type, tags: q.tags })),
  };
  return {
    index: async () => structuredClone(index),
    pack: async file => file === imported.digest + '.json' ? structuredClone(pack) : null,
  };
}
async function engine(io = new MemoryIO(), bundled = bundle()) {
  const value = new StudyEngine(io, bundled); await value.initialize(); return { value, io, bundled };
}
function note(id = 'note:first', target: Target | null = questionTarget): Note {
  return { id, title: 'Conditions', body: 'A condition must be met first.', tags: ['grammar'], ...(target ? { target } : {}), createdAt: NOW, updatedAt: NOW };
}
function attempt(id = 'attempt:first', target = questionTarget, correct = false): Attempt {
  return { id, target, kind: target.kind === 'sense' ? 'spelling' : 'question', answer: target.kind === 'sense' ? 'contigent' : ['option:1'], score: correct ? 1 : 0, maxScore: 1, createdAt: NOW };
}
function questionRevision(revision = 2): ContentPack {
  const q = structuredClone(basePack().questions![0]);
  q.revision = revision; q.explanation += ` Revision ${revision}: check the stated condition.`;
  return { schemaVersion: 1, packId: `updates:q${revision}`, packVersion: 1, createdAt: NOW, requires: [{ packId: 'example:base', minVersion: 1 }], sources: [], questions: [q] };
}

test('backup omits bundled alias bytes when an update advances the same package ID', async () => {
  const original = bundle();
  // A sharded distribution registers its master identity without shipping its monolithic file.
  const sharded: BundleAccess = { index: original.index, pack: async () => null };
  const { value } = await engine(new MemoryIO(), sharded);
  const update = questionRevision();
  update.packId = 'example:base'; update.packVersion = 2; update.requires = [];
  await value.import(update);
  const backup = await value.backup();
  assert.deepEqual(backup.packs.map(p => p.packVersion), [2]);
  const restored = await engine(new MemoryIO(), sharded);
  await restored.value.restore(backup);
  assert.equal((await restored.value.question(update.questions![0].id))?.revision, 2);
});

test('mobile initializes bundled content offline and persists notes across a fresh engine', async () => {
  const { value, io, bundled } = await engine();
  assert.equal(value.words.length, 1);
  assert.equal(value.questions.length, 22);
  assert.equal((await value.word('example:contingent'))?.headword, 'contingent');
  assert.deepEqual(value.user, emptyUserState());
  await value.note(note());
  const restarted = await engine(io, bundled);
  assert.deepEqual(restarted.value.user.notes, [note()]);
  assert.equal(restarted.value.recovered, false);
});

test('mobile wrong answers and notes stay pinned to old revisions after import and restart', async () => {
  const { value, io, bundled } = await engine();
  await value.attempt(attempt(), 'Again');
  await value.note(note());
  const beforeUser = structuredClone(value.user);
  const result = await value.import(questionRevision());
  assert.equal(result.updated, 1);
  assert.deepEqual(value.user, beforeUser);
  const restarted = (await engine(io, bundled)).value;
  assert.equal((await restarted.question(questionTarget.id))?.revision, 2);
  assert.equal((await restarted.question(questionTarget.id, 1))?.revision, 1);
  assert.equal((await restarted.question(questionTarget.id, 1))?.explanation, basePack().questions![0].explanation);
  assert.deepEqual(restarted.user.mistakes[0].target, questionTarget);
  assert.deepEqual(restarted.user.notes[0].target, questionTarget);
  assert.deepEqual(restarted.user.attempts[0].target, questionTarget);
  assert.equal(restarted.targetExists(questionTarget), true);
  assert.equal(restarted.targetExists({ ...questionTarget, revision: 2 }), true);
  assert.equal(restarted.targetExists({ ...questionTarget, revision: 3 }), false);
});

test('mobile recovers the previous user slot if the newest slot is truncated', async () => {
  const { value, io, bundled } = await engine();
  await value.note(note('note:first')); // sequence 1, slot 1
  await value.note(note('note:second')); // sequence 2, slot 0
  io.files.set('user-0.json', '{"sequence":2,"checksum":');
  const restarted = (await engine(io, bundled)).value;
  assert.equal(restarted.recovered, true);
  assert.deepEqual(restarted.user.notes.map(n => n.id), ['note:first']);
  await restarted.note(note('note:recovered'));
  const healthy = (await engine(io, bundled)).value;
  assert.equal(healthy.recovered, false);
  assert.deepEqual(healthy.user.notes.map(n => n.id), ['note:first', 'note:recovered']);
});

test('mobile refuses to silently reset user data when both slots are corrupt', async () => {
  const { value, io, bundled } = await engine();
  await value.note(note());
  io.files.set('user-0.json', 'bad'); io.files.set('user-1.json', 'also bad');
  const writes = io.writes.length;
  await assert.rejects(engine(io, bundled), /Both user snapshots are damaged/);
  assert.equal(io.writes.length, writes);
});

test('mobile user-write failure leaves in-memory and persisted state unchanged', async () => {
  const { value, io, bundled } = await engine();
  await value.note(note());
  const before = structuredClone(value.user);
  io.failNextWrite = true;
  await assert.rejects(value.attempt(attempt(), 'Again'), /disk full/);
  assert.deepEqual(value.user, before);
  assert.deepEqual((await engine(io, bundled)).value.user, before);
  // The serialized write queue remains usable after a failed transaction.
  await value.attempt(attempt(), 'Again');
  assert.equal(value.user.attempts.length, 1);
});

test('mobile duplicate attempt IDs do not reschedule a review or multiply mistakes', async () => {
  const { value } = await engine();
  const first = attempt();
  await value.attempt(first, 'Again');
  const before = structuredClone(value.user);
  await value.attempt(first, 'Easy');
  assert.deepEqual(value.user, before);
  await assert.rejects(value.attempt({ ...first, score: 1 }, 'Good'), /conflict/);
  assert.deepEqual(value.user, before);
});

test('mobile backup restores imported packages, notebook, mistakes and scheduling', async () => {
  const original = (await engine()).value;
  await original.import(questionRevision());
  await original.note(note());
  await original.note(note('note:standalone', null));
  await original.attempt(attempt(), 'Again');
  const backup = await original.backup();
  assert.equal(backup.packs.length, 1);
  assert.equal(backup.packs[0].packId, 'updates:q2');
  const { value: restored, io, bundled } = await engine();
  await restored.restore(backup);
  assert.deepEqual(restored.user, original.user);
  assert.equal((await restored.question(questionTarget.id))?.revision, 2);
  assert.equal((await restored.question(questionTarget.id, 1))?.revision, 1);
  const restarted = (await engine(io, bundled)).value;
  assert.deepEqual(restarted.user, original.user);
  assert.equal((await restarted.question(questionTarget.id))?.revision, 2);
  assert.equal((await restarted.import(questionRevision())).duplicate, true);
});

test('mobile validates a backup before committing imported content or replacing notes', async () => {
  const { value, io } = await engine();
  await value.note(note());
  const savedUser = structuredClone(value.user);
  const savedCatalog = structuredClone(value.catalog);
  const malformed = await value.backup();
  malformed.packs = [questionRevision()];
  malformed.packs[0].questions![0].passageId = 'missing:passage';
  const writes = io.writes.length;
  await assert.rejects(value.restore(malformed), /missing passage/);
  assert.deepEqual(value.user, savedUser);
  assert.deepEqual(value.catalog, savedCatalog);
  assert.equal(io.writes.length, writes);
});

test('mobile content slot recovery keeps the last complete question revision', async () => {
  const { value, io, bundled } = await engine();
  await value.import(questionRevision(2));
  await value.import(questionRevision(3));
  io.files.set('content-0.json', '{"sequence":2');
  const restarted = (await engine(io, bundled)).value;
  assert.equal(restarted.recovered, true);
  assert.equal((await restarted.question(questionTarget.id))?.revision, 2);
  assert.equal((await restarted.question(questionTarget.id, 1))?.revision, 1);
  assert.equal(restarted.targetExists({ ...questionTarget, revision: 3 }), false);
});

test('mobile backup restores interleaved package-version dependencies', async () => {
  const original = (await engine()).value;
  const first = questionRevision(2); first.packId = 'updates:series';
  await original.import(first);
  const dependent = questionRevision(2);
  dependent.packId = 'updates:dependent';
  dependent.questions![0].id = 'updates:extra-question';
  dependent.requires = [{ packId: first.packId, minVersion: 1 }];
  await original.import(dependent);
  const nextVersion = questionRevision(3);
  nextVersion.packId = first.packId; nextVersion.packVersion = 2;
  nextVersion.requires = [{ packId: dependent.packId, minVersion: 1 }];
  await original.import(nextVersion);
  const backup = await original.backup();
  const restored = (await engine()).value;
  await restored.restore(backup);
  assert.equal((await restored.question(questionTarget.id))?.revision, 3);
  assert.equal((await restored.question('updates:extra-question'))?.revision, 2);
});

test('mobile target checks distinguish target kind, unknown revisions and historical senses', async () => {
  const { value } = await engine();
  assert.equal(value.targetExists(senseTarget), true);
  assert.equal(value.targetExists({ ...senseTarget, revision: 9 }), false);
  assert.equal(value.targetExists({ ...questionTarget, kind: 'sense' }), false);
  assert.equal(value.targetExists({ ...senseTarget, kind: 'question' }), false);
  const word = structuredClone(basePack().vocabulary![0]); word.revision = 2;
  word.senses = [{ ...word.senses[0], id: 'example:replacement-sense' }];
  await value.import({ schemaVersion: 1, packId: 'updates:word2', packVersion: 1, createdAt: NOW,
    requires: [{ packId: 'example:base', minVersion: 1 }], sources: [], vocabulary: [word] });
  assert.equal(value.targetExists(senseTarget), true);
  assert.equal(value.targetExists({ ...senseTarget, revision: 2 }), false);
  assert.equal((await value.sense(senseTarget.id, 1))?.word.revision, 1);
  assert.equal(await value.sense(senseTarget.id, 2), null);
  await assert.rejects(value.attempt(attempt('attempt:unknown', { ...questionTarget, revision: 9 }), 'Good'), /unavailable/);
});

test('reference vocabulary remains searchable but is excluded from ready-only learning', async () => {
  const pack = basePack();
  const reference = structuredClone(pack.vocabulary![0]);
  reference.id = 'reference:abstruse'; reference.headword = 'abstruse'; reference.status = 'reference'; reference.tags = ['GRE'];
  reference.senses[0].id = 'reference:abstruse-sense'; reference.senses[0].status = 'reference'; reference.senses[0].simpleDefinition = null;
  reference.senses[0].definition = 'Difficult to understand.';
  pack.vocabulary!.push(reference);
  const { value } = await engine(new MemoryIO(), bundle(pack));
  assert.equal(value.searchWords('ABSTRUSE').length, 1);
  assert.equal(value.searchWords('abstruse', '', true).length, 0);
  assert.equal(value.searchWords('', 'GRE').length, 1);
  assert.equal(value.searchWords('', '', true).length, 1);
  assert.equal((await value.sense('reference:abstruse-sense'))?.sense.status, 'reference');
});

test('SM-2 Again schedules ten minutes and Good schedules one then six days', () => {
  const now = new Date(NOW);
  let state = scheduleReview(emptyUserState(), senseTarget, 'Again', now);
  assert.equal(Date.parse(state.reviews[0].dueAt) - now.getTime(), 600000);
  assert.equal(state.reviews[0].repetitions, 0);
  state = scheduleReview(state, senseTarget, 'Good', now);
  assert.equal(state.reviews[0].intervalDays, 1);
  assert.equal(state.reviews[0].repetitions, 1);
  state = scheduleReview(state, senseTarget, 'Good', now);
  assert.equal(state.reviews[0].intervalDays, 6);
  assert.equal(state.reviews[0].repetitions, 2);
  assert.equal(dueReviews(state, now).length, 0);
  assert.equal(dueReviews(state, new Date(state.reviews[0].dueAt)).length, 1);
});

test('SM-2 Hard and Easy remain distinct and Again resets mature repetitions', () => {
  const now = new Date(NOW);
  const hard = scheduleReview(emptyUserState(), senseTarget, 'Hard', now);
  const easy = scheduleReview(emptyUserState(), senseTarget, 'Easy', now);
  assert.equal(hard.reviews[0].intervalDays, 1);
  assert.equal(easy.reviews[0].intervalDays, 4);
  assert.ok(hard.reviews[0].ease < easy.reviews[0].ease);
  const mature = scheduleReview(scheduleReview(emptyUserState(), senseTarget, 'Good', now), senseTarget, 'Good', now);
  assert.ok(scheduleReview(mature, senseTarget, 'Easy', now).reviews[0].intervalDays > scheduleReview(mature, senseTarget, 'Hard', now).reviews[0].intervalDays);
  let forgotten = scheduleReview(mature, senseTarget, 'Again', now);
  for (let i = 0; i < 10; i++) forgotten = scheduleReview(forgotten, senseTarget, 'Again', now);
  assert.equal(forgotten.reviews[0].repetitions, 0);
  assert.equal(forgotten.reviews[0].ease, 1.3);
  assert.equal(forgotten.reviews[0].intervalDays, 10 / 1440);
});

test('daily word counts distinguish new senses from repeated reviews and questions', () => {
  // Local-day helpers are checked with a local Date so the host time zone cannot change the expectation.
  const today = new Date(2026, 10, 15, 12);
  const yesterday = new Date(2026, 10, 14, 12);
  const state: UserState = emptyUserState();
  state.attempts = [
    { ...attempt('attempt:old', senseTarget), createdAt: yesterday.toISOString() },
    { ...attempt('attempt:review', senseTarget), createdAt: today.toISOString() },
    { ...attempt('attempt:new', { ...senseTarget, id: 'sense:new' }), createdAt: today.toISOString() },
    { ...attempt('attempt:repeat', { ...senseTarget, id: 'sense:new' }), createdAt: today.toISOString() },
    { ...attempt('attempt:question'), createdAt: today.toISOString() },
  ];
  assert.equal(studiedToday(state, today), 2);
  assert.equal(newSensesToday(state, today), 1);
});

test('build-sorted bundled words and catalog are reused on cold start without copying', async () => {
  const bundled = bundle();
  const index = await bundled.index();
  index.wordsSorted = true;
  const value = new StudyEngine(new MemoryIO(), { index: async () => index, pack: bundled.pack });
  const progress: { phase: string; completed: number; total: number }[] = [];
  await value.initialize(item => progress.push(item));
  assert.equal(value.words, index.words);
  assert.equal(value.catalog, index.catalog);
  assert.equal(progress.at(-1)?.phase, 'Ready');
  assert.ok(progress.some(item => item.phase === 'Preparing meanings' && item.completed === index.words.length));
});

test('sorted index imports merge replacements and additions while keeping ready words first', async () => {
  const pack = basePack();
  const reference = (name: string) => {
    const word = structuredClone(pack.vocabulary![0]);
    word.id = `reference:${name}`; word.headword = name; word.status = 'reference';
    word.senses[0].id = `reference:${name}-sense`; word.senses[0].status = 'reference'; word.senses[0].simpleDefinition = null;
    return word;
  };
  const alpha = reference('alpha'); const zulu = reference('zulu');
  pack.vocabulary!.push(alpha, zulu);
  const bundled = bundle(pack); const index = await bundled.index(); index.wordsSorted = true;
  const value = (await engine(new MemoryIO(), { index: async () => index, pack: bundled.pack })).value;
  const beta = structuredClone(zulu); beta.revision = 2; beta.headword = 'beta';
  const extra = reference('aardvark');
  await value.import({ schemaVersion: 1, packId: 'updates:sorted-words', packVersion: 1, createdAt: NOW,
    requires: [{ packId: 'example:base', minVersion: 1 }], sources: [], vocabulary: [beta, extra] });
  assert.deepEqual(value.words.map(word => word.headword), ['contingent', 'aardvark', 'alpha', 'beta']);
  assert.equal(value.words.filter(word => word.id === zulu.id).length, 1);
  assert.equal((await value.word(zulu.id))?.headword, 'beta');
  assert.equal((await value.word(zulu.id, 1))?.headword, 'zulu');
});

test('large meaning indexes yield between batches and report actual completed counts', async () => {
  const bundled = bundle(); const index = await bundled.index(); index.wordsSorted = true;
  const template = Object.values(index.catalog.entities.vocabulary)[0];
  for (let number = 0; number < 4100; number++) {
    const wordId = `synthetic:word-${number}`;
    index.words.push({ id: wordId, headword: `word${String(number).padStart(4, '0')}`, tags: [], ready: [] });
    const revisions = structuredClone(template); revisions[1].senseIds = [`synthetic:sense-${number}`];
    index.catalog.entities.vocabulary[wordId] = revisions;
  }
  let timerRan = false;
  const progress: number[] = [];
  const value = new StudyEngine(new MemoryIO(), { index: async () => index, pack: bundled.pack });
  await value.initialize(item => {
    if (item.phase === 'Preparing meanings') {
      progress.push(item.completed);
      if (item.completed === 2000) setTimeout(() => { timerRan = true; }, 0);
      if (item.completed === 4000) assert.equal(timerRan, true);
    }
  });
  assert.deepEqual(progress, [2000, 4000, 4101]);
  assert.equal(value.targetExists({ kind: 'sense', id: 'synthetic:sense-4099', revision: 1 }), true);
});
