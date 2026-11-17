import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import example from '../examples/base.pack.json' with { type: 'json' };
import increment from '../examples/increment.pack.json' with { type: 'json' };
import { canonical, emptyCatalog, hash, planImport, utf8 } from '../src/catalog.ts';
import { createHash } from 'node:crypto';
import { createDelta } from '../src/delta.ts';
import {
  importPack,
  readCatalog,
  readContentSnapshot,
  readUserState,
  updateUserState,
} from '../src/store.ts';
import {
  emptyUserState,
  recordAttempt,
  saveNote,
  markMastered,
  checkSpelling,
} from '../src/notebook.ts';
import { grade } from '../src/grading.ts';
import { splitPack } from '../src/split.ts';
import { validatePack, validateUserState } from '../src/validation.ts';
import type { ContentPack, Attempt, Note } from '../src/types.ts';

function base() {
  return structuredClone(example) as ContentPack;
}
function inc() {
  return structuredClone(increment) as ContentPack;
}
const now = '2026-11-15T00:00:00Z';
const attempt: Attempt = {
  id: 'attempt:first',
  kind: 'question',
  target: { kind: 'question', id: 'example:comprehension', revision: 1 },
  answer: ['option:1'],
  score: 0,
  maxScore: 1,
  createdAt: now,
};
const note: Note = {
  id: 'note:first',
  title: 'Conditions',
  body: 'Contingent on means a condition must be met.',
  tags: ['conditions'],
  target: attempt.target,
  createdAt: now,
  updatedAt: now,
};

