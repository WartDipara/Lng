/** Integration measurements use actual compressed assets in a fresh Node process. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StudyEngine } from '../mobile/engine.ts';
import { CompressedResources, decodeResource } from '../mobile/storage/compressed-resources.ts';
import { createPagedBundle } from '../mobile/storage/paged-bundle.ts';
import type { CompressedResource, PagedLibrary } from '../src/paged-library.ts';
import { resourcePolicy } from '../src/policy.ts';
import type { JsonIO } from '../mobile/storage/snapshot-store.ts';

const root = 'mobile/assets';
const started = performance.now();
const descriptor = JSON.parse(
  await readFile(join(root, 'bootstrap.json'), 'utf8'),
) as CompressedResource;
const manifest = decodeResource(
  await readFile(join(root, 'compressed', descriptor.sha256 + '.pack')),
  descriptor,
) as PagedLibrary;
const reads: string[] = [];
const resources = new CompressedResources(async (key) => {
  reads.push(key);
  return readFile(join(root, 'compressed', manifest.resources[key].sha256 + '.pack'));
}, manifest.resources);
const files = new Map<string, string>();
const io: JsonIO = {
  read: async (path) => files.get(path) ?? null,
  write: async (path, text) => {
    files.set(path, text);
  },
};
const engine = new StudyEngine(io, createPagedBundle(manifest, resources));
await engine.initialize();
const startupSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
const startupRssMiB = Math.round(process.memoryUsage().rss / 1024 / 1024);
assert.equal(reads.length, 0, 'Startup loaded resource pages');
assert.equal(engine.words.length, manifest.readyCount);
const report = JSON.parse(await readFile('data/collection-report.json', 'utf8'));
const starter = JSON.parse(await readFile('data/starter.pack.json', 'utf8'));
assert.equal(engine.wordCount, report.headwords + starter.vocabulary.length);
assert.equal(engine.questions.length, starter.questions.length);
const timings: { query: string; milliseconds: number; blocks: number }[] = [];
for (const query of ['apple', 'A-bombs', 'abactinally', 'zymurgy', 'zzzzzznotaword']) {
  const before = reads.length;
  const at = performance.now();
  const matches = await engine.findWords(query);
  timings.push({
    query,
    milliseconds: Math.round(performance.now() - at),
    blocks: reads.length - before,
  });
  if (query.startsWith('zzzzzz')) {
    assert.equal(matches.length, 0);
    continue;
  }
  const found = matches.find((row) => row.headword === query);
  assert.ok(found, `Missing searchable word: ${query}`);
  const word = await engine.word(found.id);
  assert.equal(word?.headword, query);
  if (query === 'A-bombs') assert.ok(word.senses.length);
  if (query === 'abactinally') assert.equal(word.status, 'headword-only');
  if (query === 'apple') {
    assert.ok(await engine.word(found.id, 1));
    assert.ok(await engine.word(found.id, 2));
  }
}
const beforeQuestion = reads.length;
const question = await engine.question(engine.questions[0].id);
assert.ok(question);
if (question.passageId)
  assert.ok(await engine.passage(question.passageId, question.passageRevision!));
assert.ok(reads.length >= beforeQuestion);
// Cross enough pages to exercise eviction; vocabulary metadata must not accumulate in the engine.
for (const query of [
  'banana',
  'garden',
  'window',
  'yellow',
  'book',
  'energy',
  'flower',
  'government',
  'information',
  'justice',
  'knowledge',
  'language',
  'mountain',
  'nature',
  'ocean',
  'people',
  'question',
  'river',
  'science',
  'technology',
  'university',
  'village',
  'world',
  'xylophone',
  'young',
  'zebra',
]) {
  await engine.findWords(query, '', false, 5);
}
assert.ok(resources.metrics.peakCachedBytes <= resourcePolicy.cacheDecodedBytes);
assert.equal(Object.keys(engine.catalog.entities.vocabulary).length, manifest.readyCount);
const result = {
  words: engine.wordCount,
  residentWordSummaries: engine.words.length,
  questions: engine.questions.length,
  startupSeconds,
  startupRssMiB,
  afterQueriesRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  cache: resources.metrics,
  timings,
  note: 'Node measurements, not Android device acceptance; cache budget counts decoded JSON bytes.',
};
await writeFile('.local/paged-library-verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
