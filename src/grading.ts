import { textCorrect } from './answers.ts';
import type { Question } from './types.ts';
import { validateQuestion } from './validation.ts';

export function grade(question: Question, answer: unknown): { score: number; maxScore: number } {
  validateQuestion(question);
  const i = question.interaction;
  const fields =
    answer && typeof answer === 'object' && !Array.isArray(answer)
      ? (answer as Record<string, unknown>)
      : {};
  if (i.kind === 'choice') {
    const selected = Array.isArray(answer) ? answer : [];
    const correct =
      selected.length === i.correctIds.length &&
      new Set(selected).size === selected.length &&
      selected.every((id) => i.correctIds.includes(id));
    return { score: Number(correct), maxScore: 1 };
  }
  if (i.kind === 'text') {
    return {
      score: i.fields.filter((field) => textCorrect(field, fields[field.id])).length,
      maxScore: i.fields.length,
    };
  }
  if (i.kind === 'matching') {
    return {
      score: i.pairs.filter((p) => fields[p.promptId] === p.optionId).length,
      maxScore: i.pairs.length,
    };
  }
  return {
    score: Number(
      Array.isArray(answer) &&
        answer.length === i.correctOrder.length &&
        answer.every((id, index) => id === i.correctOrder[index]),
    ),
    maxScore: 1,
  };
}
