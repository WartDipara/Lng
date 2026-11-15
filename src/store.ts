/** Node reference adapter. Mobile will implement the same JSON commit protocol. */
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyCatalog, hash, planImport, kinds, latest } from './catalog.ts';
import { emptyUserState } from './notebook.ts';
import { invariant, validateUserState } from './validation.ts';
import type { Catalog, ContentPack, ContentEntity, UserState } from './types.ts';

async function readJson(path: string, fallback: unknown): Promise<any> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
async function atomicJson(path: string, value: unknown) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  const file = await open(tmp, 'wx');
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
  await rename(tmp, path);
}
async function withLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const path = join(root, 'writer.lock');
  const lock = await open(path, 'wx').catch(() => { throw new Error('Store locked. Do not remove writer.lock until its writer has stopped.'); });
  try { await lock.writeFile(JSON.stringify({ pid: process.pid })); return await task(); }
  finally { await lock.close(); await unlink(path); }
}
export async function readCatalog(root: string): Promise<Catalog> {
  const pointer = await readJson(join(root, 'CURRENT.json'), null);
  if (!pointer) return emptyCatalog();
  invariant(/^[a-f0-9]{64}\.json$/.test(pointer.file), 'Invalid catalog pointer');
  const catalog = await readJson(join(root, 'catalogs', pointer.file), null);
  invariant(catalog && hash(catalog) + '.json' === pointer.file, 'Catalog missing or corrupt; restore PREVIOUS.json');
  return catalog;
}
/** Full authoring snapshot from the active library. Not a distributable package. */
export async function readContentSnapshot(root: string): Promise<{ catalog: Catalog; snapshot: ContentPack }> {
  const catalog = await readCatalog(root);
  const snapshot: ContentPack = { schemaVersion: 1, packId: 'snapshot:local', packVersion: 1,
    createdAt: new Date().toISOString(), requires: [], sources: [], vocabulary: [], passages: [], questions: [] };
  // Read each immutable pack once, rather than once per word.
  const wanted = new Map<string, { kind: typeof kinds[number]; id: string; revision: number; hash: string }[]>();
  for (const kind of kinds) for (const [id, versions] of Object.entries(catalog.entities[kind])) {
    const entry = latest(versions)!;
    const list = wanted.get(entry.file) ?? [];
    list.push({ kind, id, revision: entry.revision, hash: entry.hash }); wanted.set(entry.file, list);
  }
  for (const [file, targets] of wanted) {
    invariant(/^[a-f0-9]{64}\.json$/.test(file), 'Invalid pack filename');
    const pack = await readJson(join(root, 'packs', file), null) as ContentPack;
    invariant(pack && hash(pack) + '.json' === file, 'Pack missing or corrupt');
    const indexes = new Map(kinds.map(kind => [kind, new Map(((pack[kind] ?? []) as ContentEntity[]).map(entity => [entity.id, entity]))]));
    for (const target of targets) {
      const entity = indexes.get(target.kind)!.get(target.id);
      invariant(entity && entity.revision === target.revision && hash(entity) === target.hash, 'Catalog entity does not match pack');
      ((snapshot[target.kind]) as ContentEntity[]).push(entity);
    }
  }
  return { catalog, snapshot };
}
export async function importPack(root: string, pack: unknown, dryRun = false) {
  return withLock(root, async () => {
    const result = planImport(await readCatalog(root), pack);
    if (dryRun || !result.changed) return { changed: result.changed, ...result.counts, digest: result.digest };
    await mkdir(join(root, 'packs'), { recursive: true });
    await mkdir(join(root, 'catalogs'), { recursive: true });
    await atomicJson(join(root, 'packs', result.digest + '.json'), result.pack);
    const catalogFile = hash(result.catalog) + '.json';
    await atomicJson(join(root, 'catalogs', catalogFile), result.catalog);
    const previous = await readJson(join(root, 'CURRENT.json'), null);
    if (previous) await atomicJson(join(root, 'PREVIOUS.json'), previous);
    // Commit point: orphan staged files are harmless if the process exits before this rename.
    await atomicJson(join(root, 'CURRENT.json'), { file: catalogFile });
    return { changed: true, ...result.counts, digest: result.digest };
  });
}
export async function readUserState(root: string): Promise<UserState> {
  const pointer = await readJson(join(root, 'USER-CURRENT.json'), null);
  if (!pointer) return emptyUserState();
  invariant(/^[a-f0-9]{64}$/.test(pointer.generation), 'Invalid user-state pointer');
  const folder = join(root, 'user', pointer.generation);
  const notebooks = await readJson(join(folder, 'notebooks.json'), null);
  const attempts = await readJson(join(folder, 'attempts.json'), null);
  const reviews = await readJson(join(folder, 'review.json'), null);
  const settings = await readJson(join(folder, 'settings.json'), null);
  const state = { schemaVersion: 1, ...notebooks, attempts, reviews, settings };
  validateUserState(state);
  invariant(hash(state) === pointer.generation, 'User-state checksum mismatch');
  return state;
}
export async function updateUserState(root: string, update: (state: UserState) => UserState): Promise<void> {
  await withLock(root, async () => {
    const state = update(await readUserState(root));
    validateUserState(state);
    const generation = hash(state);
    const folder = join(root, 'user', generation);
    await mkdir(folder, { recursive: true });
    await atomicJson(join(folder, 'notebooks.json'), { notes: state.notes, mistakes: state.mistakes });
    await atomicJson(join(folder, 'attempts.json'), state.attempts);
    await atomicJson(join(folder, 'review.json'), state.reviews);
    await atomicJson(join(folder, 'settings.json'), state.settings);
    const previous = await readJson(join(root, 'USER-CURRENT.json'), null);
    if (previous) await atomicJson(join(root, 'USER-PREVIOUS.json'), previous);
    await atomicJson(join(root, 'USER-CURRENT.json'), { generation });
  });
}
