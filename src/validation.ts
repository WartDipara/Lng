import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import packSchema from '../schemas/content-pack.v1.schema.json' with { type: 'json' };
import userSchema from '../schemas/user-state.v1.schema.json' with { type: 'json' };
import type { ContentPack, Question, UserState } from './types.ts';

const ajv = new Ajv2020({ allErrors: false, strict: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const packValidator = ajv.compile(packSchema);
const userValidator = ajv.compile(userSchema);
export function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function unique(values: string[], label: string) {
  invariant(new Set(values).size === values.length, `Duplicate ${label}`);
}
export function normalizeAnswer(value: string, caseSensitive = false): string {
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? text : text.toLocaleLowerCase('en');
}
export function validateQuestion(q: Question) {
  const i = q.interaction;
  invariant(Boolean(q.passageId) === Boolean(q.passageRevision), `${q.id}: passage ID and revision must occur together`);
  invariant(q.passageId || !q.evidenceParagraphIds.length, `${q.id}: evidence needs a passage`);
  if (q.origin !== 'original') invariant(q.exam, `${q.id}: exam provenance required`);
  if (q.origin === 'past-paper') invariant(q.exam?.year, `${q.id}: past paper year required`);
  const matching = q.type.startsWith('matching-');
  if (matching) invariant(i.kind === 'matching', `${q.id}: matching interaction required`);
  if (['error-identification', 'dialogue', 'scenario', 'multiple-choice-cloze', 'true-false-not-given', 'yes-no-not-given'].includes(q.type)) {
    invariant(i.kind === 'choice', `${q.id}: choice interaction required`);
  }
  if (['short-answer', 'open-cloze', 'word-formation', 'key-word-transformation', 'table-completion', 'flowchart-completion', 'diagram-labelling'].includes(q.type)) {
    invariant(i.kind === 'text', `${q.id}: text interaction required`);
  }
  if (i.kind === 'ordering') invariant(q.type === 'paragraph-improvement', `${q.id}: ordering only supported for paragraph improvement`);
  if (i.kind === 'choice') {
    const ids = i.options.map(o => o.id);
    unique(ids, 'option ID'); unique(i.correctIds, 'answer ID');
    invariant(i.correctIds.every(id => ids.includes(id)), `${q.id}: unknown answer option`);
    invariant(i.multiple || i.correctIds.length === 1, `${q.id}: single choice needs one answer`);
    invariant(Object.keys(q.optionExplanations ?? {}).every(id => ids.includes(id)), `${q.id}: unknown explanation option`);
    if (q.type.endsWith('not-given')) {
      const expected = q.type === 'true-false-not-given' ? ['false', 'not given', 'true'] : ['no', 'not given', 'yes'];
      invariant(!i.multiple && JSON.stringify(i.options.map(o => normalizeAnswer(o.text)).sort()) === JSON.stringify(expected), `${q.id}: invalid judgement options`);
    }
  } else if (i.kind === 'text') {
    unique(i.fields.map(f => f.id), 'field ID');
    for (const field of i.fields) {
      const answers = field.accepted.map(a => normalizeAnswer(a, field.caseSensitive));
      unique(answers, 'normalized accepted answer');
      invariant(answers.every(a => a && a.split(' ').length <= field.maxWords), `${q.id}: answer exceeds word limit`);
    }
  } else if (i.kind === 'matching') {
    unique(i.prompts.map(p => p.id), 'prompt ID'); unique(i.options.map(o => o.id), 'option ID');
    unique(i.pairs.map(p => p.promptId), 'matched prompt');
    invariant(i.pairs.length === i.prompts.length, `${q.id}: each prompt needs an answer`);
    for (const pair of i.pairs) invariant(i.prompts.some(p => p.id === pair.promptId) && i.options.some(o => o.id === pair.optionId), `${q.id}: unknown matching ID`);
    if (!i.reuseOptions) unique(i.pairs.map(p => p.optionId), 'non-reusable option');
    if (q.type === 'matching-headings') invariant(!i.reuseOptions, `${q.id}: headings cannot be reused`);
  } else {
    unique(i.items.map(o => o.id), 'ordering item'); unique(i.correctOrder, 'ordered ID');
    invariant(i.items.length === i.correctOrder.length && i.correctOrder.every(id => i.items.some(o => o.id === id)), `${q.id}: ordering must be a permutation`);
  }
  const layoutKind = { 'table-completion': 'table', 'flowchart-completion': 'flowchart', 'diagram-labelling': 'diagram' }[q.type as string];
  if (layoutKind) invariant(q.layout?.kind === layoutKind, `${q.id}: layout required`);
  if (q.layout) {
    invariant(i.kind === 'text', `${q.id}: layout requires text fields`);
    if (q.layout.kind === 'diagram') {
      invariant(q.layout.imageDataUri && q.layout.altText && q.layout.labels?.length === i.fields.length, `${q.id}: complete diagram required`);
      unique(q.layout.labels!.map(l => l.fieldId), 'diagram field');
      invariant(q.layout.labels!.every(l => i.fields.some(f => f.id === l.fieldId)), `${q.id}: unknown diagram field`);
    } else {
      const strings = q.layout.kind === 'table' ? q.layout.rows?.flat() : q.layout.steps;
      invariant(strings?.length, `${q.id}: empty layout`);
      const placeholders = strings.flatMap(s => [...s.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]));
      unique(placeholders, 'layout placeholder');
      invariant(placeholders.length === i.fields.length && placeholders.every(id => i.fields.some(f => f.id === id)), `${q.id}: layout must contain each field once`);
    }
  }
}
export function validatePack(input: unknown): asserts input is ContentPack {
  invariant(packValidator(input), ajv.errorsText(packValidator.errors));
  const pack = input as unknown as ContentPack;
  for (const collection of [pack.sources, pack.vocabulary ?? [], pack.passages ?? [], pack.questions ?? []]) unique(collection.map(e => e.id), 'entity ID');
  unique(pack.requires.map(r => r.packId), 'dependency');
  invariant(!pack.requires.some(r => r.packId === pack.packId), 'Pack cannot depend on itself');
  const senseIds: string[] = [];
  for (const word of pack.vocabulary ?? []) {
    unique(word.tags, 'word tag'); unique(word.sourceIds, 'word source');
    for (const sense of word.senses) {
      senseIds.push(sense.id);
      if (sense.status === 'ready') invariant(sense.simpleDefinition?.trim() && sense.examples.length >= 2, `${sense.id}: ready requires a simple definition and two examples`);
    }
    if (word.status === 'headword-only') invariant(!word.senses.length, `${word.id}: headword-only cannot have senses`);
    if (word.status === 'ready') invariant(word.senses.some(s => s.status === 'ready'), `${word.id}: no ready sense`);
  }
  unique(senseIds, 'sense ID');
  for (const passage of pack.passages ?? []) unique(passage.paragraphs.map(p => p.id), 'paragraph ID');
  for (const question of pack.questions ?? []) validateQuestion(question);
}
export function validateUserState(input: unknown): asserts input is UserState {
  invariant(userValidator(input), ajv.errorsText(userValidator.errors));
  const state = input as unknown as UserState;
  unique(state.notes.map(n => n.id), 'note ID'); unique(state.attempts.map(a => a.id), 'attempt ID');
  const targetKey = (target: { kind: string; id: string; revision: number }) => `${target.kind}/${target.id}/${target.revision}`;
  unique(state.mistakes.map(m => targetKey(m.target)), 'mistake target');
  unique(state.reviews.map(m => targetKey(m.target)), 'review target');
  for (const note of state.notes) invariant(Date.parse(note.updatedAt) >= Date.parse(note.createdAt), `${note.id}: updatedAt precedes createdAt`);
  const attempts = new Map(state.attempts.map(a => [a.id, a]));
  for (const attempt of state.attempts) {
    invariant(attempt.score <= attempt.maxScore, `${attempt.id}: invalid score`);
    invariant(attempt.target.kind === (attempt.kind === 'question' ? 'question' : 'sense'), `${attempt.id}: invalid target kind`);
  }
  for (const mistake of state.mistakes) {
    unique(mistake.attemptIds, 'mistake attempt');
    for (const id of mistake.attemptIds) {
      const attempt = attempts.get(id);
      invariant(attempt && attempt.score < attempt.maxScore && targetKey(attempt.target) === targetKey(mistake.target), `Invalid mistake reference ${id}`);
    }
  }
}
