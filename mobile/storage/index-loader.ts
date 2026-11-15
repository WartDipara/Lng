import type { BootProgress, BundleIndex, WordRow } from '../engine.ts';
import type { Catalog } from '../../src/types.ts';

export interface IndexShard {
  vocabulary: Catalog['entities']['vocabulary'];
  words: WordRow[];
}

/** Keep each native UTF-8 decode small: File.text() uses temporary Java buffers. */
export async function loadIndex(read: (asset: number) => Promise<unknown>, metadata: number, shards: number[], onProgress?: (progress: BootProgress) => void): Promise<BundleIndex> {
  onProgress?.({ phase: 'Opening bundled library', completed: 0, total: 1 });
  const index = await read(metadata) as BundleIndex;
  for (let i = 0; i < shards.length; i++) {
    onProgress?.({ phase: 'Loading dictionary parts', completed: i, total: shards.length });
    // Release the JS thread between chunks so progress and touch events can render.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const asset = shards[i];
    const part = await read(asset) as IndexShard;
    Object.assign(index.catalog.entities.vocabulary, part.vocabulary);
    index.words.push(...part.words);
  }
  onProgress?.({ phase: 'Loading dictionary parts', completed: shards.length, total: shards.length });
  return index;
}
