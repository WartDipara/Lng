import type { Attempt, Question, UserState } from './types.ts';
import { grade } from './grading.ts';
import { recordAttempt } from './notebook.ts';
import { scheduleReview, targetKey } from './learning.ts';

export type QuestionOutcome = 'correct' | 'partial' | 'incorrect' | 'practice';
export function questionOutcome(state: UserState, attempt: Attempt): QuestionOutcome {
  if (attempt.score < attempt.maxScore) return attempt.score > 0 ? 'partial' : 'incorrect';
  const previous = state.attempts.filter(a => a.id !== attempt.id && a.kind === 'question'
    && targetKey(a.target) === targetKey(attempt.target) && a.createdAt <= attempt.createdAt);
  // Every submitted task exposes answer feedback. A recent repeat is practice,
  // even after a restart, not independent evidence of long-term retention.
  if (previous.some(a => Date.parse(attempt.createdAt) - Date.parse(a.createdAt) < 86400000)) return 'practice';
  const review = state.reviews.find(r => targetKey(r.target) === targetKey(attempt.target));
  return review && Date.parse(review.dueAt) > Date.parse(attempt.createdAt) ? 'practice' : 'correct';
}

export function recordQuestionTest(state: UserState, question: Question, input: { id: string; answer: unknown; createdAt: string }) {
  const result = grade(question, input.answer);
  const attempt: Attempt = { ...input, ...result, kind: 'question', target: { kind: 'question', id: question.id, revision: question.revision } };
  const outcome = questionOutcome(state, attempt);
  const recorded = recordAttempt(state, attempt);
  if (recorded === state) return { state, ...result, outcome };
  if (outcome === 'practice') {
    const next = structuredClone(recorded);
    const review = next.reviews.find(r => targetKey(r.target) === targetKey(attempt.target));
    if (review && Date.parse(review.dueAt) <= Date.parse(attempt.createdAt)) {
      review.dueAt = new Date(Date.parse(attempt.createdAt) + 86400000).toISOString();
    }
    return { state: next, ...result, outcome };
  }
  return { state: scheduleReview(recorded, attempt.target, outcome === 'correct' ? 'Good' : 'Again', new Date(input.createdAt)), ...result, outcome };
}

export const questionFeedback: Record<QuestionOutcome, string> = {
  correct: 'All correct. Your next spaced review is scheduled; one result does not mark this task as mastered.',
  partial: 'Partly correct. Review the missed parts. Saved to your mistake notebook for a short review.',
  incorrect: 'Needs practice. Review the explanation. Saved to your mistake notebook for a short review.',
  practice: 'Practice completed. A recent repeat or early attempt does not increase your review interval.',
};
