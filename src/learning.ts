import type { Target, UserState } from './types.ts';
import { validateUserState } from './validation.ts';

export type Rating = 'Again' | 'Hard' | 'Good' | 'Easy';
export const targetKey = (t: Target) => `${t.kind}:${t.id}@${t.revision}`;
export function scheduleReview(state: UserState, target: Target, rating: Rating, now = new Date()): UserState {
  const next = structuredClone(state);
  const index = next.reviews.findIndex(r => targetKey(r.target) === targetKey(target));
  const old = next.reviews[index];
  const quality = { Again: 1, Hard: 3, Good: 4, Easy: 5 }[rating];
  const ease = Math.max(1.3, (old?.ease ?? 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const repetitions = rating === 'Again' ? 0 : (old?.repetitions ?? 0) + 1;
  const intervalDays = rating === 'Again' ? 10 / 1440
    : repetitions === 1 ? (rating === 'Easy' ? 4 : 1)
    : repetitions === 2 ? (rating === 'Hard' ? 3 : 6)
    : Math.max(1, Math.round((old?.intervalDays ?? 1) * (rating === 'Hard' ? 1.2 : ease)));
  const review = { target: structuredClone(target), intervalDays, ease, repetitions,
    dueAt: new Date(now.getTime() + intervalDays * 86400000).toISOString() };
  if (index < 0) next.reviews.push(review); else next.reviews[index] = review;
  validateUserState(next);
  return next;
}
export function dueReviews(state: UserState, now = new Date()) {
  return state.reviews.filter(r => Date.parse(r.dueAt) <= now.getTime()).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
export function sameLocalDay(iso: string, now: Date): boolean {
  return new Date(iso).toDateString() === now.toDateString();
}
export function studiedToday(state: UserState, now = new Date()): number {
  return new Set(state.attempts.filter(a => a.target.kind === 'sense' && sameLocalDay(a.createdAt, now)).map(a => a.target.id)).size;
}
export function newSensesToday(state: UserState, now = new Date()): number {
  const first = new Map<string, string>();
  for (const attempt of state.attempts) if (attempt.target.kind === 'sense') {
    const old = first.get(attempt.target.id);
    if (!old || old > attempt.createdAt) first.set(attempt.target.id, attempt.createdAt);
  }
  return [...first.values()].filter(date => sameLocalDay(date, now)).length;
}
