import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';

import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
  type DurableStorageLike,
  type DurableStorageTransactionLike,
} from '../src/durable-storage.js';
import {
  largeSnapshot,
  nextRejected,
} from '../src/snapshot-chunks.test-support.js';

it('restores a large valid native authority head through real SQLite storage and ambiguous writes', async () => {
  const evidence = await runInDurableObject(
    env.PTCG_ROOM.getByName('snapshot-chunks-runtime'),
    async (_instance, ctx) => {
      await ctx.storage.deleteAll();
      let maximumBoundedValueBytes = 0;
      let failAfterCommit = false;
      let failPartDeletion = false;
      // node:v8.serialize is unimplemented in workerd. The companion Node test
      // enforces exact V8 bytes; this native guard conservatively bounds every
      // object to <=3*JSON bytes and each binary value to byteLength+256.
      const bounded: DurableStorageLike = {
        get: (key) => ctx.storage.get(key),
        deleteAll: () => ctx.storage.deleteAll(),
        transaction: async (closure) => {
          const result = await ctx.storage.transaction((transaction) => {
            const guarded: DurableStorageTransactionLike = {
              get: (key) => transaction.get(key),
              list: (options) => transaction.list(options),
              delete: (keys) => {
                if (
                  failPartDeletion &&
                  keys.some((key) =>
                    key.startsWith('authority:snapshot:chunk:')
                  )
                )
                  throw new Error('part deletion failed');
                return transaction.delete(keys);
              },
              getAlarm: () => transaction.getAlarm(),
              setAlarm: (time) => transaction.setAlarm(time),
              deleteAlarm: () => transaction.deleteAlarm(),
              put: async (entries) => {
                for (const [key, value] of Object.entries(entries)) {
                  const bound =
                    new TextEncoder().encode(key).byteLength +
                    (value instanceof Uint8Array
                      ? value.byteLength + 256
                      : 3 *
                          new TextEncoder().encode(JSON.stringify(value))
                            .byteLength +
                        256);
                  maximumBoundedValueBytes = Math.max(
                    maximumBoundedValueBytes,
                    bound
                  );
                  if (bound > 2_000_000)
                    throw new Error('SQLite key/value ceiling');
                }
                await transaction.put(entries);
              },
            };
            return closure(guarded);
          });
          if (failAfterCommit) {
            failAfterCommit = false;
            throw new Error('ambiguous native commit');
          }
          return result;
        },
      };
      const initial = largeSnapshot();
      const writer = new DurableRoomSnapshotStore(bounded);
      await writer.initialize(initial);
      const firstHead = await ctx.storage.get<Record<string, unknown>>(
        AUTHORITY_SNAPSHOT_STORAGE_KEY
      );
      expect(firstHead?.format).toBe('ptcgsim-authority-snapshot-chunks-v1');
      const stale = new DurableRoomSnapshotStore(bounded);
      expect(await stale.load()).toEqual(initial);
      const first = nextRejected(initial);
      failPartDeletion = true;
      await expect(writer.commit(first)).rejects.toThrow(
        'part deletion failed'
      );
      failPartDeletion = false;
      expect(await new DurableRoomSnapshotStore(bounded).load()).toEqual(
        initial
      );
      const competing = await Promise.allSettled([
        writer.commit(first),
        stale.commit(first),
      ]);
      expect(
        competing.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1);
      const refused = competing.find((result) => result.status === 'rejected');
      expect(refused?.status === 'rejected' && refused.reason).toBeInstanceOf(
        ConcurrentRoomWriteError
      );
      const second = nextRejected(first.snapshot);
      failAfterCommit = true;
      await expect(writer.commit(second)).rejects.toThrow(
        'ambiguous native commit'
      );
      // A separate store recovers the complete outcome caches and the atomic pair.
      expect(await new DurableRoomSnapshotStore(bounded).load()).toEqual(
        second.snapshot
      );
      expect(
        await ctx.storage.get(AUTHORITY_FRONTIER_STORAGE_KEY)
      ).toMatchObject({ authorityVersion: second.snapshot.authorityVersion });
      await expect(writer.commit(second)).rejects.toBeInstanceOf(
        ConcurrentRoomWriteError
      );
      const all = await ctx.storage.list();
      const chunkKeys = [...all.keys()].filter((key) =>
        key.startsWith('authority:snapshot:chunk:')
      );
      const currentHead = all.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as {
        generation: string;
        chunkCount: number;
      };
      expect(chunkKeys).toHaveLength(currentHead.chunkCount);
      expect(
        chunkKeys.every((key) => key.includes(currentHead.generation))
      ).toBe(true);
      return {
        maximumBoundedValueBytes,
        chunks: chunkKeys.length,
        sessions: Object.keys(second.snapshot.sessions).length,
      };
    }
  );
  expect(evidence.maximumBoundedValueBytes).toBeLessThan(600_000);
  expect(evidence.chunks).toBeGreaterThan(1);
  expect(evidence.sessions).toBe(34);
});
