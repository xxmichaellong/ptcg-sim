import { serialize } from 'node:v8';

import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
  type DurableStorageTransactionLike,
} from './durable-storage.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';
import { largeSnapshot, nextRejected } from './snapshot-chunks.test-support.js';

// Local workerd permits values above the documented SQLite limit. Enforce the
// real key + V8-serialized-value ceiling at every put, including chunk values.
class CeilingStorage extends MemoryDurableStorage {
  maximumWrittenBytes = 0;
  override transaction<Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ): Promise<Value> {
    return super.transaction((transaction) =>
      closure({
        ...transaction,
        put: async (entries) => {
          for (const [key, value] of Object.entries(entries)) {
            const bytes =
              new TextEncoder().encode(key).byteLength +
              serialize(value).byteLength;
            this.maximumWrittenBytes = Math.max(
              this.maximumWrittenBytes,
              bytes
            );
            if (bytes > 2_000_000)
              throw new Error('SQLite key/value exceeds 2 MB');
          }
          await transaction.put(entries);
        },
      })
    );
  }
}

const chunkKeys = (storage: MemoryDurableStorage) =>
  [...storage.values.keys()].filter((key) =>
    key.startsWith('authority:snapshot:chunk:')
  );

describe('bounded native authority snapshot storage', () => {
  it('round trips a valid >2 MB V8 snapshot and preserves all 34 full dedupe caches', async () => {
    const snapshot = largeSnapshot();
    expect(
      serialize({
        format: 'ptcgsim-room-authority-v6',
        generation: 'a'.repeat(32),
        snapshot,
      }).byteLength
    ).toBeGreaterThan(2_000_000);
    const storage = new CeilingStorage();
    await new DurableRoomSnapshotStore(storage).initialize(snapshot);
    expect(chunkKeys(storage).length).toBeGreaterThan(1);
    expect(storage.maximumWrittenBytes).toBeLessThan(600_000);
    expect(await new DurableRoomSnapshotStore(storage).load()).toEqual(
      snapshot
    );
  });

  it('atomically rotates chunks, rejects stale writers, and recovers committed-then-threw writes', async () => {
    const storage = new CeilingStorage();
    const initial = largeSnapshot();
    const writer = new DurableRoomSnapshotStore(storage);
    await writer.initialize(initial);
    const oldParts = chunkKeys(storage);
    const stale = new DurableRoomSnapshotStore(storage);
    await stale.load();
    const first = nextRejected(initial);
    storage.retryTransactionOnce = true;
    await writer.commit(first);
    expect(oldParts.every((key) => !storage.values.has(key))).toBe(true);
    await expect(stale.commit(first)).rejects.toBeInstanceOf(
      ConcurrentRoomWriteError
    );
    const before = serialize([...storage.values]);
    const second = nextRejected(first.snapshot);
    storage.failPutWhenKeyStartsWith = 'authority:snapshot:chunk:';
    await expect(writer.commit(second)).rejects.toThrow(
      'injected transactional put failure'
    );
    expect(serialize([...storage.values]).equals(before)).toBe(true);
    storage.failPutWhenKeyStartsWith = undefined;
    storage.failAfterTransactionCommitOnce = true;
    await expect(writer.commit(second)).rejects.toThrow(
      'injected ambiguous transaction failure'
    );
    const committed = serialize([...storage.values]);
    await expect(writer.commit(second)).rejects.toBeInstanceOf(
      ConcurrentRoomWriteError
    );
    expect(serialize([...storage.values]).equals(committed)).toBe(true);
    expect(await writer.load()).toEqual(second.snapshot);
    expect(await new DurableRoomSnapshotStore(storage).load()).toEqual(
      second.snapshot
    );
    expect(await storage.get(AUTHORITY_FRONTIER_STORAGE_KEY)).toMatchObject({
      authorityVersion: second.snapshot.authorityVersion,
    });
    expect(chunkKeys(storage).every((key) => !oldParts.includes(key))).toBe(
      true
    );
  });
});
