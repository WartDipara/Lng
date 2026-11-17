import type { BundleIndex, WordRow } from './library-index.ts';
import type { Catalog, Entry } from './types.ts';

export interface CompressedResource {
  sha256: string;
  bytes: number;
  decodedBytes: number;
}
export interface SenseOwner {
  wordId: string;
  revision: number;
}
export interface LookupPage {
  entities: Catalog['entities'];
  words: Record<string, WordRow>;
  senses: Record<string, SenseOwner>;
}
export interface PagedLibrary {
  format: 2;
  index: BundleIndex;
  wordCount: number;
  readyCount: number;
  tags: string[];
  lookupBuckets: number;
  gramBuckets: number;
  maxGramLength: number;
  search: { key: string; tags: string[]; ready: boolean }[];
  resources: Record<string, CompressedResource>;
}
export interface WordSearch {
  query: string;
  tag?: string;
  readyOnly?: boolean;
  limit: number;
  excludeIds?: Set<string>;
  signal?: AbortSignal;
}
export interface LazyLibraryAccess {
  external(
    key: string,
    descriptor: CompressedResource,
    read: () => Promise<Uint8Array>,
  ): Promise<unknown>;
  metadata: Pick<PagedLibrary, 'wordCount' | 'readyCount' | 'tags'>;
  versions(kind: keyof Catalog['entities'], id: string): Promise<Record<string, Entry> | undefined>;
  row(id: string): Promise<WordRow | undefined>;
  owner(senseId: string): Promise<SenseOwner | undefined>;
  search(input: WordSearch): Promise<WordRow[]>;
  notices(): Promise<NonNullable<BundleIndex['notices']>>;
}

/** Stable across Node, Hermes and browsers; independent of locale and hash libraries. */
export function bucketFor(value: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % count;
}
export function searchGrams(value: string, length = 3): string[] {
  const result = new Set<string>();
  for (let i = 0; i <= value.length - length; i++) result.add(value.slice(i, i + length));
  return [...result];
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Search cancelled');
    error.name = 'AbortError';
    throw error;
  }
}
