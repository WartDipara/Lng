import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePack, validateUserState } from './validation.ts';
import { importPack, readContentSnapshot } from './store.ts';
import { createDelta } from './delta.ts';
import { emptyCatalog, planImport } from './catalog.ts';
import { splitPack } from './split.ts';

async function load(path: string) {
  if (!path) throw new Error('Missing file path');
  if ((await stat(path)).size > 256 * 1024 * 1024)
    throw new Error('Content package exceeds 256 MiB; split it into smaller packs');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate') {
    const pack = await load(args[0]);
    validatePack(pack);
    if (!pack.requires.length) planImport(emptyCatalog(), pack);
    console.log(
      JSON.stringify({
        valid: true,
        packId: pack.packId,
        vocabulary: pack.vocabulary?.length ?? 0,
        questions: pack.questions?.length ?? 0,
        dependenciesNeedImportCheck: pack.requires.length > 0,
      }),
    );
  } else if (command === 'validate-user') {
    validateUserState(await load(args[0]));
    console.log('User state valid');
  } else if (command === 'import') {
    if (!args[1]) throw new Error('Usage: import PACK STORE [--dry-run]');
    console.log(
      JSON.stringify(await importPack(args[1], await load(args[0]), args.includes('--dry-run'))),
    );
  } else if (command === 'split') {
    if (args.length < 3)
      throw new Error('Usage: split PACK OUTPUT_DIRECTORY PACK_PREFIX [BATCH_SIZE]');
    const pack = await load(args[0]);
    validatePack(pack);
    // A fresh output directory prevents accidental replacement of an earlier distribution.
    await mkdir(args[1]);
    const index: {
      schemaVersion: number;
      files: { file: string; packId: string; packVersion: number }[];
    } = { schemaVersion: 1, files: [] };
    for (const chunk of splitPack(pack, args[2], args[3] ? Number(args[3]) : 2000)) {
      const file = String(index.files.length + 1).padStart(4, '0') + '.pack.json';
      await writeFile(join(args[1], file), JSON.stringify(chunk) + '\n', { flag: 'wx' });
      index.files.push({ file, packId: chunk.packId, packVersion: chunk.packVersion });
    }
    await writeFile(join(args[1], 'index.json'), JSON.stringify(index, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(JSON.stringify({ output: args[1], packs: index.files.length }));
  } else if (command === 'delta-store') {
    if (args.length !== 4) throw new Error('Usage: delta-store STORE DESIRED OUTPUT PACK_ID');
    const { catalog, snapshot } = await readContentSnapshot(args[0]);
    const delta = createDelta(snapshot, await load(args[1]), args[3], new Date().toISOString());
    delta.requires = Object.entries(catalog.packs).map(([packId, p]) => ({
      packId,
      minVersion: p.version,
    }));
    planImport(catalog, delta);
    await writeFile(args[2], JSON.stringify(delta, null, 2) + '\n');
    console.log(
      JSON.stringify({
        output: args[2],
        vocabulary: delta.vocabulary?.length,
        questions: delta.questions?.length,
      }),
    );
  } else if (command === 'delta') {
    if (args.length !== 4) throw new Error('Usage: delta BASE DESIRED OUTPUT PACK_ID');
    const delta = createDelta(
      await load(args[0]),
      await load(args[1]),
      args[3],
      new Date().toISOString(),
    );
    await writeFile(args[2], JSON.stringify(delta, null, 2) + '\n');
    console.log(
      JSON.stringify({
        output: args[2],
        vocabulary: delta.vocabulary?.length,
        questions: delta.questions?.length,
      }),
    );
  } else
    throw new Error(
      'Commands: validate PACK | import PACK STORE [--dry-run] | split PACK OUTPUT_DIRECTORY PACK_PREFIX [BATCH_SIZE] | delta BASE DESIRED OUTPUT PACK_ID | delta-store STORE DESIRED OUTPUT PACK_ID | validate-user STATE',
    );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
