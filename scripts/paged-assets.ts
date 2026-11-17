import { emptyCatalog, kinds } from '../src/catalog.ts';
import type { BundleIndex, WordRow } from '../src/library-index.ts';
import {
  bucketFor,
  searchGrams,
  type CompressedResource,
  type LookupPage,
  type PagedLibrary,
} from '../src/paged-library.ts';
import { libraryPolicy, resourcePolicy } from '../src/policy.ts';

export async function buildPagedAssets(
  index: BundleIndex,
  resources: Record<string, CompressedResource>,
  save: (key: string, value: unknown) => Promise<void>,
): Promise<PagedLibrary> {
  const lookup = Array.from(
    { length: resourcePolicy.lookupBuckets },
    (): LookupPage => ({ entities: emptyCatalog().entities, words: {}, senses: {} }),
  );
  const bucket = (id: string) => lookup[bucketFor(id, lookup.length)];
  for (const kind of kinds)
    for (const id in index.catalog.entities[kind]) {
      const versions = index.catalog.entities[kind][id];
      bucket(id).entities[kind][id] = versions;
      if (kind === 'vocabulary')
        for (const entry of Object.values(versions))
          for (const senseId of entry.senseIds ?? []) {
            const old = bucket(senseId).senses[senseId];
            if (!old || entry.revision > old.revision)
              bucket(senseId).senses[senseId] = { wordId: id, revision: entry.revision };
          }
    }
  for (const row of index.words) bucket(row.id).words[row.id] = row;
  for (let i = 0; i < lookup.length; i++) await save(`lookup/${i}`, lookup[i]);

  const search: PagedLibrary['search'] = [];
  const postings = new Map<string, number[]>();
  async function searchPage(rows: WordRow[]): Promise<void> {
    // The byte limit also covers unusually long imported headwords and tags.
    if (JSON.stringify(rows).length * 3 > resourcePolicy.maxDecodedBlockBytes) {
      if (rows.length < 2) throw new Error('A search row exceeds the resource budget');
      const mid = Math.floor(rows.length / 2);
      await searchPage(rows.slice(0, mid));
      await searchPage(rows.slice(mid));
      return;
    }
    const pageId = search.length;
    const key = `search/${pageId}`;
    const grams = new Set<string>();
    const tags = new Set<string>();
    for (const word of rows) {
      for (const length of [3, 4])
        for (const gram of searchGrams(word.headword.toLowerCase(), length)) grams.add(gram);
      for (const tag of word.tags) tags.add(tag);
    }
    for (const gram of grams) {
      const ids = postings.get(gram) ?? [];
      ids.push(pageId);
      postings.set(gram, ids);
    }
    search.push({ key, tags: [...tags].sort(), ready: rows.some((row) => row.ready.length > 0) });
    await save(key, rows);
  }
  for (let offset = 0; offset < index.words.length; offset += libraryPolicy.batchSize) {
    await searchPage(index.words.slice(offset, offset + libraryPolicy.batchSize));
  }
  const gramBuckets = Array.from(
    { length: resourcePolicy.gramBuckets },
    () => ({}) as Record<string, number[]>,
  );
  for (const [gram, ids] of postings) gramBuckets[bucketFor(gram, gramBuckets.length)][gram] = ids;
  for (let i = 0; i < gramBuckets.length; i++) await save(`grams/${i}`, gramBuckets[i]);
  await save('notices', index.notices ?? []);

  const ready = index.words.filter((word) => word.ready.length);
  const readyEntries = Object.fromEntries(
    ready.map((word) => [word.id, index.catalog.entities.vocabulary[word.id]]),
  );
  const bootstrap: BundleIndex = {
    catalog: {
      ...index.catalog,
      entities: { ...index.catalog.entities, vocabulary: readyEntries },
    },
    words: ready,
    wordsSorted: true,
    questions: index.questions,
  };
  return {
    format: 2,
    index: bootstrap,
    wordCount: index.words.length,
    readyCount: ready.length,
    tags: [...new Set(search.flatMap((page) => page.tags))].sort(),
    lookupBuckets: lookup.length,
    gramBuckets: gramBuckets.length,
    maxGramLength: 4,
    search,
    resources,
  };
}
