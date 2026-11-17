import type { Target, UserState, Word, Sense } from './types.ts';
import { checkSpelling, recordAttempt } from './notebook.ts';
import { scheduleReview, targetKey } from './learning.ts';
import { invariant } from './validation.ts';

export const learningStages = ['choice', 'recognize', 'recall', 'spell'] as const;
export type LearningStage = (typeof learningStages)[number];
export type LearningProgress = LearningStage | 'complete';
export const meaningOf = (sense: Sense) => sense.simpleDefinition ?? sense.definition ?? '';

export function unfinishedLearningTargets(state: UserState): Target[] {
  const targets = new Map<string, Target>();
  for (const attempt of state.attempts) {
    const answer = attempt.answer as { method?: string; next?: string } | null;
    if (attempt.target.kind !== 'sense' || answer?.method !== 'progressive-v1') continue;
    const key = targetKey(attempt.target);
    if (answer.next === 'complete') targets.delete(key);
    else if (learningStages.includes(answer.next as LearningStage))
      targets.set(key, attempt.target);
  }
  return [...targets.values()];
}

/** Progress is derived from durable attempts, preserving existing backups and revisions. */
export function learningProgress(state: UserState, target: Target): LearningProgress | undefined {
  for (let i = state.attempts.length - 1; i >= 0; i--) {
    const attempt = state.attempts[i];
    const answer = attempt.answer as { method?: string; next?: LearningProgress } | null;
    if (
      targetKey(attempt.target) === targetKey(target) &&
      answer?.method === 'progressive-v1' &&
      [...learningStages, 'complete'].includes(answer.next!)
    )
      return answer.next;
  }
}

export function recordLearningStep(
  state: UserState,
  input: {
    id: string;
    target: Target;
    stage: LearningStage;
    response: string | boolean;
    revealed?: boolean;
    correction?: boolean;
    createdAt: string;
  },
  word: Word,
  sense: Sense,
): UserState {
  const existing = state.attempts.find((attempt) => attempt.id === input.id);
  if (existing) {
    const answer = existing.answer as {
      method?: string;
      stage?: string;
      response?: unknown;
      revealed?: boolean;
      correction?: boolean;
    } | null;
    invariant(
      targetKey(existing.target) === targetKey(input.target) &&
        existing.createdAt === input.createdAt &&
        answer?.method === 'progressive-v1' &&
        answer.stage === input.stage &&
        answer.response === input.response &&
        !!answer.revealed === !!input.revealed &&
        !!answer.correction === !!input.correction,
      'Attempt ID conflict',
    );
    return state;
  }
  invariant(
    input.target.kind === 'sense' &&
      input.target.id === sense.id &&
      input.target.revision === word.revision,
    'Learning target mismatch',
  );
  const progress = learningProgress(state, input.target);
  const expected = progress === 'complete' ? 'recognize' : (progress ?? 'choice');
  const previous = [...state.attempts]
    .reverse()
    .find((attempt) => targetKey(attempt.target) === targetKey(input.target));
  const previousAnswer = previous?.answer as { method?: string; stage?: LearningStage } | undefined;
  invariant(
    input.correction
      ? (input.stage === 'recognize' || input.stage === 'recall') &&
          previousAnswer?.method === 'progressive-v1' &&
          previousAnswer.stage === input.stage &&
          previous?.score === 1 &&
          input.response === false
      : input.stage === expected,
    'This learning step has changed. Reopen the word.',
  );
  const correct =
    !input.revealed &&
    (input.stage === 'choice'
      ? input.response === meaningOf(sense)
      : input.stage === 'spell'
        ? typeof input.response === 'string' &&
          checkSpelling(input.response, [word.headword, ...word.variants])
        : input.response === true);
  const next: LearningProgress = correct
    ? input.stage === 'spell'
      ? 'complete'
      : learningStages[learningStages.indexOf(input.stage) + 1]
    : 'choice';
  const recorded = recordAttempt(state, {
    id: input.id,
    target: input.target,
    kind: input.stage === 'spell' ? 'spelling' : 'recall',
    answer: {
      method: 'progressive-v1',
      stage: input.stage,
      response: input.response,
      next,
      revealed: !!input.revealed,
      correction: !!input.correction,
    },
    score: Number(correct),
    maxScore: 1,
    createdAt: input.createdAt,
  });
  if (next !== 'complete') return recorded;
  const review = state.reviews.find((item) => targetKey(item.target) === targetKey(input.target));
  if (review && Date.parse(review.dueAt) > Date.parse(input.createdAt)) return recorded;
  // Relearning after a lapse must not inflate a previously long interval.
  let lapsed = false;
  for (let index = state.attempts.length - 1; index >= 0; index--) {
    const attempt = state.attempts[index];
    if (targetKey(attempt.target) !== targetKey(input.target)) continue;
    const answer = attempt.answer as { method?: string; next?: string } | null;
    if (answer?.method !== 'progressive-v1' || answer.next === 'complete') break;
    if (attempt.score === 0) lapsed = true;
  }
  return scheduleReview(
    recorded,
    input.target,
    review && lapsed ? 'Again' : 'Good',
    new Date(input.createdAt),
  );
}

/** Exclude known synonyms and duplicates; arbitrary imported meanings may still need editorial review. */
export function meaningChoices(
  word: Word,
  sense: Sense,
  candidates: Word[],
  random = Math.random,
): string[] {
  const correct = meaningOf(sense);
  const forbidden = new Set(word.senses.map(meaningOf).map((value) => value.trim().toLowerCase()));
  const related = new Set(
    [word.headword, ...word.variants, ...sense.synonyms].map((value) => value.toLowerCase()),
  );
  const options = new Map<string, string>();
  const senses = candidates
    .filter(
      (candidate) => candidate.id !== word.id && !related.has(candidate.headword.toLowerCase()),
    )
    .flatMap((candidate) =>
      candidate.senses.filter(
        (item) => !item.synonyms.some((term) => related.has(term.toLowerCase())),
      ),
    )
    .sort(
      (a, b) =>
        Number(b.partOfSpeech === sense.partOfSpeech) -
        Number(a.partOfSpeech === sense.partOfSpeech),
    );
  for (const item of senses) {
    const text = meaningOf(item).trim();
    const key = text.toLowerCase();
    if (text && !forbidden.has(key)) options.set(key, text);
    if (options.size === 3) break;
  }
  invariant(
    correct && options.size === 3,
    'Four distinct meanings are needed. Add more learning cards to use this exercise.',
  );
  const result = [correct, ...options.values()];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
