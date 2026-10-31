import { serialize } from 'node:v8';

import { describe, expect, it } from 'vitest';

import { chunkedSnapshotStorage } from './snapshot-storage.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const head = 'authority:snapshot';
const indexKey = `${head}:chunk-index`;
const envelope = (generation = 'a', size = 400_000) => ({
  format: 'ptcgsim-room-authority-v6',
  generation: generation.repeat(32),
  snapshot: { text: '漢'.repeat(size) },
});
const parts = (storage: MemoryDurableStorage) =>
  [...storage.values.keys()].filter((key) => key.startsWith(`${head}:chunk:`));
const write = (
  storage: ReturnType<typeof chunkedSnapshotStorage>,
  value: unknown
) => storage.transaction((transaction) => transaction.put({ [head]: value }));

describe('snapshot chunk representation', () => {
  it('preserves old object heads, joins split UTF-8, prunes on rotation and shrink, and deletes all', async () => {
    const raw = new MemoryDurableStorage();
    const storage = chunkedSnapshotStorage(raw, head);
    const legacy = {
      format: 'ptcgsim-room-authority-v6',
      snapshot: { text: 'old' },
    };
    await write(storage, legacy);
    expect(raw.values.get(head)).toEqual(legacy);
    expect(raw.values.has(indexKey)).toBe(false);
    expect(await storage.get(head)).toEqual(legacy);
    const large = envelope();
    await write(storage, large);
    expect(await storage.get(head)).toEqual(large);
    const oldParts = parts(raw);
    await write(storage, envelope('b', 220_000));
    expect(oldParts.every((key) => !raw.values.has(key))).toBe(true);
    expect(parts(raw)).toHaveLength(2);
    const beforeShrink = serialize([...raw.values]);
    raw.failDeleteWhenKeyStartsWith = `${head}:chunk:`;
    await expect(write(storage, legacy)).rejects.toThrow(
      'injected transactional delete failure'
    );
    expect(serialize([...raw.values]).equals(beforeShrink)).toBe(true);
    expect(await storage.get(head)).toEqual(envelope('b', 220_000));
    raw.failDeleteWhenKeyStartsWith = undefined;
    await write(storage, legacy);
    expect(parts(raw)).toHaveLength(0);
    expect(raw.values.has(indexKey)).toBe(false);
    expect(raw.values.get(head)).toEqual(legacy);
    await storage.deleteAll();
    expect(raw.values.size).toBe(0);
  });

  it.each([
    [
      'missing part',
      (raw: MemoryDurableStorage) => raw.values.delete(parts(raw)[0]!),
    ],
    [
      'wrong part type',
      (raw: MemoryDurableStorage) => raw.values.set(parts(raw)[0]!, 'wrong'),
    ],
    [
      'short part',
      (raw: MemoryDurableStorage) =>
        raw.values.set(parts(raw)[0]!, new Uint8Array(1)),
    ],
    [
      'changed equal-length part',
      (raw: MemoryDurableStorage) =>
        ((raw.values.get(parts(raw)[0]!) as Uint8Array)[0] = 0xff),
    ],
    [
      'native head with a chunk index',
      (raw: MemoryDurableStorage) =>
        raw.values.set(head, {
          format: 'ptcgsim-room-authority-v6',
          snapshot: { text: 'native' },
        }),
    ],
    [
      'missing index',
      (raw: MemoryDurableStorage) => raw.values.delete(indexKey),
    ],
    [
      'mismatched index',
      (raw: MemoryDurableStorage) =>
        raw.values.set(indexKey, {
          ...(raw.values.get(indexKey) as object),
          generation: 'b'.repeat(32),
        }),
    ],
    [
      'unbounded count',
      (raw: MemoryDurableStorage) =>
        raw.values.set(head, {
          ...(raw.values.get(head) as object),
          chunkCount: 129,
        }),
    ],
    [
      'unbounded length',
      (raw: MemoryDurableStorage) =>
        raw.values.set(head, {
          ...(raw.values.get(head) as object),
          byteLength: Number.MAX_SAFE_INTEGER,
        }),
    ],
    [
      'invalid generation',
      (raw: MemoryDurableStorage) =>
        raw.values.set(head, {
          ...(raw.values.get(head) as object),
          generation: '../../authority:frontier',
        }),
    ],
    [
      'extra manifest field',
      (raw: MemoryDurableStorage) =>
        raw.values.set(head, {
          ...(raw.values.get(head) as object),
          keys: ['authority:frontier'],
        }),
    ],
  ])('fails closed on %s', async (_name, corrupt) => {
    const raw = new MemoryDurableStorage();
    const storage = chunkedSnapshotStorage(raw, head);
    await write(storage, envelope());
    corrupt(raw);
    raw.transactionGetKeys = [];
    await expect(storage.get(head)).rejects.toThrow(
      'Stored room snapshot chunks are malformed'
    );
    // Corrupt metadata never becomes an arbitrary storage key or read count.
    expect(raw.transactionGetKeys.length).toBeLessThanOrEqual(5);
    expect(
      raw.transactionGetKeys.every(
        (key) =>
          key === head ||
          key === indexKey ||
          key.startsWith(`${head}:chunk:${'a'.repeat(32)}:`)
      )
    ).toBe(true);
  });

  it.each(['invalid UTF-8', 'invalid JSON', 'different envelope generation'])(
    'rejects %s even with a matching part digest',
    async (kind) => {
      const raw = new MemoryDurableStorage();
      const storage = chunkedSnapshotStorage(raw, head);
      await write(storage, envelope());
      const keys = parts(raw);
      const manifest = raw.values.get(head) as { byteLength: number };
      const bytes = new Uint8Array(manifest.byteLength);
      let offset = 0;
      for (const key of keys) {
        const part = raw.values.get(key) as Uint8Array;
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      if (kind === 'invalid UTF-8') bytes[0] = 0xff;
      else if (kind === 'invalid JSON') bytes[0] = '!'.charCodeAt(0);
      else {
        const text = new TextDecoder()
          .decode(bytes)
          .replace('a'.repeat(32), 'b'.repeat(32));
        bytes.set(new TextEncoder().encode(text));
      }
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      ]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      for (const key of [head, indexKey]) {
        raw.values.set(key, {
          ...(raw.values.get(key) as object),
          sha256: hash,
        });
      }
      keys.forEach((key, index) =>
        raw.values.set(
          key,
          bytes.slice(index * 512 * 1024, (index + 1) * 512 * 1024)
        )
      );
      await expect(storage.get(head)).rejects.toThrow(
        'Stored room snapshot chunks are malformed'
      );
    }
  );
});
