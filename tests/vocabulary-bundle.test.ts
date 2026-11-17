import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import { emptyCatalog, hash, planImport } from '../src/catalog.ts';
import type { ContentPack } from '../src/types.ts';
import type { BundleIndex } from '../src/library-index.ts';
import { VocabularyBundle } from '../scripts/vocabulary-bundle.ts';

function initial(): ContentPack {
  const pack = structuredClone(fixture) as ContentPack;
  pack.passages = [];
  pack.questions = [];
  return pack;
}

test('bundle assembly matches imports and preserves old word revisions', () => {
  const index: BundleIndex = { catalog: emptyCatalog(), words: [], questions: [] };
  const builder = new VocabularyBundle(index);
  const base = initial();
  const added = structuredClone(base.vocabulary![0]);
  added.revision++;
  added.tags.push('NEW-SOURCE');
  const update: ContentPack = {
    schemaVersion: 1,
    packId: 'test:expansion',
    packVersion: 1,
    createdAt: base.createdAt,
    requires: [{ packId: base.packId, minVersion: 1 }],
    sources: [],
    vocabulary: [added],
  };
  builder.append(base, hash(base) + '.json');
  builder.append(update, hash(update) + '.json');
  const expected = planImport(planImport(emptyCatalog(), base).catalog, update).catalog;
  assert.deepEqual(index.catalog, expected);
  assert.equal(builder.finish().length, 1);
  assert.equal(Object.keys(index.catalog.entities.vocabulary[added.id]).length, 2);
});

test('bundle assembly rejects missing dependencies and conflicting revision content', () => {
  const index: BundleIndex = { catalog: emptyCatalog(), words: [], questions: [] };
  const builder = new VocabularyBundle(index);
  const base = initial();
  const missing = { ...base, requires: [{ packId: 'test:missing', minVersion: 1 }] };
  assert.throws(
    () => builder.append(missing, hash(missing) + '.json'),
    /Missing bundled dependency/,
  );
  builder.append(base, hash(base) + '.json');
  const conflict = initial();
  conflict.packId = 'test:conflict';
  conflict.vocabulary![0].tags.push('CONFLICT');
  assert.throws(() => builder.append(conflict, hash(conflict) + '.json'), /revision conflict/);
});
