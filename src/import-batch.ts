import { planImport } from './catalog.ts';
import { invariant, validatePack } from './validation.ts';
import type { Catalog, ContentPack } from './types.ts';

/** Validate the entire batch before callers persist anything. */
export async function planImportBatch(
  catalog: Catalog,
  inputs: unknown[],
  onProgress?: (completed: number) => Promise<void>,
) {
  const remaining = inputs.map((input) => {
    validatePack(input);
    return input;
  });
  const packs: ContentPack[] = [];
  const counts = { added: 0, updated: 0, skipped: 0 };
  let simulated = catalog;
  while (remaining.length) {
    const position = remaining.findIndex(
      (pack) =>
        pack.requires.every(
          (required) => (simulated.packs[required.packId]?.version ?? 0) >= required.minVersion,
        ) &&
        !remaining.some(
          (other) => other.packId === pack.packId && other.packVersion < pack.packVersion,
        ),
    );
    invariant(
      position >= 0,
      'A required earlier content package is missing or dependencies are cyclic.',
    );
    const pack = remaining.splice(position, 1)[0];
    const result = planImport(simulated, pack);
    simulated = result.catalog;
    packs.push(pack);
    counts.added += result.counts.added;
    counts.updated += result.counts.updated;
    counts.skipped += result.counts.skipped;
    await onProgress?.(packs.length);
  }
  return { catalog: simulated, packs, counts };
}
