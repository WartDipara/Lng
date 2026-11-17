import type { BundleAccess, WordRow } from '../../src/library-index.ts';
import {
  bucketFor,
  checkCancelled,
  searchGrams,
  type LookupPage,
  type PagedLibrary,
} from '../../src/paged-library.ts';
import type { ContentPack } from '../../src/types.ts';
import { CompressedResources } from './compressed-resources.ts';

export function createPagedBundle(
  manifest: PagedLibrary,
  resources: CompressedResources,
): BundleAccess {
  const page = (id: string) =>
    resources.load<LookupPage>(`lookup/${bucketFor(id, manifest.lookupBuckets)}`);
  return {
    index: async (progress) => {
      progress?.({ phase: 'Opening library directory', completed: 1, total: 1 });
      return manifest.index;
    },
    pack: async (file) =>
      manifest.resources[`pack/${file}`] ? resources.load<ContentPack>(`pack/${file}`) : null,
    lazy: {
      external: (key, descriptor, read) => resources.load(key, undefined, { descriptor, read }),
      metadata: manifest,
      versions: async (kind, id) => (await page(id)).entities[kind][id],
      row: async (id) => (await page(id)).words[id],
      owner: async (id) => (await page(id)).senses[id],
      notices: () => resources.load('notices'),
      async search(input) {
        const needle = input.query.trim().toLowerCase();
        let candidates: Set<number> | undefined;
        for (const gram of needle.length >= 3
          ? searchGrams(needle, Math.min(needle.length, manifest.maxGramLength))
          : []) {
          const postings = await resources.load<Record<string, number[]>>(
            `grams/${bucketFor(gram, manifest.gramBuckets)}`,
            input.signal,
          );
          const matches = postings[gram] ?? [];
          candidates = candidates
            ? new Set(matches.filter((id) => candidates!.has(id)))
            : new Set(matches);
          if (!candidates.size) return [];
        }
        const result: WordRow[] = [];
        const seen = new Set<string>();
        if (input.limit <= 0) return result;
        for (let i = 0; i < manifest.search.length; i++) {
          checkCancelled(input.signal);
          const descriptor = manifest.search[i];
          if (
            (candidates && !candidates.has(i)) ||
            (input.tag && !descriptor.tags.includes(input.tag)) ||
            (input.readyOnly && !descriptor.ready)
          )
            continue;
          const rows = await resources.load<WordRow[]>(descriptor.key, input.signal);
          for (const row of rows) {
            if (
              input.excludeIds?.has(row.id) ||
              (input.readyOnly && !row.ready.length) ||
              (input.tag && !row.tags.includes(input.tag)) ||
              (needle && !row.headword.toLowerCase().includes(needle)) ||
              seen.has(row.headword)
            )
              continue;
            result.push(row);
            seen.add(row.headword);
            if (result.length >= input.limit) return result;
          }
        }
        return result;
      },
    },
  };
}
