import { catalogEntry, hash, latest } from '../src/catalog.ts';
import { wordRow, type BundleIndex, type WordRow } from '../src/library-index.ts';
import { invariant, validatePack } from '../src/validation.ts';
import type { ContentPack, ContentEntity, Kind } from '../src/types.ts';

/** Build-time append adapter for vocabulary-only packs, retaining historical revisions.
 * Unlike interactive imports, this owns a fresh catalog and can update it in place.
 * Checking only new entities avoids copying/scanning a million-word index per shard.
 */
export class VocabularyBundle {
  private index: BundleIndex;
  private rows = new Map<string, WordRow>();
  private senseOwners = new Map<string, string>();

  constructor(index: BundleIndex) {
    this.index = index;
  }

  append(input: unknown, file: string): ContentPack {
    validatePack(input);
    const pack = input;
    invariant(
      !pack.questions?.length && !pack.passages?.length,
      'Vocabulary packs cannot contain tasks or passages',
    );
    invariant(!this.index.catalog.packs[pack.packId], `Duplicate bundled package: ${pack.packId}`);
    for (const dependency of pack.requires) {
      invariant(
        (this.index.catalog.packs[dependency.packId]?.version ?? 0) >= dependency.minVersion,
        `Missing bundled dependency: ${dependency.packId}`,
      );
    }
    for (const source of pack.sources) this.appendEntity('sources', source, file);
    for (const word of pack.vocabulary ?? []) {
      for (const source of [
        ...word.sourceIds,
        ...word.senses.flatMap((sense) => sense.sourceIds),
      ]) {
        invariant(this.index.catalog.entities.sources[source], `${word.id}: missing source`);
      }
      for (const sense of word.senses) {
        const owner = this.senseOwners.get(sense.id);
        invariant(!owner || owner === word.id, `Sense ID belongs to another word: ${sense.id}`);
        this.senseOwners.set(sense.id, word.id);
      }
      const current = latest(this.index.catalog.entities.vocabulary[word.id]);
      this.appendEntity('vocabulary', word, file);
      if (!current || word.revision >= current.revision) this.rows.set(word.id, wordRow(word));
    }
    this.index.catalog.packs[pack.packId] = {
      version: pack.packVersion,
      versions: { [pack.packVersion]: file.replace(/\.json$/, '') },
    };
    return pack;
  }

  private appendEntity(kind: Kind, entity: ContentEntity, file: string) {
    const versions = (this.index.catalog.entities[kind][entity.id] ??= {});
    const previous = versions[entity.revision];
    if (previous) {
      invariant(
        previous.hash === hash(entity),
        `Bundled revision conflict: ${entity.id}@${entity.revision}`,
      );
      return;
    }
    versions[entity.revision] = catalogEntry(kind, entity, file);
  }

  finish(): WordRow[] {
    return [...this.rows.values()];
  }
}
