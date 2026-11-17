import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyUserState } from '../src/notebook.ts';
import { recordWordTest } from '../src/word-progress.ts';
import type { UserState } from '../src/types.ts';

const start = Date.parse('2026-11-15T10:00:00Z');
const input = {
  id: 'attempt:1',
  target: { kind: 'sense' as const, id: 'example:apple', revision: 1 },
  text: 'apple',
  accepted: ['apple'],
  assisted: false,
  createdAt: new Date(start).toISOString(),
};
function run(state: UserState, changes: Partial<typeof input> = {}) {
  return recordWordTest(state, { ...input, ...changes });
}
test('unaided spelling advances only when due, with durable outcome records', () => {
  const first = run(emptyUserState());
  assert.equal(first.outcome, 'recalled');
  assert.equal(first.state.reviews[0].intervalDays, 1);
  const early = run(first.state, {
    id: 'attempt:2',
    createdAt: new Date(start + 60000).toISOString(),
  });
  assert.deepEqual(early.state.reviews, first.state.reviews);
  const due = run(early.state, { id: 'attempt:3', createdAt: first.state.reviews[0].dueAt });
  assert.equal(due.state.reviews[0].intervalDays, 6);
  assert.deepEqual(due.state.attempts[2].answer, { text: 'apple', outcome: 'recalled' });
});
test('errors and answer reveals schedule short reviews; immediate correction cannot promote', () => {
  const wrong = run(emptyUserState(), { text: 'aple' });
  assert.equal(wrong.outcome, 'incorrect');
  assert.equal(wrong.state.mistakes.length, 1);
  assert.equal(wrong.state.reviews[0].intervalDays, 10 / 1440);
  const correction = run(wrong.state, { id: 'attempt:2', assisted: true });
  assert.equal(correction.outcome, 'assisted');
  assert.deepEqual(correction.state.reviews, wrong.state.reviews);
  assert.equal(correction.state.mistakes.length, 1);
  const shown = recordWordTest(emptyUserState(), { ...input, revealed: true });
  assert.equal(shown.outcome, 'revealed');
  assert.equal(shown.state.attempts[0].score, 0);
});
test('studied answers are not unaided recall and duplicate saves are idempotent', () => {
  const first = run(emptyUserState(), { assisted: true });
  assert.equal(first.state.reviews[0].repetitions, 0);
  assert.equal(run(first.state, { assisted: true }).state, first.state);
});
