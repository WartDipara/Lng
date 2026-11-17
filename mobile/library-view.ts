import { kinds } from '../src/catalog.ts';
import {
  compareWords,
  type BootProgress,
  type BundleIndex,
  type LibraryOverlay,
  type WordRow,
} from '../src/library-index.ts';
import type { Catalog } from '../src/types.ts';
import { libraryPolicy } from '../src/policy.ts';
import { yieldToUI } from '../src/serial-queue.ts';

type SenseOwners = Map<string, { wordId: string; revision: number }>;

async function overlayCatalog(base: Catalog, overlay: Catalog): Promise<Catalog> {
  if (!Object.keys(overlay.packs).length) return base;
  const result: Catalog = {
    schemaVersion: 1,
    packs: { ...base.packs, ...overlay.packs },
    entities: { sources: {}, vocabulary: {}, passages: {}, questions: {} },
  };
  for (const kind of kinds) {
    const changes = overlay.entities[kind];
    if (!Object.keys(changes).length) {
      result.entities[kind] = base.entities[kind];
      continue;
    }
    let copied = 0;
    // Avoid allocating a second 131k-entry Object.entries/tuple array.
    for (const entityId in base.entities[kind]) {
      result.entities[kind][entityId] = base.entities[kind][entityId];
      if (++copied % libraryPolicy.batchSize === 0) await yieldToUI();
    }
    for (const entityId in changes)
      result.entities[kind][entityId] = { ...base.entities[kind][entityId], ...changes[entityId] };
  }
  return result;
}

export async function buildLibraryView(
  base: BundleIndex,
  overlay: LibraryOverlay,
  previous: { catalog: Catalog; senseOwners: SenseOwners },
  onProgress?: (progress: BootProgress) => void,
) {
  onProgress?.({ phase: 'Preparing library', completed: 0, total: 1 });
  await yieldToUI();
  const catalog = await overlayCatalog(base.catalog, overlay.catalog);
  let words: WordRow[];
  if (base.wordsSorted && !overlay.words.length) {
    // The shipped word index is sorted at build time; no cold-start map or sort.
    words = base.words;
  } else if (base.wordsSorted) {
    const changedIds = new Set(overlay.words.map((word) => word.id));
    const changed = [...overlay.words].sort(compareWords);
    words = [];
    let changedAt = 0;
    let completed = 0;
    for (const word of base.words) {
      if (!changedIds.has(word.id)) {
        while (changedAt < changed.length && compareWords(changed[changedAt], word) < 0)
          words.push(changed[changedAt++]);
        words.push(word);
      }
      if (++completed % libraryPolicy.batchSize === 0) {
        onProgress?.({ phase: 'Preparing words', completed, total: base.words.length });
        await yieldToUI();
      }
    }
    while (changedAt < changed.length) words.push(changed[changedAt++]);
  } else {
    // Compatibility path for older indexes and small test bundles.
    const wordMap = new Map<string, WordRow>();
    let completed = 0;
    for (const word of base.words) {
      wordMap.set(word.id, word);
      if (++completed % libraryPolicy.batchSize === 0) await yieldToUI();
    }
    for (const word of overlay.words) wordMap.set(word.id, word);
    words = [...wordMap.values()].sort(compareWords);
  }
  onProgress?.({ phase: 'Preparing words', completed: words.length, total: words.length });
  await yieldToUI();
  const questionMap = new Map(base.questions.map((q) => [q.id, q]));
  for (const q of overlay.questions) questionMap.set(q.id, q);
  const senseOwners =
    catalog.entities.vocabulary === previous.catalog.entities.vocabulary
      ? previous.senseOwners
      : new Map<string, { wordId: string; revision: number }>();
  let completed = 0;
  if (senseOwners !== previous.senseOwners)
    for (const wordId in catalog.entities.vocabulary) {
      const revisions = catalog.entities.vocabulary[wordId];
      for (const revision in revisions) {
        const version = revisions[revision];
        const owner = { wordId, revision: version.revision };
        for (const senseId of version.senseIds ?? []) {
          const old = senseOwners.get(senseId);
          if (!old || version.revision > old.revision) senseOwners.set(senseId, owner);
        }
      }
      if (++completed % libraryPolicy.batchSize === 0) {
        onProgress?.({ phase: 'Preparing meanings', completed, total: words.length });
        await yieldToUI();
      }
    }
  onProgress?.({ phase: 'Preparing meanings', completed: words.length, total: words.length });
  return { catalog, words, questions: [...questionMap.values()], senseOwners };
}
