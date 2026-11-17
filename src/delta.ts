import type { ContentEntity, ContentPack } from './types.ts';
import { canonical, kinds } from './catalog.ts';
import { invariant, validatePack } from './validation.ts';

/** Compare two full snapshots. An omitted entity is never a delete instruction. */
export function createDelta(
  base: ContentPack,
  desired: ContentPack,
  packId: string,
  createdAt: string,
): ContentPack {
  validatePack(base);
  validatePack(desired);
  invariant(packId !== base.packId, 'Use a unique namespace-qualified ID for each delta pack');
  const delta: ContentPack = {
    schemaVersion: 1,
    packId,
    packVersion: 1,
    createdAt,
    requires: [{ packId: base.packId, minVersion: base.packVersion }],
    sources: [],
  };
  for (const kind of kinds) {
    const previous = new Map(((base[kind] ?? []) as ContentEntity[]).map((e) => [e.id, e]));
    const changed: ContentEntity[] = [];
    for (const entity of (desired[kind] ?? []) as ContentEntity[]) {
      const old = previous.get(entity.id);
      if (!old) {
        changed.push(structuredClone(entity));
        continue;
      }
      if (canonical({ ...old, revision: 0 }) === canonical({ ...entity, revision: 0 })) continue;
      changed.push({
        ...structuredClone(entity),
        revision: Math.max(old.revision + 1, entity.revision),
      });
    }
    (delta as unknown as Record<string, unknown>)[kind] = changed;
  }
  // A passage revision changes the exact text referenced by a question: bring affected
  // questions into the delta as new revisions, even if their wording did not change.
  const revisedPassages = new Map((delta.passages ?? []).map((p) => [p.id, p.revision]));
  for (const question of desired.questions ?? []) {
    const revision = question.passageId && revisedPassages.get(question.passageId);
    if (!revision) continue;
    const old = base.questions?.find((q) => q.id === question.id);
    const adjusted = {
      ...structuredClone(question),
      passageRevision: revision,
      revision: Math.max(question.revision, (old?.revision ?? 0) + 1),
    };
    const index = delta.questions!.findIndex((q) => q.id === question.id);
    if (index < 0) delta.questions!.push(adjusted);
    else delta.questions![index] = adjusted;
  }
  validatePack(delta);
  return delta;
}
