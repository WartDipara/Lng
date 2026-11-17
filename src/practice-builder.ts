import type { Passage, PracticeSession, Question, UserState } from './types.ts';
import { invariant } from './validation.ts';
import { practicePolicy } from './policy.ts';

interface PracticeContent {
  question(id: string): Promise<Question | null>;
  passage(id: string, revision: number): Promise<Passage | null>;
}
interface PracticeOptions {
  id: string;
  createdAt: string;
  count: number;
  questionIds: string[];
  random?: () => number;
}

/** Assemble pinned snapshots through a minimal content port, independent of storage. */
export async function buildPractice(
  content: PracticeContent,
  options: PracticeOptions,
): Promise<PracticeSession> {
  const { count, questionIds, random = Math.random } = options;
  invariant(
    Number.isInteger(count) &&
      count >= practicePolicy.minSize &&
      count <= practicePolicy.maxSize &&
      count <= questionIds.length,
    `Choose ${practicePolicy.minSize}–${practicePolicy.maxSize} questions within the available pool.`,
  );
  const pool = [...new Set(questionIds)];
  invariant(count <= pool.length, 'Not enough different questions.');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const items: PracticeSession['items'] = [];
  for (const questionId of pool.slice(0, count)) {
    const question = await content.question(questionId);
    invariant(question, 'A selected question is unavailable.');
    const passage = question.passageId
      ? await content.passage(question.passageId, question.passageRevision!)
      : undefined;
    invariant(!question.passageId || passage, 'A selected passage is unavailable.');
    items.push({
      question: structuredClone(question),
      ...(passage ? { passage: structuredClone(passage) } : {}),
      answer: null,
    });
  }
  return { id: options.id, createdAt: options.createdAt, items };
}

export function addPractice(state: UserState, session: PracticeSession): UserState {
  invariant(
    !state.practiceSessions?.some((existing) => !existing.submittedAt),
    'Resume your unfinished practice first.',
  );
  return {
    ...state,
    practiceSize: session.items.length,
    practiceSessions: [...(state.practiceSessions ?? []), session],
  };
}

export function savePracticeAnswer(
  state: UserState,
  sessionId: string,
  index: number,
  answer: unknown,
): UserState {
  const session = state.practiceSessions?.find((existing) => existing.id === sessionId);
  invariant(
    session && !session.submittedAt && Number.isInteger(index) && session.items[index],
    'This practice cannot be edited.',
  );
  const items = session.items.map((item, position) =>
    position === index ? { ...item, answer: structuredClone(answer) } : item,
  );
  return {
    ...state,
    practiceSessions: state.practiceSessions!.map((existing) =>
      existing.id === sessionId ? { ...existing, items } : existing,
    ),
  };
}
