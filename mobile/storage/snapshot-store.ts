import { hash } from '../../src/catalog.ts';
import { invariant } from '../../src/validation.ts';

export interface JsonIO {
  readBytes?(path: string): Promise<Uint8Array | null>;
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}
interface Envelope<T> {
  sequence: number;
  checksum: string;
  data: T;
}

/** Two-slot crash recovery. Callers serialize writes through their transaction queue. */
export class SnapshotStore {
  private sequences = new Map<string, number>();
  private io: JsonIO;
  recovered = false;

  constructor(io: JsonIO) {
    this.io = io;
  }

  async read<T>(name: string, fallback: T, validate?: (value: unknown) => void): Promise<T> {
    const results: Envelope<T>[] = [];
    let present = 0;
    for (const slot of [0, 1]) {
      const text = await this.io.read(`${name}-${slot}.json`);
      if (text === null) continue;
      present++;
      try {
        const item = JSON.parse(text) as Envelope<T>;
        invariant(
          Number.isSafeInteger(item.sequence) &&
            item.sequence > 0 &&
            hash(item.data) === item.checksum,
          'Invalid snapshot',
        );
        validate?.(item.data);
        results.push(item);
      } catch {
        this.recovered = true;
      }
    }
    invariant(
      !present || results.length,
      `Both ${name} snapshots are damaged. Restore a backup; existing files were not overwritten.`,
    );
    results.sort((a, b) => b.sequence - a.sequence);
    this.sequences.set(name, results[0]?.sequence ?? 0);
    return results[0]?.data ?? fallback;
  }

  async commit(name: string, data: unknown): Promise<void> {
    const sequence = (this.sequences.get(name) ?? 0) + 1;
    invariant(Number.isSafeInteger(sequence), 'Snapshot sequence exhausted');
    await this.io.write(
      `${name}-${sequence % 2}.json`,
      JSON.stringify({ sequence, checksum: hash(data), data }),
    );
    this.sequences.set(name, sequence);
  }
}
