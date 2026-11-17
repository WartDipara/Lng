import type { Catalog, ContentPack, Question, Word } from './types.ts';
import type { LazyLibraryAccess } from './paged-library.ts';

export interface WordRow {
  id: string;
  headword: string;
  tags: string[];
  ready: string[];
}
export interface QuestionRow {
  id: string;
  title: string;
  type: string;
  tags: string[];
}
export interface BootProgress {
  phase: string;
  completed: number;
  total: number;
}
export interface BundleIndex {
  catalog: Catalog;
  words: WordRow[];
  questions: QuestionRow[];
  wordsSorted?: boolean;
  notices?: { title: string; text: string }[];
}
export interface BundleAccess {
  readonly lazy?: LazyLibraryAccess;
  index(onProgress?: (progress: BootProgress) => void): Promise<BundleIndex>;
  pack(file: string): Promise<ContentPack | null>;
}
export interface LibraryOverlay {
  catalog: Catalog;
  words: WordRow[];
  questions: QuestionRow[];
}

export const wordRow = (word: Word): WordRow => ({
  id: word.id,
  headword: word.headword,
  tags: word.tags,
  ready: word.senses.filter((sense) => sense.status === 'ready').map((sense) => sense.id),
});
export const questionRow = (question: Question): QuestionRow => ({
  id: question.id,
  title: question.title,
  type: question.type,
  tags: question.tags,
});
const wordCollator = new Intl.Collator('en');
export const compareWords = (a: WordRow, b: WordRow): number =>
  Number(b.ready.length > 0) - Number(a.ready.length > 0) ||
  wordCollator.compare(a.headword, b.headword);
