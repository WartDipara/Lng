import type { PracticeItem, PracticeSession, Question, UserState } from './types.ts';
import { recordQuestionTest } from './question-progress.ts';
import { invariant } from './validation.ts';

export function hasAnswer(answer: unknown): boolean {
  if (typeof answer === 'string') return !!answer.trim();
  if (Array.isArray(answer)) return answer.length > 0;
  return !!answer && typeof answer === 'object' && Object.values(answer).some(hasAnswer);
}
export function completeAnswer(question: Question, answer: unknown): boolean {
  const i = question.interaction;
  if (!hasAnswer(answer)) return false;
  if (i.kind === 'choice') return Array.isArray(answer) && answer.length > 0;
  if (i.kind === 'ordering') return Array.isArray(answer) && answer.length === i.items.length;
  const fields = answer as Record<string, unknown>;
  return (i.kind === 'text' ? i.fields : i.prompts).every((f) => hasAnswer(fields[f.id]));
}
export function itemStatus(item: PracticeItem): 'correct' | 'incorrect' | 'unanswered' {
  return !hasAnswer(item.answer)
    ? 'unanswered'
    : item.score === item.maxScore && item.score !== undefined
      ? 'correct'
      : 'incorrect';
}
export function sessionSummary(session: PracticeSession) {
  const total = session.items.length;
  const correct = session.items.filter((i) => itemStatus(i) === 'correct').length;
  const unanswered = session.items.filter((i) => !hasAnswer(i.answer)).length;
  return {
    total,
    correct,
    incorrect: total - correct - unanswered,
    unanswered,
    accuracy: Math.round((correct / total) * 100),
  };
}
/** Grade one item atomically. An attempt ID also locks the answer across restarts. */
export function checkPracticeItem(
  state: UserState,
  sessionId: string,
  index: number,
  now: string,
): UserState {
  const session = state.practiceSessions?.find((s) => s.id === sessionId);
  invariant(session && Number.isInteger(index) && session.items[index], 'Practice item not found.');
  const item = session.items[index];
  if (session.submittedAt || item.attemptId) return state;
  invariant(completeAnswer(item.question, item.answer), 'Finish your answer first.');
  const attemptId = `${session.id}-q${index + 1}`;
  const result = recordQuestionTest(state, item.question, {
    id: attemptId,
    answer: item.answer,
    createdAt: now,
  });
  return {
    ...result.state,
    practiceSessions: result.state.practiceSessions!.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            items: s.items.map((entry, position) =>
              position === index
                ? { ...entry, attemptId, score: result.score, maxScore: result.maxScore }
                : entry,
            ),
          }
        : s,
    ),
  };
}

export function submitPractice(state: UserState, sessionId: string, now: string): UserState {
  const session = state.practiceSessions?.find((s) => s.id === sessionId);
  invariant(session, 'Practice session not found.');
  if (session.submittedAt) return state;
  let next = state;
  const items = session.items.map((item, index) => {
    if (item.attemptId || !hasAnswer(item.answer)) return item;
    const attemptId = `${session.id}-q${index + 1}`;
    const result = recordQuestionTest(next, item.question, {
      id: attemptId,
      answer: item.answer,
      createdAt: now,
    });
    next = result.state;
    return { ...item, attemptId, score: result.score, maxScore: result.maxScore };
  });
  return {
    ...next,
    practiceSessions: next.practiceSessions!.map((s) =>
      s.id === sessionId ? { ...s, submittedAt: now, items } : s,
    ),
  };
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function activityDays(state: UserState): Map<string, number> {
  const days = new Map<string, number>();
  for (const attempt of state.attempts) {
    const day = localDateKey(new Date(attempt.createdAt));
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}
