import { learningPolicy } from './policy.ts';
import { targetKey } from './target.ts';
import type { Attempt, Note, Target, UserState } from './types.ts';
import { canonical } from './catalog.ts';
import { invariant, normalizeAnswer, validateUserState } from './validation.ts';

export function emptyUserState(): UserState {
  return {
    schemaVersion: 1,
    notes: [],
    attempts: [],
    mistakes: [],
    reviews: [],
    settings: { dailyNewLimit: learningPolicy.defaultDailyNewLimit, selectedTags: [] },
  };
}
export function saveNote(state: UserState, note: Note): UserState {
  const next = structuredClone(state);
  const index = next.notes.findIndex((n) => n.id === note.id);
  if (index >= 0) {
    invariant(note.createdAt === next.notes[index].createdAt, 'Note creation time cannot change');
    invariant(
      Date.parse(note.updatedAt) >= Date.parse(next.notes[index].updatedAt),
      'Older note update',
    );
    next.notes[index] = structuredClone(note);
  } else next.notes.push(structuredClone(note));
  validateUserState(next);
  return next;
}
export function recordAttempt(state: UserState, attempt: Attempt): UserState {
  const existing = state.attempts.find((a) => a.id === attempt.id);
  if (existing) {
    invariant(canonical(existing) === canonical(attempt), 'Attempt ID conflict');
    return state;
  }
  const next = structuredClone(state);
  next.attempts.push(structuredClone(attempt));
  if (attempt.score < attempt.maxScore) {
    let mistake = next.mistakes.find((m) => targetKey(m.target) === targetKey(attempt.target));
    if (!mistake) {
      mistake = {
        target: structuredClone(attempt.target),
        attemptIds: [],
        mastered: false,
        updatedAt: attempt.createdAt,
      };
      next.mistakes.push(mistake);
    }
    mistake.attemptIds.push(attempt.id);
    mistake.mastered = false;
    mistake.updatedAt = attempt.createdAt;
  }
  // Success never erases previous mistakes or notes. Mastery is an explicit user action.
  validateUserState(next);
  return next;
}
export function markMastered(
  state: UserState,
  target: Target,
  mastered: boolean,
  now: string,
): UserState {
  const next = structuredClone(state);
  const mistake = next.mistakes.find((m) => targetKey(m.target) === targetKey(target));
  invariant(mistake, 'Unknown mistake');
  mistake.mastered = mastered;
  mistake.updatedAt = now;
  validateUserState(next);
  return next;
}
export function checkSpelling(answer: string, accepted: string[], caseSensitive = false): boolean {
  invariant(accepted.length > 0, 'At least one spelling is required');
  return accepted.some(
    (a) => normalizeAnswer(answer, caseSensitive) === normalizeAnswer(a, caseSensitive),
  );
}
