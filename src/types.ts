export interface Source {
  id: string; revision: number; title: string; url: string; license: string;
  usage: 'lexical-metadata-only' | 'attributed-content' | 'original' | 'reference-only';
  retrievedAt: string; sourceRevision?: string; sha256?: string;
}
export interface Entity { id: string; revision: number; sourceIds: string[] }
export interface Sense {
  id: string; partOfSpeech: string; sourceIds: string[]; definition: string | null;
  simpleDefinition: string | null; examples: string[]; synonyms: string[];
  synonymNote: string | null; collocations: string[]; status: 'reference' | 'draft' | 'ready';
}
export interface Word extends Entity {
  headword: string; variants: string[]; tags: string[];
  cefr: null | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  senses: Sense[]; status: 'headword-only' | 'reference' | 'draft' | 'ready';
}
export interface Passage extends Entity {
  title: string; paragraphs: { id: string; text: string }[];
  publishedAt?: string; verifiedAt?: string;
}
export interface Option { id: string; text: string }
export type Interaction =
  | { kind: 'choice'; options: Option[]; correctIds: string[]; multiple: boolean }
  | { kind: 'text'; fields: { id: string; prompt: string; accepted: string[]; caseSensitive: boolean; maxWords: number }[] }
  | { kind: 'matching'; prompts: Option[]; options: Option[]; pairs: { promptId: string; optionId: string }[]; reuseOptions: boolean }
  | { kind: 'ordering'; items: Option[]; correctOrder: string[] };
export type QuestionType = 'comprehension' | 'error-identification' | 'sentence-completion' | 'paragraph-improvement'
  | 'true-false-not-given' | 'yes-no-not-given' | 'matching-headings' | 'matching-information' | 'matching-features'
  | 'matching-sentence-endings' | 'summary-completion' | 'note-completion' | 'table-completion' | 'flowchart-completion'
  | 'diagram-labelling' | 'short-answer' | 'multiple-choice-cloze' | 'open-cloze' | 'word-formation'
  | 'key-word-transformation' | 'dialogue' | 'scenario';
export interface Question extends Entity {
  type: QuestionType; origin: 'original' | 'official-sample' | 'past-paper';
  title: string; instructions: string; prompt: string; passageId?: string; passageRevision?: number;
  interaction: Interaction; explanation: string; optionExplanations?: Record<string, string>;
  evidenceParagraphIds: string[]; senseIds: string[]; tags: string[];
  layout?: { kind: 'table' | 'flowchart' | 'diagram'; rows?: string[][]; steps?: string[];
    imageDataUri?: string; altText?: string; labels?: { fieldId: string; x: number; y: number }[] };
  exam?: { name: string; year?: number; reference: string };
}
export interface ContentPack {
  schemaVersion: 1; packId: string; packVersion: number; createdAt: string;
  requires: { packId: string; minVersion: number }[]; sources: Source[];
  vocabulary?: Word[]; passages?: Passage[]; questions?: Question[];
}
export type Kind = 'sources' | 'vocabulary' | 'passages' | 'questions';
export type ContentEntity = Source | Word | Passage | Question;
export interface Entry {
  revision: number; hash: string; file: string;
  sourceIds?: string[]; senseIds?: string[]; paragraphIds?: string[];
}
export interface Catalog {
  schemaVersion: 1;
  packs: Record<string, { version: number; versions: Record<string, string> }>;
  entities: Record<Kind, Record<string, Record<string, Entry>>>;
}
export interface Target { kind: 'question' | 'sense'; id: string; revision: number }
export interface Note { id: string; title: string; body: string; tags: string[]; target?: Target; createdAt: string; updatedAt: string }
export interface Attempt { id: string; target: Target; kind: 'question' | 'spelling' | 'recall'; answer: unknown; score: number; maxScore: number; createdAt: string }
export interface UserState {
  schemaVersion: 1; notes: Note[]; attempts: Attempt[];
  mistakes: { target: Target; attemptIds: string[]; mastered: boolean; updatedAt: string }[];
  reviews: { target: Target; dueAt: string; intervalDays: number; ease: number; repetitions: number }[];
  settings: { dailyNewLimit: number; selectedTags: string[] };
}
