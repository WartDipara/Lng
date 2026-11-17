import type { Interaction } from './types.ts';

export type TextField = Extract<Interaction, { kind: 'text' }>['fields'][number];

export function normalizeAnswer(value: string, caseSensitive = false): string {
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? text : text.toLocaleLowerCase('en');
}

export function textCorrect(field: TextField, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = normalizeAnswer(value, field.caseSensitive);
  return (
    text.length > 0 &&
    text.split(' ').length <= field.maxWords &&
    field.accepted.some((accepted) => normalizeAnswer(accepted, field.caseSensitive) === text)
  );
}

export function stringMap(answer: unknown): Record<string, string> {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return {};
  return Object.fromEntries(
    Object.entries(answer).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  );
}

export function stringArray(answer: unknown): string[] {
  return Array.isArray(answer)
    ? answer.filter((item): item is string => typeof item === 'string')
    : [];
}
