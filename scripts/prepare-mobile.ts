import { buildPagedAssets } from './paged-assets.ts';
import type { CompressedResource } from '../src/paged-library.ts';
import { resourcePolicy } from '../src/policy.ts';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { VocabularyBundle } from './vocabulary-bundle.ts';
import { wordRow, questionRow, compareWords } from '../src/library-index.ts';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, emptyCatalog, kinds, planImport } from '../src/catalog.ts';
import type { ContentPack, ContentEntity } from '../src/types.ts';
import type { BundleIndex } from '../src/library-index.ts';
import { gunzipSync, gzipSync } from 'node:zlib';
import { splitPack } from '../src/split.ts';

const root = 'mobile/assets';
await mkdir(join(root, 'compressed'), { recursive: true });
// The immutable baseline and expansion archive together define the current library.

const index: BundleIndex = { catalog: emptyCatalog(), words: [], questions: [] };
index.notices = [];
for (const name of await readdir('data/notices'))
  if (/license/i.test(name) || name === 'wordlist-README.md')
    index.notices.push({ title: name, text: await readFile(join('data/notices', name), 'utf8') });
const registry: string[] = [];
const descriptors: Record<string, CompressedResource> = {};
const resourceFiles = new Set<string>();
async function saveResource(key: string, value: unknown) {
  const plain = Buffer.from(JSON.stringify(value));
  if (plain.length > resourcePolicy.maxDecodedBlockBytes)
    throw new Error(`Resource exceeds block budget: ${key}`);
  const compressed = gzipSync(plain, { level: 9 });
  const digest = createHash('sha256').update(compressed).digest('hex');
  const name = `${digest}.pack`;
  resourceFiles.add(name);
  await writeFile(join(root, 'compressed', name), compressed);
  descriptors[key] = { sha256: digest, bytes: compressed.length, decodedBytes: plain.length };
  registry.push(`  '${key}': require('./compressed/${name}'),`);
}
const vocabulary = new VocabularyBundle(index);
async function saveVocabularyPack(pack: ContentPack) {
  const digest = hash(pack);
  vocabulary.append(pack, digest + '.json');
  await saveResource(`pack/${digest}.json`, pack);
}
async function prepareBaseline() {
  const master: ContentPack = JSON.parse(
    gunzipSync(await readFile('data/vocabulary.json.gz')).toString('utf8'),
  );
  for (const pack of splitPack(master, 'vocab:initial')) await saveVocabularyPack(pack);
  for (const kind of kinds) {
    for (const entity of (master[kind] ?? []) as ContentEntity[]) {
      if (index.catalog.entities[kind][entity.id]?.[entity.revision]?.hash !== hash(entity)) {
        throw new Error(`Shard mismatch: ${entity.id}`);
      }
    }
  }
  index.catalog.packs[master.packId] = {
    version: master.packVersion,
    versions: { [master.packVersion]: hash(master) },
  };
}
await prepareBaseline();
const expansion = JSON.parse(await readFile('data/vocabulary-expansion.manifest.json', 'utf8')) as {
  archive: string;
  sha256: string;
  packs: { packId: string; words: number; bytes: number }[];
};
if (!/^[a-z0-9.-]+\.jsonl\.gz$/.test(expansion.archive))
  throw new Error('Invalid expansion archive path');
const expansionPath = join('data', expansion.archive);
const checksum = createHash('sha256');
for await (const chunk of createReadStream(expansionPath)) checksum.update(chunk);
if (checksum.digest('hex') !== expansion.sha256)
  throw new Error('Expansion archive checksum mismatch');
const lines = createInterface({
  input: createReadStream(expansionPath).pipe(createGunzip()),
  crlfDelay: Infinity,
});
let expandedPacks = 0;
for await (const line of lines) {
  const pack = JSON.parse(line) as ContentPack;
  const expected = expansion.packs[expandedPacks++];
  if (
    !expected ||
    expected.packId !== pack.packId ||
    expected.words !== pack.vocabulary?.length ||
    expected.bytes !== Buffer.byteLength(line)
  ) {
    throw new Error('Expansion archive inventory mismatch');
  }
  await saveVocabularyPack(pack);
}
if (expandedPacks !== expansion.packs.length) throw new Error('Expansion archive is incomplete');
index.words = vocabulary.finish();
const starter: ContentPack = JSON.parse(await readFile('data/starter.pack.json', 'utf8'));
const imported = planImport(index.catalog, starter);
index.catalog = imported.catalog;
await saveResource(`pack/${imported.digest}.json`, starter);
index.words.push(...(starter.vocabulary ?? []).map(wordRow));
index.questions.push(...(starter.questions ?? []).map(questionRow));
// Sort once on the build machine, not every time a phone opens the app.
index.words.sort(compareWords);
index.wordsSorted = true;
const manifest = await buildPagedAssets(index, descriptors, saveResource);
await saveResource('bootstrap', manifest);
const bootstrap = descriptors.bootstrap;
await writeFile(
  join(root, 'registry.ts'),
  `// Generated compressed offline assets.
export const bootstrapDescriptor = ${JSON.stringify(bootstrap)};
export const bootstrapAsset = require('./compressed/${bootstrap.sha256}.pack');
export const resourceAssets: Record<string, number> = {
${registry.join('\n')}
};
`,
);
// Remove only obsolete files produced by this generator; never traverse user storage.
for (const name of await readdir(join(root, 'compressed'))) {
  if (/^[a-f0-9]{64}\.pack$/.test(name) && !resourceFiles.has(name))
    await unlink(join(root, 'compressed', name));
}
for (const name of await readdir(root)) {
  if (/^index-\d+\.pack$/.test(name) || name === 'library.pack') await unlink(join(root, name));
}
try {
  for (const name of await readdir(join(root, 'packs'))) {
    if (/^[a-f0-9]{64}\.pack$/.test(name)) await unlink(join(root, 'packs', name));
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
await writeFile(join(root, 'bootstrap.json'), JSON.stringify(bootstrap));
console.log(
  JSON.stringify({
    words: manifest.wordCount,
    questions: index.questions.length,
    resources: Object.keys(descriptors).length,
    startupWords: manifest.index.words.length,
    bootstrapBytes: bootstrap.decodedBytes,
    searchPages: manifest.search.length,
  }),
);
