import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const input = await readFile('data/vocabulary.json');
const compressed = gzipSync(input, { level: 9 });
await writeFile('data/vocabulary.json.gz', compressed);
console.log(`Archived vocabulary: ${input.length} -> ${compressed.length} bytes`);
