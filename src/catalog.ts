import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { invariant, validatePack } from './validation.ts';
import type { Catalog, ContentEntity, ContentPack, Entry, Kind, Passage, Word } from './types.ts';

export const kinds: Kind[] = ['sources', 'vocabulary', 'passages', 'questions'];
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function utf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  // Hermes builds differ in Web API availability. Hashing must also work before
  // any platform polyfills, and never depend on Node Buffer or a network library.
  const output = new Uint8Array(text.length * 3); let offset = 0;
  for (const character of text) {
    let code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) output[offset++] = code;
    else if (code < 0x800) { output[offset++] = 0xc0 | code >> 6; output[offset++] = 0x80 | code & 0x3f; }
    else if (code < 0x10000) { output[offset++] = 0xe0 | code >> 12; output[offset++] = 0x80 | code >> 6 & 0x3f; output[offset++] = 0x80 | code & 0x3f; }
    else { output[offset++] = 0xf0 | code >> 18; output[offset++] = 0x80 | code >> 12 & 0x3f; output[offset++] = 0x80 | code >> 6 & 0x3f; output[offset++] = 0x80 | code & 0x3f; }
  }
  return output.subarray(0, offset);
}
export function hash(value: unknown) { return bytesToHex(sha256(utf8(canonical(value)))); }
export function emptyCatalog(): Catalog {
  return { schemaVersion: 1, packs: {}, entities: { sources: {}, vocabulary: {}, passages: {}, questions: {} } };
}
export function latest(versions: Record<string, Entry> | undefined): Entry | undefined {
  if (!versions) return undefined;
  return versions[Math.max(...Object.keys(versions).map(Number))];
}
export function planImport(catalog: Catalog, input: unknown) {
  validatePack(input);
  const pack = input as ContentPack;
  const digest = hash(pack);
  const previous = catalog.packs[pack.packId];
  const seen = previous?.versions[String(pack.packVersion)];
  if (seen) {
    invariant(seen === digest, `Pack version conflict: ${pack.packId}@${pack.packVersion}`);
    return { catalog, digest, changed: false, counts: { added: 0, updated: 0, skipped: 0 }, pack };
  }
  invariant(!previous || pack.packVersion > previous.version, 'Unseen older pack versions are rejected');
  for (const dependency of pack.requires) invariant((catalog.packs[dependency.packId]?.version ?? 0) >= dependency.minVersion, `Missing dependency: ${dependency.packId}@${dependency.minVersion}`);
  // Copy only dictionaries we write; historical entries are immutable. This avoids
  // duplicating every definition/index entry while importing a small mobile update.
  const next: Catalog = { ...catalog, packs: { ...catalog.packs }, entities: {
    sources: { ...catalog.entities.sources }, vocabulary: { ...catalog.entities.vocabulary },
    passages: { ...catalog.entities.passages }, questions: { ...catalog.entities.questions },
  } };
  const counts = { added: 0, updated: 0, skipped: 0 };
  for (const kind of kinds) {
    for (const entity of (pack[kind] ?? []) as ContentEntity[]) {
      const existing = next.entities[kind][entity.id] ?? {};
      const current = latest(existing);
      const fingerprint = hash(entity);
      const old = existing[entity.revision];
      if (old) {
        invariant(old.hash === fingerprint, `Entity revision conflict: ${entity.id}@${entity.revision}`);
        counts.skipped++; continue;
      }
      if (current && entity.revision < current.revision) { counts.skipped++; continue; }
      const entry: Entry = { revision: entity.revision, hash: fingerprint, file: digest + '.json' };
      if ('sourceIds' in entity) entry.sourceIds = entity.sourceIds;
      if (kind === 'vocabulary') entry.senseIds = (entity as Word).senses.map(s => s.id);
      if (kind === 'passages') entry.paragraphIds = (entity as Passage).paragraphs.map(p => p.id);
      next.entities[kind][entity.id] = { ...existing, [entity.revision]: entry };
      if (current) counts.updated++; else counts.added++;
    }
  }
  const senseOwner = new Map<string, string>();
  for (const [id, versions] of Object.entries(next.entities.vocabulary)) {
    for (const version of Object.values(versions)) for (const sid of version.senseIds ?? []) {
      invariant(!senseOwner.has(sid) || senseOwner.get(sid) === id, `Sense ID belongs to another word: ${sid}`);
      senseOwner.set(sid, id);
    }
  }
  const hasSource = (id: string) => Boolean(latest(next.entities.sources[id]));
  for (const kind of kinds) for (const entity of (pack[kind] ?? []) as ContentEntity[]) {
    if ('sourceIds' in entity) invariant(entity.sourceIds.every(hasSource), `${entity.id}: missing source`);
  }
  for (const word of pack.vocabulary ?? []) for (const sense of word.senses) invariant(sense.sourceIds.every(hasSource), `${sense.id}: missing source`);
  for (const question of pack.questions ?? []) {
    invariant(question.senseIds.every(id => senseOwner.has(id)), `${question.id}: missing sense`);
    if (question.passageId) {
      const passage = next.entities.passages[question.passageId]?.[question.passageRevision!];
      invariant(passage, `${question.id}: missing passage revision`);
      invariant(question.evidenceParagraphIds.every(id => passage.paragraphIds?.includes(id)), `${question.id}: missing evidence paragraph`);
    }
  }
  next.packs[pack.packId] = { version: pack.packVersion, versions: { ...previous?.versions, [pack.packVersion]: digest } };
  return { catalog: next, digest, changed: true, counts, pack };
}
