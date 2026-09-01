import {
  asMatchId,
  asPlayerId,
  cloneMatchState,
  createEmptyMatch,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  appendReplayHistory,
  createReplayHistory,
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

const initialSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('durable-room'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
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
  };
};

const acceptedTransaction = (
  current: RoomAuthoritySnapshot
): PersistedAuthorityTransaction => {
  const outcome = {
    commandId: 'command-1',
    clientSequence: 1,
    accepted: true,
    revision: 1,
  } as const;
  const eventBatch = {
    revision: 1,
    events: [{ type: 'CoinFlipped' as const, result: 'heads' as const }],
  };
  const state = { ...cloneMatchState(current.state), revision: 1 };
  return {
    expectedAuthorityVersion: 0,
    expectedRevision: 0,
    sessionId: 'session',
    outcome,
    eventBatch,
    snapshot: {
      ...current,
      authorityVersion: 1,
      state,
      replayHistory: appendReplayHistory(
        current.replayHistory,
        eventBatch,
        state,
        128
      ),
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

  it('migrates v1 snapshots to explicit mode with safe empty histories', async () => {
    const storage = new MemoryDurableStorage();
    const {
      mode: _mode,
      soloUndoHistory: _history,
      replayHistory: _replayHistory,
      ...legacy
    } = initialSnapshot();
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v1',
      snapshot: { ...legacy, schemaVersion: 1 },
    });

    const restored = await new DurableRoomSnapshotStore(storage).load();
    expect(restored).toMatchObject({
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      mode: 'multiplayer',
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: {
        baseState: { revision: 0 },
        entries: [],
      },
    });
  });

  it('migrates v2 snapshots to a truncated replay rooted at current state', async () => {
    const storage = new MemoryDurableStorage();
    const current = acceptedTransaction(initialSnapshot()).snapshot;
    const { replayHistory: _replayHistory, ...previous } = current;
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v2',
      snapshot: { ...previous, schemaVersion: 2 },
    });

    const restored = await new DurableRoomSnapshotStore(storage).load();
    expect(restored).toMatchObject({
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state: { revision: 1 },
      replayHistory: {
        baseState: { revision: 1 },
        entries: [],
      },
    });
  });

  it('atomically writes the snapshot and resolved journal record', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    expect(storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toMatchObject({
      format: 'ptcgsim-room-authority-v3',
    });

    const transaction = acceptedTransaction(initial);
    await store.commit(transaction);

    expect((await store.load())?.state.revision).toBe(1);
    const journalKeys = [...storage.values.keys()].filter((key) =>
      key.startsWith('authority:journal:')
    );
    expect(journalKeys).toHaveLength(1);
    expect(storage.values.get(journalKeys[0]!)).toMatchObject({
      expectedAuthorityVersion: 0,
      resultingAuthorityVersion: 1,
      expectedRevision: 0,
      resultingRevision: 1,
      sessionId: 'session',
      outcome: { commandId: 'command-1', accepted: true },
      eventBatch: { revision: 1 },
    });
  });

  it('atomically persists admission metadata on the authority frontier', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const spectatorSession = {
      id: 'spectator-session-0000000001',
      viewer: { kind: 'spectator' as const },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
      resumeCapabilityDigest: 'a'.repeat(64),
    };

    await store.commitAdmission({
      expectedAuthorityVersion: 0,
      sessionId: spectatorSession.id,
      kind: 'spectator_joined',
      snapshot: {
        ...initial,
        authorityVersion: 1,
        sessions: {
          ...initial.sessions,
          [spectatorSession.id]: spectatorSession,
        },
      },
    });

    expect((await store.load())?.authorityVersion).toBe(1);
    const admissionKeys = [...storage.values.keys()].filter((key) =>
      key.startsWith('authority:admission:')
    );
    expect(admissionKeys).toHaveLength(1);
    expect(storage.values.get(admissionKeys[0]!)).toMatchObject({
      expectedAuthorityVersion: 0,
      resultingAuthorityVersion: 1,
      kind: 'spectator_joined',
      sessionId: spectatorSession.id,
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

  it('fails closed on a corrupt replay checkpoint', async () => {
    const storage = new MemoryDurableStorage();
    const snapshot = initialSnapshot();
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v3',
      snapshot: {
        ...snapshot,
        replayHistory: {
          ...snapshot.replayHistory,
          baseStateHash: 'corrupt',
        },
      },
    });

    await expect(new DurableRoomSnapshotStore(storage).load()).rejects.toThrow(
      'replay base hash does not match'
    );
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
