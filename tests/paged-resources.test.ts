import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import { emptyCatalog, hash, planImport } from '../src/catalog.ts';
import { wordRow, questionRow, type BundleIndex } from '../src/library-index.ts';
import type { ContentPack } from '../src/types.ts';
import type { CompressedResource } from '../src/paged-library.ts';
import { buildPagedAssets } from '../scripts/paged-assets.ts';
import {
  CompressedResources,
  encodeResource,
  decodeResource,
} from '../mobile/storage/compressed-resources.ts';
import { createPagedBundle } from '../mobile/storage/paged-bundle.ts';
import { StudyEngine } from '../mobile/engine.ts';
import { learningProgress, meaningOf } from '../src/word-learning.ts';
import { newStudyTargets } from '../mobile/study-selection.ts';
import type { JsonIO } from '../mobile/storage/snapshot-store.ts';

async function setup() {
  const original = structuredClone(fixture) as ContentPack;
  const vocabulary: ContentPack = { ...original, passages: [], questions: [] };
  vocabulary.vocabulary![0].status = 'reference';
  vocabulary.vocabulary![0].senses.forEach((sense) => {
    sense.status = 'reference';
  });
  const practice: ContentPack = {
    ...original,
    packId: 'test:practice',
    sources: [],
    vocabulary: [],
    requires: [{ packId: vocabulary.packId, minVersion: 1 }],
  };
  const first = planImport(emptyCatalog(), vocabulary);
  const second = planImport(first.catalog, practice);
  const index: BundleIndex = {
    catalog: second.catalog,
    words: vocabulary.vocabulary!.map(wordRow),
    questions: practice.questions!.map(questionRow),
    wordsSorted: true,
    notices: [{ title: 'License', text: 'Attribution' }],
  };
  const bytes = new Map<string, Uint8Array>();
  const descriptors: Record<string, CompressedResource> = {};
  async function save(key: string, value: unknown) {
    const encoded = encodeResource(value);
    bytes.set(key, encoded.bytes);
    descriptors[key] = encoded.descriptor;
  }
  await save(`pack/${first.digest}.json`, vocabulary);
  await save(`pack/${second.digest}.json`, practice);
  const manifest = await buildPagedAssets(index, descriptors, save);
  const reads: string[] = [];
  const resources = new CompressedResources(
    async (key) => {
      reads.push(key);
      return bytes.get(key)!;
    },
    descriptors,
    100_000,
  );
  const bundle = createPagedBundle(manifest, resources);
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const io: JsonIO = {
    read: async (path) => text.get(path) ?? null,
    write: async (path, value) => {
      text.set(path, value);
    },
    readBytes: async (path) => binary.get(path) ?? null,
    writeBytes: async (path, value) => {
      binary.set(path, value);
    },
  };
  const engine = new StudyEngine(io, bundle);
  await engine.initialize();
  return {
    engine,
    io,
    bundle,
    resources,
    reads,
    binary,
    text,
    vocabulary,
    practice,
    first,
    second,
  };
}

test('an unfinished lazy word survives restart and backup without a review or mistake', async () => {
  const { engine, io, bundle, vocabulary } = await setup();
  const word = vocabulary.vocabulary![0];
  const sense = word.senses[0];
  const target = { kind: 'sense' as const, id: sense.id, revision: word.revision };
  await engine.learningStep({
    id: 'learning:durable',
    target,
    stage: 'choice',
    response: meaningOf(sense),
    createdAt: new Date().toISOString(),
  });
  assert.equal(engine.user.reviews.length, 0);
  assert.equal(engine.user.mistakes.length, 0);
  const restarted = new StudyEngine(io, bundle);
  await restarted.initialize();
  assert.equal(learningProgress(restarted.user, target), 'recognize');
  assert.ok(restarted.targetExists(target));
  assert.deepEqual(newStudyTargets(restarted), [target]);
  const restored = new StudyEngine({ read: async () => null, write: async () => {} }, bundle);
  await restored.initialize();
  await restored.restore(await restarted.backup());
  assert.equal(learningProgress(restored.user, target), 'recognize');
});

test('cold start reads summaries only; Use of English, passages and words load on demand', async () => {
  const { engine, resources, reads, first, second, vocabulary, practice } = await setup();
  assert.equal(engine.wordCount, 1);
  assert.equal(engine.words.length, 0);
  assert.equal(Object.keys(engine.catalog.entities.vocabulary).length, 0);
  assert.equal(reads.length, 0);
  const question = await engine.question(practice.questions![0].id);
  assert.ok(question);
  await engine.passage(question.passageId!, question.passageRevision!);
  assert.deepEqual(reads, [`pack/${second.digest}.json`]);
  assert.equal((await engine.findWords('CONTINGENT'))[0].headword, 'contingent');
  assert.ok(!reads.includes(`pack/${first.digest}.json`));
  assert.equal((await engine.word(vocabulary.vocabulary![0].id))?.headword, 'contingent');
  assert.ok(reads.includes(`pack/${first.digest}.json`));
  assert.deepEqual(await engine.notices(), [{ title: 'License', text: 'Attribution' }]);
  assert.ok(resources.metrics.peakCachedBytes <= 100_000);
});

