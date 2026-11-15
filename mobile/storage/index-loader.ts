import type { BundleIndex, WordRow } from '../engine.ts';
import type { Catalog } from '../../src/types.ts';

export interface IndexShard {
  vocabulary: Catalog['entities']['vocabulary'];
  words: WordRow[];
}

/** Keep each native UTF-8 decode small: File.text() uses temporary Java buffers. */
export async function loadIndex(read: (asset: number) => Promise<unknown>, metadata: number, shards: number[]): Promise<BundleIndex> {
  const index = await read(metadata) as BundleIndex;
  for (const asset of shards) {
    const part = await read(asset) as IndexShard;
    Object.assign(index.catalog.entities.vocabulary, part.vocabulary);
    index.words.push(...part.words);
  }
  return index;
}
