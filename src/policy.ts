/** Product defaults. Persisted schema limits are read from the schema itself. */
import userSchema from '../schemas/user-state.v1.schema.json' with { type: 'json' };

export const practicePolicy = {
  defaultSize: 10,
  minSize: userSchema.properties.practiceSize.minimum,
  maxSize: userSchema.properties.practiceSize.maximum,
} as const;
export const learningPolicy = { defaultDailyNewLimit: 10, millisecondsPerDay: 86_400_000 } as const;

/** Resource budgets shared by asset generation and runtime indexing. */
export const libraryPolicy = {
  batchSize: 2_000,
  maxIndexShardBytes: 2 * 1024 * 1024,
  cachedPacks: 3,
  searchLimit: 100,
  assetTimeoutMs: 30_000,
} as const;

export const resourcePolicy = {
  maxDecodedBlockBytes: 4 * 1024 * 1024,
  cacheDecodedBytes: 8 * 1024 * 1024,
  lookupBuckets: 1024,
  gramBuckets: 64,
} as const;