test('practice loads only the selected set and restores its draft without vocabulary payloads', async () => {
  const { engine, io, bundle, reads, first } = await setup();
  const sessionId = await engine.startPractice(
    1,
    engine.questions.map((question) => question.id),
  );
  assert.equal(engine.user.practiceSessions![0].items.length, 1);
  await engine.savePracticeAnswer(sessionId, 0, null);
  const restart = new StudyEngine(io, bundle);
  await restart.initialize();
  assert.deepEqual(restart.user.practiceSessions, engine.user.practiceSessions);
  await restart.submitPractice(sessionId);
  assert.ok(restart.user.practiceSessions![0].submittedAt);
  assert.ok(!reads.includes(`pack/${first.digest}.json`));
});

test('lazy imports retain old revisions, compress saved content and recover pinned targets', async () => {
  const { engine, io, bundle, binary, text, vocabulary } = await setup();
  const old = vocabulary.vocabulary![0];
  const target = { kind: 'sense' as const, id: old.senses[0].id, revision: 1 };
  await engine.note({
    id: 'note:pinned',
    title: 'Saved meaning',
    body: '',
    tags: [],
    target,
    createdAt: vocabulary.createdAt,
    updatedAt: vocabulary.createdAt,
  });
  const word = structuredClone(old);
  word.revision++;
  word.tags.push('IMPORTED');
  const update: ContentPack = {
    schemaVersion: 1,
    packId: 'test:update',
    packVersion: 1,
    createdAt: vocabulary.createdAt,
    requires: [{ packId: vocabulary.packId, minVersion: 1 }],
    sources: [],
    vocabulary: [word],
  };
  await engine.import(update);
  assert.equal(engine.wordCount, 1);
  assert.equal((await engine.findWords('contingent', 'IMPORTED')).length, 1);
  assert.equal(binary.size, 1);
  assert.ok([...binary.keys()][0].endsWith('.json.gz'));
  assert.ok(!text.has(`packs/${hash(update)}.json`));
  const restart = new StudyEngine(io, bundle);
  await restart.initialize();
  assert.equal(restart.targetExists(target), true);
  assert.equal((await restart.word(word.id, 1))?.revision, 1);
  assert.equal((await restart.word(word.id))?.revision, 2);
  assert.deepEqual((await restart.backup()).packs, [update]);
});

test('lazy import validation catches a sense owned by an unloaded word before any writes', async () => {
  const { engine, vocabulary, text, binary } = await setup();
  const before = text.size;
  const word = structuredClone(vocabulary.vocabulary![0]);
  word.id = 'test:other-word';
  const pack: ContentPack = {
    schemaVersion: 1,
    packId: 'test:collision',
    packVersion: 1,
    createdAt: vocabulary.createdAt,
    requires: [],
    sources: [],
    vocabulary: [word],
  };
  await assert.rejects(engine.import(pack), /belongs to another word/);
  assert.equal(text.size, before);
  assert.equal(binary.size, 0);
});

test('resource cache deduplicates readers, evicts by bytes and retries failed reads', async () => {
  const encoded = encodeResource({ value: 'some content' });
  let reads = 0;
  let fail = true;
  const cache = new CompressedResources(
    async () => {
      reads++;
      if (fail) {
        fail = false;
        throw new Error('read failed');
      }
      return encoded.bytes;
    },
    { a: encoded.descriptor, b: encoded.descriptor, c: encoded.descriptor },
    encoded.descriptor.decodedBytes * 2,
  );
  await assert.rejects(cache.load('a'), /read failed/);
  await Promise.all([cache.load('a'), cache.load('a')]);
  assert.equal(reads, 2);
  await cache.load('b');
  await cache.load('c');
  await cache.load('a');
  assert.equal(reads, 5);
  assert.equal(cache.metrics.cachedBlocks, 2);
  assert.ok(cache.metrics.peakCachedBytes <= encoded.descriptor.decodedBytes * 2);
});

test('corrupt resources and cancelled searches fail without decoding unchecked content', async () => {
  const encoded = encodeResource({ value: 'valid' });
  const damaged = encoded.bytes.slice();
  damaged[10] ^= 1;
  assert.throws(() => decodeResource(damaged, encoded.descriptor), /checksum/);
  assert.throws(
    () => decodeResource(encoded.bytes, { ...encoded.descriptor, decodedBytes: 99999999 }),
    /budget/,
  );
  const { engine, reads } = await setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    engine.findWords('contingent', '', false, 100, controller.signal),
    /cancelled/,
  );
  assert.equal(reads.length, 0);
});
