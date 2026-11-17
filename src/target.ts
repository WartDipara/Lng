import type { Target } from './types.ts';

/** Stable identity shared by reviews, mistakes and practice results. */
export const targetKey = (target: Target): string =>
  `${target.kind}:${target.id}@${target.revision}`;