test('every supported question type has a valid original example', () => {
  validatePack(base());
  assert.equal(base().questions!.length, 22);
});
test('base and delta are idempotent; only new entities are added', () => {
  const first = planImport(emptyCatalog(), base());
  assert.equal(first.counts.added, 25);
  assert.equal(planImport(first.catalog, base()).changed, false);
  const second = planImport(first.catalog, inc());
  assert.equal(second.counts.added, 1);
  assert.equal(planImport(second.catalog, inc()).changed, false);
});
test('missing dependencies and unknown versions fail without mutating state', () => {
  const state = emptyCatalog();
  const before = canonical(state);
  assert.throws(() => planImport(state, inc()), /Missing dependency/);
  const invalid: any = base();
  invalid.schemaVersion = 2;
  assert.throws(() => planImport(state, invalid));
  assert.equal(canonical(state), before);
});
test('pack and entity conflicts are rejected', () => {
  const catalog = planImport(emptyCatalog(), base()).catalog;
  const conflict = base();
  conflict.questions![0].prompt = 'Different';
  assert.throws(() => planImport(catalog, conflict), /Pack version conflict/);
  conflict.packId = 'example:conflict';
  assert.throws(() => planImport(catalog, conflict), /Entity revision conflict/);
});
test('question revision retains the old reference for notebooks and attempts', () => {
  const first = planImport(emptyCatalog(), base());
  const update = inc();
  update.questions = [structuredClone(base().questions![0])];
  update.questions[0].revision = 2;
  update.questions[0].explanation += ' Check conditions first.';
  const next = planImport(first.catalog, update);
  assert.deepEqual(Object.keys(next.catalog.entities.questions['example:comprehension']), [
    '1',
    '2',
  ]);
});
test('missing passages, sources, senses and invalid answers are rejected', () => {
  for (const mutate of [
    (p: ContentPack) => {
      p.questions![0].passageId = 'missing:passage';
    },
    (p: ContentPack) => {
      p.questions![0].sourceIds = ['missing:source'];
    },
    (p: ContentPack) => {
      p.questions![0].senseIds = ['missing:sense'];
    },
    (p: ContentPack) => {
      p.questions![0].evidenceParagraphIds = ['missing:paragraph'];
    },
    (p: ContentPack) => {
      const i = p.questions![0].interaction;
      if (i.kind === 'choice') i.correctIds = ['missing:option'];
    },
  ]) {
    const p = base();
    mutate(p);
    assert.throws(() => planImport(emptyCatalog(), p));
  }
});
test('unknown fields cannot inject user data into a content package', () => {
  const p: any = base();
  p.notes = [note];
  assert.throws(() => validatePack(p), /additional properties/);
});
test('delta generator increments changed entities and passage-dependent questions', () => {
  const original = base();
  const desired = base();
  desired.passages![0].paragraphs[0].text += ' This is a revised description.';
  const delta = createDelta(original, desired, 'example:generated', now);
  assert.equal(delta.passages![0].revision, 2);
  assert.ok(delta.questions!.length > 1);
  assert.ok(delta.questions!.every((q) => q.passageRevision === 2 && q.revision === 2));
  const catalog = planImport(emptyCatalog(), original).catalog;
  assert.doesNotThrow(() => planImport(catalog, delta));
  assert.equal(createDelta(original, original, 'example:empty', now).questions!.length, 0);
});
test('matching and ordering grade deterministically; spelling is not fuzzy', () => {
  const questions = base().questions!;
  for (const q of questions) {
    const i = q.interaction;
    const answer =
      i.kind === 'choice'
        ? i.correctIds
        : i.kind === 'text'
          ? Object.fromEntries(i.fields.map((f) => [f.id, f.accepted[0]]))
          : i.kind === 'matching'
            ? Object.fromEntries(i.pairs.map((p) => [p.promptId, p.optionId]))
            : i.correctOrder;
    const result = grade(q, answer);
    assert.equal(result.score, result.maxScore, q.id);
    assert.equal(grade(q, null).score, 0, q.id);
  }
  const fill = questions.find((q) => q.type === 'sentence-completion')!;
  assert.equal(grade(fill, { 'field:answer': ' SIX ' }).score, 1);
  assert.equal(grade(fill, { 'field:answer': 'six weeks' }).score, 0);
  assert.equal(checkSpelling(' contingent ', ['contingent']), true);
  assert.equal(checkSpelling('contigent', ['contingent']), false);
});
test('wrong answers create a notebook entry; success never deletes notes or mistakes', () => {
  let state = saveNote(emptyUserState(), note);
  state = recordAttempt(state, attempt);
  assert.equal(state.mistakes.length, 1);
  assert.equal(recordAttempt(state, attempt).attempts.length, 1);
  state = recordAttempt(state, { ...attempt, id: 'attempt:second', score: 1 });
  assert.equal(state.notes[0].body, note.body);
  assert.equal(state.mistakes.length, 1);
  state = markMastered(state, attempt.target, true, now);
  assert.equal(state.mistakes[0].mastered, true);
  state = recordAttempt(state, { ...attempt, id: 'attempt:third' });
  assert.equal(state.mistakes[0].mastered, false);
  assert.throws(() => recordAttempt(state, { ...attempt, score: 1 }), /conflict/);
  const corrupt = structuredClone(state);
  corrupt.mistakes[0].attemptIds.push('attempt:missing');
  assert.throws(() => validateUserState(corrupt));
});
test('persistent imports preserve user files, dry runs do not commit, restart reads the same data', async () => {
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(join('.local', 'engdict-'));
  await importPack(root, base(), true);
  assert.deepEqual(await readCatalog(root), emptyCatalog());
  await importPack(root, base());
  await updateUserState(root, (state) => recordAttempt(saveNote(state, note), attempt));
  const before = await readFile(join(root, 'USER-CURRENT.json'), 'utf8');
  await importPack(root, inc());
  assert.equal(await readFile(join(root, 'USER-CURRENT.json'), 'utf8'), before);
  assert.equal((await readUserState(root)).notes[0].body, note.body);
  assert.equal((await readCatalog(root)).packs['example:increment'].version, 1);
  assert.equal((await importPack(root, inc())).changed, false);
  const pointer = await readFile(join(root, 'CURRENT.json'), 'utf8');
  await writeFile(join(root, 'writer.lock'), 'simulated stopped writer');
  await assert.rejects(importPack(root, inc()), /locked/);
  assert.equal(await readFile(join(root, 'CURRENT.json'), 'utf8'), pointer);
});
test('canonical fingerprints ignore object property order', () => {
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
});
test('Hermes UTF8 fallback matches native SHA256 for non-ASCII and unpaired surrogates', () => {
  const original = globalThis.TextEncoder;
  try {
    Object.defineProperty(globalThis, 'TextEncoder', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const text = 'English café \u4e2d\u6587 😀 \ud800';
    assert.deepEqual(utf8(text), new Uint8Array(Buffer.from(text)));
    assert.equal(hash({ text }), createHash('sha256').update(canonical({ text })).digest('hex'));
  } finally {
    Object.defineProperty(globalThis, 'TextEncoder', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
});
test('delta chains compare with installed content and keep all prerequisites', async () => {
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(join('.local', 'delta-chain-'));
  await importPack(root, base());
  await importPack(root, inc());
  const { catalog, snapshot } = await readContentSnapshot(root);
  assert.equal(snapshot.questions!.length, 23);
  const desired = structuredClone(snapshot);
  desired.questions!.find((q) => q.id === 'example:comprehension-extra')!.explanation +=
    ' Read the condition.';
  const delta = createDelta(snapshot, desired, 'updates:second', now);
  delta.requires = Object.entries(catalog.packs).map(([packId, p]) => ({
    packId,
    minVersion: p.version,
  }));
  assert.equal(delta.questions!.length, 1);
  assert.equal(delta.questions![0].revision, 2);
  assert.throws(
    () => planImport(planImport(emptyCatalog(), base()).catalog, delta),
    /Missing dependency/,
  );
  await importPack(root, delta);
  const after = (await readContentSnapshot(root)).snapshot;
  assert.equal(after.questions!.length, 23);
  assert.equal(after.questions!.find((q) => q.id === 'example:comprehension-extra')!.revision, 2);
});
test('invalid ready cards, duplicate senses and unknown task types fail', () => {
  const ready = base();
  ready.vocabulary![0].senses[0].simpleDefinition = null;
  assert.throws(() => validatePack(ready), /ready requires/);
  const duplicate = base();
  duplicate.vocabulary!.push({
    ...structuredClone(duplicate.vocabulary![0]),
    id: 'example:other-word',
  });
  assert.throws(() => validatePack(duplicate), /Duplicate sense/);
  const unknown: any = base();
  unknown.questions[0].type = 'run-script';
  assert.throws(() => validatePack(unknown));
});
test('a corrupt committed catalog fails visibly instead of resetting progress', async () => {
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(join('.local', 'corrupt-'));
  await importPack(root, base());
  const pointer = JSON.parse(await readFile(join(root, 'CURRENT.json'), 'utf8'));
  await writeFile(join(root, 'catalogs', pointer.file), '{}');
  await assert.rejects(readCatalog(root), /corrupt/);
});
test('changed old entity revisions are rejected and old revision history stays intact', () => {
  const original = base();
  const desired = base();
  desired.questions![0].explanation += ' More detail.';
  const delta = createDelta(original, desired, 'updates:revision', now);
  const catalog = planImport(planImport(emptyCatalog(), original).catalog, delta).catalog;
  const older = inc();
  older.packId = 'updates:old';
  older.questions = [structuredClone(original.questions![0])];
  assert.equal(planImport(catalog, older).counts.skipped, 1);
  older.questions[0].prompt = 'Conflicting old wording';
  assert.throws(() => planImport(catalog, older), /revision conflict/);
});
test('split packages retain every entity and can be imported incrementally', () => {
  const chunks = [...splitPack(base(), 'example:chunk', 3)];
  assert.equal(chunks.length, 9);
  assert.throws(() => planImport(emptyCatalog(), chunks[1]), /Missing dependency/);
  let catalog = emptyCatalog();
  for (const chunk of chunks) catalog = planImport(catalog, chunk).catalog;
  assert.equal(Object.keys(catalog.entities.questions).length, 22);
  assert.equal(Object.keys(catalog.entities.vocabulary).length, 1);
  assert.equal(planImport(catalog, chunks[0]).changed, false);
  assert.throws(() => [...splitPack(base(), 'example:chunk', 0)], /Batch size/);
});
