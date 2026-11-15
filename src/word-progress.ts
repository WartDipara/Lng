import type { Attempt, Target, UserState } from './types.ts';
import { checkSpelling, recordAttempt } from './notebook.ts';
import { scheduleReview, targetKey } from './learning.ts';

export type WordOutcome = 'recalled' | 'assisted' | 'incorrect' | 'revealed';

/** Only a successful, unaided, due test advances the spaced review schedule. */
export function recordWordTest(state: UserState, input: {
  id: string; target: Target; text: string; accepted: string[];
  assisted: boolean; revealed?: boolean; createdAt: string;
}): { state: UserState; outcome: WordOutcome } {
  const correct = !input.revealed && checkSpelling(input.text, input.accepted);
  const outcome: WordOutcome = input.revealed ? 'revealed' : !correct ? 'incorrect' : input.assisted ? 'assisted' : 'recalled';
  const attempt: Attempt = {
    id: input.id, target: input.target, kind: 'spelling',
    answer: { text: input.text, outcome }, score: Number(correct), maxScore: 1, createdAt: input.createdAt,
  };
  const recorded = recordAttempt(state, attempt);
  if (recorded === state) return { state, outcome };
  const old = state.reviews.find(review => targetKey(review.target) === targetKey(input.target));
  // Early practice and immediate corrections cannot inflate the review interval.
  if ((outcome === 'recalled' || outcome === 'assisted') && old && Date.parse(old.dueAt) > Date.parse(input.createdAt)) {
    return { state: recorded, outcome };
  }
  return { state: scheduleReview(recorded, input.target, outcome === 'recalled' ? 'Good' : 'Again', new Date(input.createdAt)), outcome };
}
