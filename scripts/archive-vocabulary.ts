import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';

const input = await readFile('data/vocabulary.json');
const existing = await readFile('data/vocabulary.json.gz');
if (!gunzipSync(existing).equals(input)) {
  throw new Error(
    'The shipped baseline is immutable. Use npm run build:data for versioned expansions.',
  );
}
const compressed = gzipSync(input, { level: 9 });
await writeFile('data/vocabulary.json.gz', compressed);
console.log(`Archived vocabulary: ${input.length} -> ${compressed.length} bytes`);
