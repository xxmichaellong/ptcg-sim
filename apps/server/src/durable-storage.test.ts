import {
  asMatchId,
  asPlayerId,
  cloneMatchState,
  createEmptyMatch,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  emptyProjectionIdentityState,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
  RoomAlreadyInitializedError,
  type DurableStorageLike,
  type DurableStorageTransactionLike,
} from './durable-storage.js';

class MemoryDurableStorage implements DurableStorageLike {
  values = new Map<string, unknown>();
  failPutWhenKeyStartsWith: string | undefined;

  async get<Value>(key: string): Promise<Value | undefined> {
    return structuredClone(this.values.get(key)) as Value | undefined;
  }

  async transaction<Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ): Promise<Value> {
    const staged = new Map(
      [...this.values].map(([key, value]) => [key, structuredClone(value)])
    );
    const result = await closure({
      get: async <Stored>(key: string) =>
        structuredClone(staged.get(key)) as Stored | undefined,
      put: async (entries) => {
        const keys = Object.keys(entries);
        if (
          this.failPutWhenKeyStartsWith &&
          keys.some((key) => key.startsWith(this.failPutWhenKeyStartsWith!))
        ) {
          throw new Error('injected transactional put failure');
        }
        for (const [key, value] of Object.entries(entries)) {
          staged.set(key, structuredClone(value));
        }
      },
    });
    this.values = staged;
    return result;
  }
}

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const initialSnapshot = (): RoomAuthoritySnapshot => ({
  schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  state: createEmptyMatch(asMatchId('durable-room'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]),
  identities: emptyProjectionIdentityState(),
  sessions: {
    session: {
      id: 'session',
      viewer: { kind: 'player', playerId: p1 },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
    },
  },
});

const acceptedTransaction = (
  current: RoomAuthoritySnapshot
): PersistedAuthorityTransaction => {
  const outcome = {
    commandId: 'command-1',
    clientSequence: 1,
    accepted: true,
    revision: 1,
  } as const;
  return {
    expectedRevision: 0,
    sessionId: 'session',
    outcome,
    eventBatch: {
      revision: 1,
      events: [{ type: 'CoinFlipped', result: 'heads' }],
    },
    snapshot: {
      ...current,
      state: { ...cloneMatchState(current.state), revision: 1 },
      sessions: {
        session: {
          ...current.sessions.session!,
          nextClientSequence: 2,
          recentOutcomes: [outcome],
        },
      },
    },
  };
};

describe('Durable Object authority snapshot store', () => {
  it('initializes once and restores a validated snapshot', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();

    await store.initialize(initial);
    expect(await store.load()).toEqual(initial);
    await expect(store.initialize(initial)).rejects.toBeInstanceOf(
      RoomAlreadyInitializedError
    );
  });

  it('atomically writes the snapshot and resolved journal record', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);

    const transaction = acceptedTransaction(initial);
    await store.commit(transaction);

    expect((await store.load())?.state.revision).toBe(1);
    const journalKeys = [...storage.values.keys()].filter((key) =>
      key.startsWith('authority:journal:')
    );
    expect(journalKeys).toHaveLength(1);
    expect(storage.values.get(journalKeys[0]!)).toMatchObject({
      expectedRevision: 0,
      resultingRevision: 1,
      sessionId: 'session',
      outcome: { commandId: 'command-1', accepted: true },
      eventBatch: { revision: 1 },
    });
  });

  it('rejects stale compare-and-swap commits', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const transaction = acceptedTransaction(initial);
    await store.commit(transaction);

    await expect(store.commit(transaction)).rejects.toBeInstanceOf(
      ConcurrentRoomWriteError
    );
    expect((await store.load())?.state.revision).toBe(1);
  });

  it('rolls back the snapshot when the journal write fails', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    storage.failPutWhenKeyStartsWith = 'authority:journal:';

    await expect(store.commit(acceptedTransaction(initial))).rejects.toThrow(
      'injected transactional put failure'
    );
    expect((await store.load())?.state.revision).toBe(0);
    expect(
      [...storage.values.keys()].filter((key) =>
        key.startsWith('authority:journal:')
      )
    ).toHaveLength(0);
  });

  it('fails closed on a corrupt stored envelope', async () => {
    const storage = new MemoryDurableStorage();
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'unknown-format',
      snapshot: initialSnapshot(),
    });
    const store = new DurableRoomSnapshotStore(storage);

    await expect(store.load()).rejects.toThrow('unsupported envelope');
  });
});
