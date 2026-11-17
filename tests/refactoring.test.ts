import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import type { ContentPack, UserState } from '../src/types.ts';
import { emptyCatalog, planImport } from '../src/catalog.ts';
import { planImportBatch } from '../src/import-batch.ts';
import { emptyUserState } from '../src/notebook.ts';
import { readUserState, updateUserState } from '../src/store.ts';
import { initialNavigation, navigate } from '../mobile/navigation.ts';
import { buildPractice, addPractice, savePracticeAnswer } from '../src/practice-builder.ts';
import { newStudyTargets, dueStudyTargets } from '../mobile/study-selection.ts';
import { wordRow, questionRow } from '../src/library-index.ts';
import { textCorrect } from '../src/answers.ts';
import { grade } from '../src/grading.ts';
import { SerialQueue } from '../src/serial-queue.ts';

const now = '2026-11-17T10:00:00.000Z';
const base = (): ContentPack => structuredClone(fixture) as ContentPack;

test('Node generations retain profiles, practice drafts and submitted results across restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-state-'));
  try {
    const pack = base();
    const session = await buildPractice(
      {
        question: async (id) => pack.questions!.find((question) => question.id === id) ?? null,
        passage: async (id) => pack.passages!.find((passage) => passage.id === id) ?? null,
      },
      { id: 'practice:roundtrip', createdAt: now, count: 1, questionIds: [pack.questions![0].id] },
    );
    const state: UserState = {
      ...addPractice(emptyUserState(), session),
      profile: { id: 'learner:roundtrip', createdAt: now, name: 'Learner' },
    };
    await updateUserState(root, () => state);
    assert.deepEqual(await readUserState(root), state);
    const { submitPractice } = await import('../src/practice-session.ts');
    const submitted = submitPractice(
      savePracticeAnswer(state, session.id, 0, ['option:1']),
      session.id,
      now,
    );
    await updateUserState(root, () => submitted);
    assert.deepEqual(await readUserState(root), submitted);
    // The original format without optional fields remains readable as well.
    await updateUserState(root, () => emptyUserState());
    assert.deepEqual(await readUserState(root), emptyUserState());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('batch imports order same-package versions even when files are selected in reverse', async () => {
  const first = base();
  const second = base();
  second.packVersion = 2;
  second.questions![0].revision = 2;
  second.questions![0].explanation = 'Updated explanation.';
  const result = await planImportBatch(emptyCatalog(), [second, first]);
  assert.deepEqual(
    result.packs.map((pack) => pack.packVersion),
    [1, 2],
  );
  assert.equal(result.catalog.packs[first.packId].version, 2);
  const invalid = base();
  invalid.requires = [{ packId: 'missing:dependency', minVersion: 1 }];
  const catalog = emptyCatalog();
  await assert.rejects(planImportBatch(catalog, [invalid]), /missing/);
  assert.deepEqual(catalog, emptyCatalog());
});

test('confirmed back navigation consumes history and restores the previous selected tab', () => {
  const words = navigate(initialNavigation, { type: 'go', route: { name: 'words' } });
  const word = navigate(words, { type: 'go', route: { name: 'word', id: 'word:test' } });
  // A dirty-page guard defers this exact action, rather than converting it to go.
  const afterDiscard = navigate(word, { type: 'back' });
  assert.deepEqual(afterDiscard, words);
  assert.deepEqual(navigate(afterDiscard, { type: 'back' }), initialNavigation);
  assert.equal(navigate(words, { type: 'go', route: { name: 'words' } }), words);
});

test('study selection applies imported tags, daily allowance and unavailable-review filtering', () => {
  const pack = base();
  pack.vocabulary![0].tags = ['custom-course'];
  const library = {
    catalog: planImport(emptyCatalog(), pack).catalog,
    words: pack.vocabulary!.map(wordRow),
    questions: pack.questions!.map(questionRow),
    user: emptyUserState(),
    targetExists: () => false,
  };
  library.user.settings.selectedTags = ['custom-course'];
  const targets = newStudyTargets(library, new Date(now));
  assert.equal(targets.length, 1);
  library.user.reviews = [
    { target: targets[0], dueAt: now, intervalDays: 1, ease: 2.5, repetitions: 1 },
  ];
  assert.deepEqual(dueStudyTargets(library, new Date(now)), []);
  library.user.settings.dailyNewLimit = 0;
  assert.deepEqual(newStudyTargets(library, new Date(now)), []);
  library.user.settings.dailyNewLimit = 10;
  library.user.settings.selectedTags = ['another-course'];
  assert.deepEqual(newStudyTargets(library, new Date(now)), []);
});

test('question feedback and durable grades use identical text-answer rules', () => {
  const question = base().questions!.find((question) => question.interaction.kind === 'text')!;
  assert.equal(question.interaction.kind, 'text');
  if (question.interaction.kind !== 'text') return;
  const field = question.interaction.fields[0];
  for (const text of [
    field.accepted[0],
    `  ${field.accepted[0].toUpperCase()}  `,
    '',
    'wrong answer',
    'too many words to accept in this field',
  ]) {
    const result = grade(question, { [field.id]: text });
    assert.equal(result.score, Number(textCorrect(field, text)));
  }
});

test('practice creation snapshots content and refuses duplicate-only pools', async () => {
  const pack = base();
  const question = pack.questions![0];
  const content = { question: async () => question, passage: async () => pack.passages![0] };
  const options = { id: 'practice:factory', createdAt: now, count: 1, questionIds: [question.id] };
  const session = await buildPractice(content, options);
  question.prompt = 'Changed after creation';
  assert.notEqual(session.items[0].question.prompt, question.prompt);
  await assert.rejects(
    buildPractice(content, { ...options, count: 2, questionIds: [question.id, question.id] }),
    /different/,
  );
  const state = addPractice(emptyUserState(), session);
  assert.throws(() => addPractice(state, session), /unfinished/);
  assert.throws(() => savePracticeAnswer(state, session.id, -1, []), /cannot be edited/);
});

test('queued reads observe a consistent snapshot before later writes, even after failures', async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  const failed = queue.run(async () => {
    throw new Error('write failed');
  });
  const snapshot = queue.run(async () => {
    events.push('read start');
    await Promise.resolve();
    events.push('read end');
  });
  const write = queue.run(async () => {
    events.push('write');
  });
  await assert.rejects(failed, /write failed/);
  await Promise.all([snapshot, write]);
  assert.deepEqual(events, ['read start', 'read end', 'write']);
});
