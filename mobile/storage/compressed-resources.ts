import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { CompressedResource } from '../../src/paged-library.ts';
import { checkCancelled } from '../../src/paged-library.ts';
import { SerialQueue, yieldToUI } from '../../src/serial-queue.ts';
import { resourcePolicy } from '../../src/policy.ts';
import { invariant } from '../../src/validation.ts';

export function encodeResource(value: unknown): {
  bytes: Uint8Array;
  descriptor: CompressedResource;
} {
  const plain = strToU8(JSON.stringify(value));
  invariant(
    plain.length <= resourcePolicy.maxDecodedBlockBytes,
    'Content pack exceeds the block budget. Split it into smaller packs before importing.',
  );
  const bytes = gzipSync(plain, { level: 6, mtime: 0 });
  return {
    bytes,
    descriptor: {
      sha256: bytesToHex(sha256(bytes)),
      bytes: bytes.length,
      decodedBytes: plain.length,
    },
  };
}

export function decodeResource(bytes: Uint8Array, descriptor: CompressedResource): unknown {
  invariant(
    bytes.byteLength === descriptor.bytes && bytesToHex(sha256(bytes)) === descriptor.sha256,
    'Compressed resource checksum mismatch',
  );
  invariant(
    descriptor.decodedBytes > 0 && descriptor.decodedBytes <= resourcePolicy.maxDecodedBlockBytes,
    'Resource exceeds the decoding budget',
  );
  invariant(bytes.length >= 18, 'Invalid gzip resource');
  const size = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(
    0,
    true,
  );
  invariant(size === descriptor.decodedBytes, 'Invalid gzip decoded size');
  const decoded = gunzipSync(bytes, { out: new Uint8Array(descriptor.decodedBytes) });
  invariant(decoded.length === descriptor.decodedBytes, 'Decoded resource size mismatch');
  return JSON.parse(strFromU8(decoded));
}

/** All structured resources share one byte-bounded LRU and one decoding queue. */
export class CompressedResources {
  private cache = new Map<string, { value: unknown; bytes: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private queue = new SerialQueue();
  private read: (key: string) => Promise<Uint8Array>;
  private descriptors: Record<string, CompressedResource>;
  private budget: number;
  readonly metrics = { cachedBytes: 0, cachedBlocks: 0, reads: 0, peakCachedBytes: 0 };

  constructor(
    read: (key: string) => Promise<Uint8Array>,
    descriptors: Record<string, CompressedResource>,
    budget: number = resourcePolicy.cacheDecodedBytes,
  ) {
    this.read = read;
    this.descriptors = descriptors;
    this.budget = budget;
  }
  async load<T>(
    key: string,
    signal?: AbortSignal,
    external?: { descriptor: CompressedResource; read: () => Promise<Uint8Array> },
  ): Promise<T> {
    checkCancelled(signal);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value as T;
    }
    let task = this.pending.get(key);
    if (!task) {
      task = this.queue.run(async () => {
        const descriptor = external?.descriptor ?? this.descriptors[key];
        invariant(descriptor, `Missing offline resource: ${key}`);
        await yieldToUI();
        const value = decodeResource(
          await (external ? external.read() : this.read(key)),
          descriptor,
        );
        this.metrics.reads++;
        if (descriptor.decodedBytes <= this.budget) {
          while (
            this.metrics.cachedBytes + descriptor.decodedBytes > this.budget &&
            this.cache.size
          ) {
            const oldest = this.cache.keys().next().value!;
            this.metrics.cachedBytes -= this.cache.get(oldest)!.bytes;
            this.cache.delete(oldest);
          }
          this.cache.set(key, { value, bytes: descriptor.decodedBytes });
          this.metrics.cachedBytes += descriptor.decodedBytes;
          this.metrics.cachedBlocks = this.cache.size;
          this.metrics.peakCachedBytes = Math.max(
            this.metrics.peakCachedBytes,
            this.metrics.cachedBytes,
          );
        }
        return value;
      });
      this.pending.set(key, task);
      void task.finally(() => this.pending.delete(key)).catch(() => {});
    }
    const value = await task;
    checkCancelled(signal);
    return value as T;
  }
}
