import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import starter from '../data/starter.pack.json' with { type: 'json' };
import type { Question } from '../src/types.ts';
import { emptyUserState } from '../src/notebook.ts';
import { recordQuestionTest } from '../src/question-progress.ts';

const question = fixture.questions[0] as Question;
const answer = question.interaction.kind === 'choice' ? question.interaction.correctIds : [];
const time = Date.parse('2026-11-15T10:00:00Z');
const input = { id: 'attempt:1', answer, createdAt: new Date(time).toISOString() };

test('immediate correct repeats preserve the schedule, including serialized progress', () => {
  const first = recordQuestionTest(emptyUserState(), question, input);
  assert.equal(first.outcome, 'correct');
  const repeated = recordQuestionTest(JSON.parse(JSON.stringify(first.state)), question, { ...input, id: 'attempt:2' });
  assert.equal(repeated.outcome, 'practice');
  assert.deepEqual(repeated.state.reviews, first.state.reviews);
  assert.equal(repeated.state.attempts.length, 2);
  const due = recordQuestionTest(repeated.state, question, { ...input, id: 'attempt:3', createdAt: first.state.reviews[0].dueAt });
  assert.equal(due.outcome, 'correct');
  assert.equal(due.state.reviews[0].intervalDays, 6);
});

test('wrong then correct after a short delay is practice, not a mastery promotion', () => {
  const wrong = recordQuestionTest(emptyUserState(), question, { ...input, answer: [] });
  assert.equal(wrong.outcome, 'incorrect');
  const correction = recordQuestionTest(wrong.state, question, { ...input, id: 'attempt:2', createdAt: new Date(time + 11 * 60000).toISOString() });
  assert.equal(correction.outcome, 'practice');
  assert.equal(correction.state.reviews[0].repetitions, 0);
  assert.equal(correction.state.mistakes[0].mastered, false);
  assert.ok(Date.parse(correction.state.reviews[0].dueAt) > time + 11 * 60000);
  assert.equal(recordQuestionTest(correction.state, question, { ...input, id: 'attempt:2', createdAt: new Date(time + 11 * 60000).toISOString() }).state, correction.state);
});

test('multi-field partial answers retain partial scores and missed-task review', () => {
  const q = (starter.questions as Question[]).find(q => q.interaction.kind === 'text' && q.interaction.fields.length > 1) as Question;
  assert.equal(q.interaction.kind, 'text');
  if (q.interaction.kind !== 'text') return;
  const field = q.interaction.fields[0];
  const result = recordQuestionTest(emptyUserState(), q, { ...input, answer: { [field.id]: field.accepted[0] } });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.score, 1);
  assert.equal(result.maxScore, q.interaction.fields.length);
  assert.equal(result.state.mistakes.length, 1);
});

test('answer exposure and progress are isolated by question revision', () => {
  const first = recordQuestionTest(emptyUserState(), question, input);
  const revised = recordQuestionTest(first.state, { ...question, revision: 2 }, { ...input, id: 'attempt:2' });
  assert.equal(revised.outcome, 'correct');
  assert.equal(revised.state.reviews.length, 2);
});
