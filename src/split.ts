import type { ContentEntity, ContentPack } from './types.ts';
import { kinds } from './catalog.ts';
import { invariant, validatePack } from './validation.ts';

/** Split a self-contained pack in dependency order without losing any entity. */
export function* splitPack(
  input: ContentPack,
  prefix: string,
  batchSize = 2000,
): Generator<ContentPack> {
  validatePack(input);
  invariant(
    Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 10000,
    'Batch size must be 1..10000',
  );
  invariant(
    /^[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/.test(prefix) && prefix.length < 160,
    'Invalid split pack prefix',
  );
  let number = 0;
  let count = 0;
  let current: ContentPack | undefined;
  for (const kind of kinds)
    for (const entity of (input[kind] ?? []) as ContentEntity[]) {
      if (!current) {
        number++;
        current = {
          schemaVersion: 1,
          packId: `${prefix}-${String(number).padStart(4, '0')}`,
          packVersion: input.packVersion,
          createdAt: input.createdAt,
          requires:
            number === 1
              ? input.requires
              : [
                  {
                    packId: `${prefix}-${String(number - 1).padStart(4, '0')}`,
                    minVersion: input.packVersion,
                  },
                ],
          sources: [],
          vocabulary: [],
          passages: [],
          questions: [],
        };
      }
      (current[kind] as ContentEntity[]).push(entity);
      count++;
      if (count >= batchSize) {
        yield current;
        current = undefined;
        count = 0;
      }
    }
  if (current) yield current;
}
