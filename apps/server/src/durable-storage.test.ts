import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  cloneMatchState,
  createEmptyMatch,
  MATCH_STATE_SCHEMA_VERSION,
  playerZoneId,
  stableHash,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  appendReplayHistory,
  authoritySnapshotCommandValidationMatches,
  authoritySnapshotValidationFor,
  createRoomAdmissionState,
  createReplayHistory,
  emptyProjectionIdentityState,
  processAuthorityCommand,
  validateAuthoritySnapshot,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type AuthoritySnapshotValidation,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomAlreadyInitializedError,
  RoomExpiredError,
  type DurableStorageLike,
  type DurableStorageTransactionLike,
} from './durable-storage.js';
import {
  JOURNAL_RETENTION_STORAGE_KEY,
  MAX_ADMISSION_JOURNAL_BYTES,
  MAX_ADMISSION_JOURNAL_ENTRIES,
  MAX_AUTHORITY_JOURNAL_BYTES,
  MAX_AUTHORITY_JOURNAL_ENTRIES,
} from './journal-retention.js';

class MemoryDurableStorage implements DurableStorageLike {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  failPutWhenKeyStartsWith: string | undefined;
  failSetAlarm = false;
  failDeleteAlarm = false;
  failDeleteAllOnce = false;
  failDeleteWhenKeyStartsWith: string | undefined;

  async get<Value>(key: string): Promise<Value | undefined> {
    return structuredClone(this.values.get(key)) as Value | undefined;
  }

  async deleteAll(): Promise<void> {
    if (this.failDeleteAllOnce) {
      this.failDeleteAllOnce = false;
      throw new Error('injected deleteAll failure');
    }
    this.values.clear();
    this.alarm = null;
  }

  async transaction<Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ): Promise<Value> {
    const staged = new Map(
      [...this.values].map(([key, value]) => [key, structuredClone(value)])
    );
    let stagedAlarm = this.alarm;
    const result = await closure({
      get: async <Stored>(key: string) =>
        structuredClone(staged.get(key)) as Stored | undefined,
      list: async <Stored>(options = {}) =>
        new Map(
          [...staged]
            .filter(
              ([key]) =>
                (!options.prefix || key.startsWith(options.prefix)) &&
                (!options.startAfter || key > options.startAfter)
            )
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
            .map(([key, value]) => [key, structuredClone(value) as Stored])
        ),
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
      delete: async (keys) => {
        if (
          this.failDeleteWhenKeyStartsWith &&
          keys.some((key) => key.startsWith(this.failDeleteWhenKeyStartsWith!))
        ) {
          throw new Error('injected transactional delete failure');
        }
        let deleted = 0;
        for (const key of keys) {
          if (staged.delete(key)) deleted += 1;
        }
        return deleted;
      },
      setAlarm: async (scheduledTime) => {
        if (this.failSetAlarm) throw new Error('injected setAlarm failure');
        stagedAlarm =
          scheduledTime instanceof Date
            ? scheduledTime.getTime()
            : scheduledTime;
      },
      deleteAlarm: async () => {
        if (this.failDeleteAlarm) {
          throw new Error('injected deleteAlarm failure');
        }
        stagedAlarm = null;
      },
    });
    this.values = staged;
    this.alarm = stagedAlarm;
    return result;
  }
}

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const initialSnapshot = (
  matchId: string = 'durable-room'
): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId(matchId), [
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

const unclaimedSnapshot = (): RoomAuthoritySnapshot => ({
  ...initialSnapshot(),
  sessions: {},
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
  const eventBatch = {
    revision: 1,
    events: [
      {
        type: 'CoinFlipped' as const,
        playerId: p1,
        result: 'heads' as const,
      },
    ],
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

const rejectedTransaction = (
  current: RoomAuthoritySnapshot
): PersistedAuthorityTransaction => {
  const session = current.sessions.session!;
  const outcome = {
    commandId: `rejected-command-${String(session.nextClientSequence).padStart(4, '0')}`,
    clientSequence: session.nextClientSequence,
    accepted: false,
    revision: current.state.revision,
    code: 'precondition_failed' as const,
  };
  return {
    expectedAuthorityVersion: current.authorityVersion,
    expectedRevision: current.state.revision,
    sessionId: session.id,
    outcome,
    snapshot: {
      ...current,
      authorityVersion: current.authorityVersion + 1,
      sessions: {
        ...current.sessions,
        [session.id]: {
          ...session,
          nextClientSequence: session.nextClientSequence + 1,
          recentOutcomes: [...session.recentOutcomes, outcome].slice(
            -DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession
          ),
        },
      },
    },
  };
};

const resumedTransaction = (
  current: RoomAuthoritySnapshot
): PersistedAdmissionTransaction => ({
  expectedAuthorityVersion: current.authorityVersion,
  sessionId: current.sessions.session!.id,
  kind: 'session_resumed',
  snapshot: {
    ...current,
    authorityVersion: current.authorityVersion + 1,
  },
});

interface ObservedRetentionIndex {
  readonly frontierAuthorityVersion: number;
  readonly authority: readonly {
    readonly key: string;
    readonly bytes: number;
    readonly resultingAuthorityVersion: number;
  }[];
  readonly admission: readonly {
    readonly key: string;
    readonly bytes: number;
    readonly resultingAuthorityVersion: number;
  }[];
}

const observedRetentionIndex = (
  storage: MemoryDurableStorage
): ObservedRetentionIndex =>
  storage.values.get(JOURNAL_RETENTION_STORAGE_KEY) as ObservedRetentionIndex;

const storedKeys = (
  storage: MemoryDurableStorage,
  prefix: string
): readonly string[] =>
  [...storage.values.keys()].filter((key) => key.startsWith(prefix)).sort();

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

  it('atomically initializes an unclaimed lifecycle and its expiry alarm', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = unclaimedSnapshot();

    await store.initialize(initial, {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });

    expect(await store.load()).toEqual(initial);
    expect(storage.alarm).toBe(301_000);
    expect(storage.values.get(ROOM_LIFECYCLE_STORAGE_KEY)).toEqual({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });

    const failedStorage = new MemoryDurableStorage();
    failedStorage.failSetAlarm = true;
    await expect(
      new DurableRoomSnapshotStore(failedStorage).initialize(initial, {
        createdAt: 1_000,
        unclaimedExpiresAt: 301_000,
      })
    ).rejects.toThrow('injected setAlarm failure');
    expect(failedStorage.values.size).toBe(0);
    expect(failedStorage.alarm).toBeNull();
  });

  it('reschedules early alarms and deletes a room once its claim window ends', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    await store.initialize(unclaimedSnapshot(), {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    storage.alarm = 2_000;

    await expect(store.expireUnclaimedRoom(2_000)).resolves.toBe('scheduled');
    expect(storage.alarm).toBe(301_000);
    expect(await store.load()).toBeDefined();

    await expect(store.expireUnclaimedRoom(301_000)).resolves.toBe('expired');
    expect(storage.values.size).toBe(0);
    expect(storage.alarm).toBeNull();
  });

  it('leaves an expiring tombstone after deletion failure and retries safely', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = unclaimedSnapshot();
    await store.initialize(initial, {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    storage.failDeleteAllOnce = true;

    await expect(store.expireUnclaimedRoom(301_000)).rejects.toThrow(
      'injected deleteAll failure'
    );
    expect(storage.values.get(ROOM_LIFECYCLE_STORAGE_KEY)).toMatchObject({
      state: 'expiring',
    });
    await expect(
      store.commit(acceptedTransaction(initialSnapshot()))
    ).rejects.toBeInstanceOf(RoomExpiredError);

    await expect(store.expireUnclaimedRoom(301_001)).resolves.toBe('expired');
    expect(storage.values.size).toBe(0);
  });

  it('claims the lifecycle and cancels expiry with the first admission commit', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = unclaimedSnapshot();
    await store.initialize(initial, {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    const session = {
      id: 'first-session-000000000001',
      viewer: { kind: 'spectator' as const },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
      resumeCapabilityDigest: 'a'.repeat(64),
    };

    const admission = {
      expectedAuthorityVersion: 0,
      sessionId: session.id,
      kind: 'spectator_joined',
      snapshot: {
        ...initial,
        authorityVersion: 1,
        sessions: { [session.id]: session },
      },
    } as const;

    storage.failDeleteAlarm = true;
    await expect(store.commitAdmission(admission)).rejects.toThrow(
      'injected deleteAlarm failure'
    );
    expect((await store.load())?.authorityVersion).toBe(0);
    expect(storage.values.get(ROOM_LIFECYCLE_STORAGE_KEY)).toMatchObject({
      state: 'unclaimed',
    });
    expect(storage.alarm).toBe(301_000);

    storage.failDeleteAlarm = false;
    await store.commitAdmission(admission);

    expect(storage.alarm).toBeNull();
    expect(storage.values.get(ROOM_LIFECYCLE_STORAGE_KEY)).toEqual({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'claimed',
      createdAt: 1_000,
      claimedAtAuthorityVersion: 1,
    });
    await expect(store.expireUnclaimedRoom(400_000)).resolves.toBe('claimed');
    expect(await store.load()).toBeDefined();
  });

  it('repairs a stale unclaimed marker when durable sessions already exist', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    await store.initialize(unclaimedSnapshot(), {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      snapshot: initialSnapshot(),
    });

    await expect(store.expireUnclaimedRoom(301_000)).resolves.toBe('claimed');
    expect(storage.alarm).toBeNull();
    expect(storage.values.get(ROOM_LIFECYCLE_STORAGE_KEY)).toMatchObject({
      state: 'claimed',
      claimedAtAuthorityVersion: 0,
    });
  });

  it('fails closed on malformed lifecycle state', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    await store.initialize(unclaimedSnapshot(), {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    storage.values.set(ROOM_LIFECYCLE_STORAGE_KEY, {
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
      createdAt: 1_000,
      unclaimedExpiresAt: 'tomorrow',
    });

    await expect(store.expireUnclaimedRoom(301_000)).rejects.toThrow(
      'lifecycle is malformed'
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
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.state)).toBe(true);
    expect(authoritySnapshotValidationFor(restored!)).toBeDefined();
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

  it('migrates v3 state scopes and truncates incompatible event tails', async () => {
    const storage = new MemoryDurableStorage();
    const current = acceptedTransaction(initialSnapshot()).snapshot;
    const definitionId = asCardDefinitionId('legacy-definition');
    const firstCardId = asCardInstanceId('legacy-card-one');
    const secondCardId = asCardInstanceId('legacy-card-two');
    const handId = playerZoneId(p1, 'hand');
    const legacyCard = (id: typeof firstCardId) => ({
      id,
      definitionId,
      ownerId: p1,
      originalCategory: 'Trainer' as const,
      currentCategory: 'Trainer' as const,
      face: 'up' as const,
      orientationQuarterTurns: 0 as const,
      abilityUsed: false,
      visibilityGeneration: 0,
    });
    const legacyState = {
      ...current.state,
      schemaVersion: 1,
      definitions: {
        [definitionId]: {
          id: definitionId,
          name: 'Legacy card',
          category: 'Trainer' as const,
          imageUrl: '/legacy-card.png',
        },
      },
      cards: {
        [firstCardId]: legacyCard(firstCardId),
        [secondCardId]: legacyCard(secondCardId),
      },
      deckLists: {
        ...current.state.deckLists,
        [p1]: [firstCardId, secondCardId],
      },
      zones: {
        ...current.state.zones,
        [handId]: {
          ...current.state.zones[handId]!,
          cardIds: [firstCardId, secondCardId],
        },
      },
      visibility: {
        ...current.state.visibility,
        inspectionGrants: {
          'legacy-card-inspection': {
            inspectionId: asInspectionId('legacy-card-inspection'),
            sourcePlayerId: p1,
            sourceId: handId,
            cardIds: [firstCardId],
            viewerIds: [p1],
          },
          'legacy-zone-inspection': {
            inspectionId: asInspectionId('legacy-zone-inspection'),
            sourcePlayerId: p1,
            sourceId: handId,
            cardIds: [firstCardId, secondCardId],
            viewerIds: [p1],
          },
        },
      },
    };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v3',
      snapshot: { ...current, schemaVersion: 3, state: legacyState },
    });

    const restored = await new DurableRoomSnapshotStore(storage).load();
    expect(restored).toMatchObject({
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state: {
        schemaVersion: MATCH_STATE_SCHEMA_VERSION,
        visibility: {
          inspectionGrants: {
            'legacy-card-inspection': { scope: 'card' },
            'legacy-zone-inspection': { scope: 'zone' },
          },
        },
      },
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: {
        baseState: { revision: 1 },
        entries: [],
      },
    });

    const corruptCurrent = structuredClone(restored!);
    delete (
      corruptCurrent.state.visibility.inspectionGrants[
        'legacy-card-inspection'
      ] as { scope?: 'card' | 'zone' }
    ).scope;
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      snapshot: corruptCurrent,
    });
    await expect(new DurableRoomSnapshotStore(storage).load()).rejects.toThrow(
      'invalid scope'
    );
  });

  it('atomically writes the snapshot and resolved journal record', async () => {
    const storage = new MemoryDurableStorage();
    const initial = initialSnapshot();
    await new DurableRoomSnapshotStore(storage).initialize(initial);
    expect(storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toMatchObject({
      format: 'ptcgsim-room-authority-v6',
    });

    const marks = [0, 5, 10, 25];
    const store = new DurableRoomSnapshotStore(storage, () => marks.shift()!);
    const transaction = acceptedTransaction(initial);
    await expect(store.commit(transaction)).resolves.toEqual({
      snapshotValidationMs: 5,
      transactionMs: 15,
    });
    expect(marks).toEqual([]);

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

    const clockFailureStore = new DurableRoomSnapshotStore(storage, () => {
      throw new Error('observation clock failed');
    });
    const nextTransaction = rejectedTransaction(transaction.snapshot);
    await expect(clockFailureStore.commit(nextTransaction)).resolves.toEqual({
      snapshotValidationMs: 0,
      transactionMs: 0,
    });
    expect(await clockFailureStore.load()).toEqual(nextTransaction.snapshot);
  });

  it('persists the exact canonical command batch without serializing proof metadata', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    let card = 0;
    let stack = 0;
    let inspection = 0;
    let workArea = 0;
    let opaque = 0;

    const result = await processAuthorityCommand(
      initial,
      {
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'canonical-batch-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      },
      {
        commandContext: {
          nextCardId: () => asCardInstanceId(`canonical-card-${++card}`),
          nextStackId: () => asStackId(`canonical-stack-${++stack}`),
          nextInspectionId: () =>
            asInspectionId(`canonical-inspection-${++inspection}`),
          nextWorkAreaId: () =>
            asWorkAreaId(`canonical-work-area-${++workArea}`),
          shuffle: (values) => [...values].reverse(),
          randomInt: () => 0,
        },
        opaqueIds: {
          nextOpaqueId: (kind) =>
            `canonical-${kind}-${String(++opaque).padStart(12, '0')}`,
        },
        persistence: store,
        policy: DEFAULT_AUTHORITY_POLICY,
      }
    );

    const journal = [...storage.values.entries()].find(([key]) =>
      key.startsWith('authority:journal:')
    )?.[1] as { eventBatch?: unknown } | undefined;
    const outcome = result.snapshot.sessions.session?.recentOutcomes.at(-1);
    const eventBatch = result.snapshot.replayHistory.entries.at(-1)?.batch;
    expect(outcome).toBeDefined();
    expect(eventBatch).toBeDefined();
    expect(
      authoritySnapshotCommandValidationMatches(
        result.snapshotValidation,
        result.snapshot,
        initial,
        0,
        0,
        'session',
        outcome!,
        eventBatch
      )
    ).toBe(true);
    expect(journal?.eventBatch).toEqual(eventBatch);
    expect(JSON.stringify([...storage.values.values()])).not.toContain(
      'snapshotValidation'
    );
    expect(JSON.stringify([...storage.values.values()])).not.toContain(
      'replayHistoryTransition'
    );
  });

  it('bounds recent room audit rows while retaining the snapshot idempotency frontier', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    let current = initialSnapshot();
    await store.initialize(current);

    for (
      let index = 0;
      index < MAX_AUTHORITY_JOURNAL_ENTRIES + 32;
      index += 1
    ) {
      const transaction = rejectedTransaction(current);
      await store.commit(transaction);
      current = transaction.snapshot;
    }

    const keys = storedKeys(storage, 'authority:journal:');
    const retention = observedRetentionIndex(storage);
    expect(keys).toHaveLength(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(retention).toMatchObject({
      frontierAuthorityVersion: MAX_AUTHORITY_JOURNAL_ENTRIES + 32,
      admission: [],
    });
    expect(retention.authority).toHaveLength(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(
      retention.authority.reduce((total, entry) => total + entry.bytes, 0)
    ).toBeLessThanOrEqual(MAX_AUTHORITY_JOURNAL_BYTES);
    expect(retention.authority[0]?.resultingAuthorityVersion).toBe(33);
    expect(retention.authority.at(-1)?.resultingAuthorityVersion).toBe(160);
    expect(keys).toEqual(retention.authority.map((entry) => entry.key));

    const restored = await store.load();
    expect(restored).toEqual(current);
    expect(restored?.sessions.session?.recentOutcomes).toHaveLength(
      DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession
    );
    expect(restored?.sessions.session?.recentOutcomes[0]).toMatchObject({
      clientSequence: 33,
    });
  });

  it('bounds admission audit rows independently from command rows', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    let current = initialSnapshot();
    await store.initialize(current);

    for (
      let index = 0;
      index < MAX_ADMISSION_JOURNAL_ENTRIES + 16;
      index += 1
    ) {
      const transaction = resumedTransaction(current);
      await store.commitAdmission(transaction);
      current = transaction.snapshot;
    }

    const keys = storedKeys(storage, 'authority:admission:');
    const retention = observedRetentionIndex(storage);
    expect(keys).toHaveLength(MAX_ADMISSION_JOURNAL_ENTRIES);
    expect(retention).toMatchObject({
      frontierAuthorityVersion: MAX_ADMISSION_JOURNAL_ENTRIES + 16,
      authority: [],
    });
    expect(retention.admission).toHaveLength(MAX_ADMISSION_JOURNAL_ENTRIES);
    expect(
      retention.admission.reduce((total, entry) => total + entry.bytes, 0)
    ).toBeLessThanOrEqual(MAX_ADMISSION_JOURNAL_BYTES);
    expect(retention.admission[0]?.resultingAuthorityVersion).toBe(17);
    expect(retention.admission.at(-1)?.resultingAuthorityVersion).toBe(80);
    expect(keys).toEqual(retention.admission.map((entry) => entry.key));
    expect(await store.load()).toEqual(current);
  });

  it('rebuilds a malformed retention index and prunes a paginated legacy tail', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const legacyFrontier = 200;
    const legacySnapshot = {
      ...initial,
      authorityVersion: legacyFrontier,
    };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      snapshot: legacySnapshot,
    });
    storage.values.set(JOURNAL_RETENTION_STORAGE_KEY, {
      format: 'corrupt-retention-index',
      frontierAuthorityVersion: legacyFrontier,
    });
    for (let version = 1; version <= legacyFrontier; version += 1) {
      storage.values.set(`authority:journal:legacy-${version}`, {
        format: 'ptcgsim-room-authority-v6',
        resultingAuthorityVersion: version,
      });
    }

    const transaction = rejectedTransaction(legacySnapshot);
    await store.commit(transaction);

    const retention = observedRetentionIndex(storage);
    expect(retention.frontierAuthorityVersion).toBe(legacyFrontier + 1);
    expect(retention.authority).toHaveLength(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(retention.authority[0]?.resultingAuthorityVersion).toBe(74);
    expect(retention.authority.at(-1)?.resultingAuthorityVersion).toBe(201);
    expect(storedKeys(storage, 'authority:journal:')).toEqual(
      retention.authority.map((entry) => entry.key).sort()
    );
    expect(await store.load()).toEqual(transaction.snapshot);
  });

  it('uses the byte ceiling while rebuilding oversized legacy audit rows', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const legacyFrontier = 8;
    const legacySnapshot = { ...initial, authorityVersion: legacyFrontier };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      snapshot: legacySnapshot,
    });
    storage.values.delete(JOURNAL_RETENTION_STORAGE_KEY);
    for (let version = 1; version <= legacyFrontier; version += 1) {
      storage.values.set(`authority:journal:large-${version}`, {
        format: 'ptcgsim-room-authority-v6',
        resultingAuthorityVersion: version,
        padding: 'x'.repeat(96 * 1024),
      });
    }

    const transaction = rejectedTransaction(legacySnapshot);
    await store.commit(transaction);

    const retention = observedRetentionIndex(storage);
    expect(retention.authority.length).toBeLessThan(legacyFrontier + 1);
    expect(
      retention.authority.reduce((total, entry) => total + entry.bytes, 0)
    ).toBeLessThanOrEqual(MAX_AUTHORITY_JOURNAL_BYTES);
    expect(retention.authority.at(-1)?.resultingAuthorityVersion).toBe(9);
    expect(storedKeys(storage, 'authority:journal:')).toEqual(
      retention.authority.map((entry) => entry.key).sort()
    );
  });

  it('rolls snapshot, journal, and retention index back when pruning fails', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    let current = initialSnapshot();
    await store.initialize(current);
    for (let index = 0; index < MAX_AUTHORITY_JOURNAL_ENTRIES; index += 1) {
      const transaction = rejectedTransaction(current);
      await store.commit(transaction);
      current = transaction.snapshot;
    }
    const beforeIndex = structuredClone(observedRetentionIndex(storage));
    const beforeKeys = storedKeys(storage, 'authority:journal:');
    storage.failDeleteWhenKeyStartsWith = 'authority:journal:';

    await expect(store.commit(rejectedTransaction(current))).rejects.toThrow(
      'injected transactional delete failure'
    );

    expect(await store.load()).toEqual(current);
    expect(observedRetentionIndex(storage)).toEqual(beforeIndex);
    expect(storedKeys(storage, 'authority:journal:')).toEqual(beforeKeys);
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

  it('journals ticket issuance and redemption without persisting the bearer', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const ticket = 'socket-ticket-never-persisted-000000000001';
    const ticketDigest = 'd'.repeat(64);
    const initial: RoomAuthoritySnapshot = {
      ...initialSnapshot(),
      admission: createRoomAdmissionState({
        playerIds: [p1, p2],
        seatCapabilityDigests: {
          [p1]: 'a'.repeat(64),
          [p2]: 'b'.repeat(64),
        },
      }),
    };
    await store.initialize(initial);
    const issued: RoomAuthoritySnapshot = {
      ...initial,
      authorityVersion: 1,
      admission: {
        ...initial.admission!,
        tickets: {
          [ticketDigest]: {
            role: 'player',
            playerId: p1,
            displayName: 'Blue',
            expiresAt: 40_000,
          },
        },
      },
    };
    await store.commitAdmission({
      expectedAuthorityVersion: 0,
      snapshot: issued,
      kind: 'ticket_issued',
      ticketDigest,
    });

    const sessionId = 'ticket-session-000000000001';
    const session = {
      id: sessionId,
      viewer: { kind: 'player' as const, playerId: p1 },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
      resumeCapabilityDigest: 'c'.repeat(64),
    };
    const redeemed: RoomAuthoritySnapshot = {
      ...issued,
      authorityVersion: 2,
      sessions: { [sessionId]: session },
      admission: {
        ...issued.admission!,
        seats: {
          ...issued.admission!.seats,
          [p1]: {
            ...issued.admission!.seats[p1]!,
            claimedSessionId: sessionId,
          },
        },
        tickets: {},
      },
    };
    storage.failPutWhenKeyStartsWith = 'authority:admission:';
    await expect(
      store.commitAdmission({
        expectedAuthorityVersion: 1,
        snapshot: redeemed,
        sessionId,
        kind: 'seat_claimed',
        admissionTicketDigest: ticketDigest,
      })
    ).rejects.toThrow('injected transactional put failure');
    expect(
      (await store.load())?.admission?.tickets[ticketDigest]
    ).toBeDefined();

    storage.failPutWhenKeyStartsWith = undefined;
    await store.commitAdmission({
      expectedAuthorityVersion: 1,
      snapshot: redeemed,
      sessionId,
      kind: 'seat_claimed',
      admissionTicketDigest: ticketDigest,
    });

    expect((await store.load())?.admission?.tickets).toEqual({});
    const serialized = JSON.stringify([...storage.values]);
    expect(serialized).not.toContain(ticket);
    const entries = [...storage.values.values()].filter(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        (value.kind === 'ticket_issued' || value.kind === 'seat_claimed')
    );
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'ticket_issued', ticketDigest }),
      expect.objectContaining({
        kind: 'seat_claimed',
        sessionId,
        admissionTicketDigest: ticketDigest,
      }),
    ]);
  });

  it('atomically journals an invitation digest without persisting its bearer', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const invitation = 'room-invitation-never-persisted-000000001';
    const invitationDigest = 'e'.repeat(64);
    const initial: RoomAuthoritySnapshot = {
      ...initialSnapshot(),
      admission: createRoomAdmissionState({
        playerIds: [p1, p2],
        seatCapabilityDigests: {
          [p1]: 'a'.repeat(64),
          [p2]: 'b'.repeat(64),
        },
      }),
    };
    await store.initialize(initial);
    const issued: RoomAuthoritySnapshot = {
      ...initial,
      authorityVersion: 1,
      admission: {
        ...initial.admission!,
        invitations: {
          [invitationDigest]: {
            role: 'player',
            playerId: p2,
            expiresAt: 910_000,
          },
        },
      },
    };

    await store.commitAdmission({
      expectedAuthorityVersion: 0,
      snapshot: issued,
      kind: 'invitation_issued',
      invitationDigest,
    });

    expect((await store.load())?.admission?.invitations).toEqual(
      issued.admission?.invitations
    );
    expect(JSON.stringify([...storage.values])).not.toContain(invitation);
    expect(
      [...storage.values.values()].find(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          value.kind === 'invitation_issued'
      )
    ).toMatchObject({
      expectedAuthorityVersion: 0,
      resultingAuthorityVersion: 1,
      kind: 'invitation_issued',
      invitationDigest,
    });
  });

  it('migrates v4 admission state with an empty ticket registry', async () => {
    const storage = new MemoryDurableStorage();
    const current = initialSnapshot();
    const admission = createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: 'a'.repeat(64),
        [p2]: 'b'.repeat(64),
      },
    });
    const {
      invitations: _invitations,
      tickets: _tickets,
      ...legacyAdmission
    } = admission;
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v4',
      snapshot: {
        ...current,
        schemaVersion: 4,
        admission: legacyAdmission,
      },
    });

    const restored = await new DurableRoomSnapshotStore(storage).load();
    expect(restored).toMatchObject({
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      admission: { invitations: {}, tickets: {} },
    });
  });

  it('migrates v5 admission tickets with an empty invitation registry', async () => {
    const storage = new MemoryDurableStorage();
    const current = initialSnapshot();
    const admission = createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: 'a'.repeat(64),
        [p2]: 'b'.repeat(64),
      },
    });
    const ticketDigest = 'd'.repeat(64);
    const { invitations: _invitations, ...legacyAdmissionBase } = admission;
    const legacyAdmission = {
      ...legacyAdmissionBase,
      tickets: {
        [ticketDigest]: {
          role: 'spectator' as const,
          displayName: 'Viewer',
          expiresAt: 40_000,
        },
      },
    };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v5',
      snapshot: {
        ...current,
        schemaVersion: 5,
        admission: legacyAdmission,
      },
    });

    const restored = await new DurableRoomSnapshotStore(storage).load();
    expect(restored).toMatchObject({
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      admission: {
        invitations: {},
        tickets: {
          [ticketDigest]: {
            role: 'spectator',
            displayName: 'Viewer',
            expiresAt: 40_000,
          },
        },
      },
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

  it('rejects skipped authority frontiers before writing either journal lane', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const command = acceptedTransaction(initial);

    await expect(
      store.commit({
        ...command,
        snapshot: { ...command.snapshot, authorityVersion: 2 },
      })
    ).rejects.toThrow('advance exactly one version');
    const admission = resumedTransaction(initial);
    await expect(
      store.commitAdmission({
        ...admission,
        snapshot: { ...admission.snapshot, authorityVersion: 2 },
      })
    ).rejects.toThrow('advance exactly one version');

    expect(await store.load()).toEqual(initial);
    expect(storedKeys(storage, 'authority:journal:')).toEqual([]);
    expect(storedKeys(storage, 'authority:admission:')).toEqual([]);
    expect(observedRetentionIndex(storage)).toMatchObject({
      frontierAuthorityVersion: 0,
      authority: [],
      admission: [],
    });
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

  it('fails closed when a direct caller supplies a forged or stale validation proof', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const transaction = acceptedTransaction(initial);
    const corruptSnapshot = {
      ...transaction.snapshot,
      replayHistory: {
        ...transaction.snapshot.replayHistory,
        baseStateHash: 'corrupt',
      },
    };

    await expect(
      store.commit({
        ...transaction,
        snapshot: corruptSnapshot,
        snapshotValidation: {} as AuthoritySnapshotValidation,
      })
    ).rejects.toThrow('replay base hash does not match');
    await expect(
      store.commit({
        ...transaction,
        snapshot: corruptSnapshot,
        snapshotValidation: validateAuthoritySnapshot(transaction.snapshot),
      })
    ).rejects.toThrow('replay base hash does not match');
    expect(await store.load()).toEqual(initial);
  });

  it('validates every proofless command envelope field against durable current', async () => {
    const cases: readonly {
      readonly name: string;
      readonly mutate: (
        transaction: PersistedAuthorityTransaction
      ) => PersistedAuthorityTransaction;
      readonly message: string;
    }[] = [
      {
        name: 'wrong expected revision',
        mutate: (transaction) => ({ ...transaction, expectedRevision: 1 }),
        message: 'state revision changed',
      },
      {
        name: 'missing accepted batch',
        mutate: ({ eventBatch: _eventBatch, ...transaction }) => transaction,
        message: 'invalid or missing event batch',
      },
      {
        name: 'mismatched accepted batch',
        mutate: (transaction) => ({
          ...transaction,
          eventBatch: {
            revision: 1,
            events: [
              {
                type: 'CoinFlipped',
                playerId: p1,
                result: 'tails',
              },
            ],
          },
        }),
        message: 'replay is not an appended suffix',
      },
      {
        name: 'reclassified accepted outcome',
        mutate: (transaction) => ({
          ...transaction,
          outcome: {
            ...transaction.outcome,
            accepted: false,
            code: 'precondition_failed',
          },
        }),
        message: 'rejected command cannot contain an event batch',
      },
      {
        name: 'accepted outcome with rejection code',
        mutate: (transaction) => ({
          ...transaction,
          outcome: {
            ...transaction.outcome,
            code: 'precondition_failed',
          },
        }),
        message: 'accepted command outcome cannot contain a rejection code',
      },
      {
        name: 'empty command ID',
        mutate: (transaction) => ({
          ...transaction,
          outcome: { ...transaction.outcome, commandId: '' },
        }),
        message: 'command outcome metadata is malformed',
      },
      {
        name: 'oversized command ID',
        mutate: (transaction) => ({
          ...transaction,
          outcome: { ...transaction.outcome, commandId: 'x'.repeat(129) },
        }),
        message: 'command outcome metadata is malformed',
      },
      {
        name: 'empty session ID',
        mutate: (transaction) => ({ ...transaction, sessionId: '' }),
        message: 'command session ID is malformed',
      },
      {
        name: 'wrong session',
        mutate: (transaction) => ({
          ...transaction,
          sessionId: 'another-session',
        }),
        message: 'changed the session registry',
      },
      {
        name: 'wrong client sequence',
        mutate: (transaction) => ({
          ...transaction,
          outcome: { ...transaction.outcome, clientSequence: 2 },
        }),
        message: 'sequence does not match session frontier',
      },
      {
        name: 'wrong outcome revision',
        mutate: (transaction) => ({
          ...transaction,
          outcome: { ...transaction.outcome, revision: 0 },
        }),
        message: 'invalid resulting revision',
      },
    ];

    for (const testCase of cases) {
      const storage = new MemoryDurableStorage();
      const store = new DurableRoomSnapshotStore(storage);
      const initial = initialSnapshot();
      await store.initialize(initial);

      await expect(
        store.commit(testCase.mutate(acceptedTransaction(initial))),
        testCase.name
      ).rejects.toThrow(testCase.message);
      expect(await store.load(), testCase.name).toEqual(initial);
      expect(storedKeys(storage, 'authority:journal:'), testCase.name).toEqual(
        []
      );
    }
  });

  it('rejects proofless rejected outcomes with missing or invalid codes', async () => {
    for (const code of [undefined, 'not-a-rejection-code'] as const) {
      const storage = new MemoryDurableStorage();
      const store = new DurableRoomSnapshotStore(storage);
      const initial = initialSnapshot();
      await store.initialize(initial);
      const valid = rejectedTransaction(initial);
      const outcome = {
        ...valid.outcome,
        code,
      } as PersistedAuthorityTransaction['outcome'];
      const malformed: PersistedAuthorityTransaction = {
        ...valid,
        outcome,
        snapshot: {
          ...valid.snapshot,
          sessions: {
            ...valid.snapshot.sessions,
            session: {
              ...valid.snapshot.sessions.session!,
              recentOutcomes: [outcome],
            },
          },
        },
      };

      await expect(store.commit(malformed)).rejects.toThrow(
        'rejected command outcome has an invalid rejection code'
      );
      expect(await store.load()).toEqual(initial);
      expect(storedKeys(storage, 'authority:journal:')).toEqual([]);
    }
  });

  it('rejects an accepted envelope for a structurally valid rejected candidate', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const rejected = rejectedTransaction(initial);

    await expect(
      store.commit({
        ...rejected,
        outcome: {
          ...rejected.outcome,
          accepted: true,
          revision: 1,
          code: undefined,
        },
        eventBatch: acceptedTransaction(initial).eventBatch,
      })
    ).rejects.toThrow('does not produce the candidate state');
    expect(await store.load()).toEqual(initial);
    expect(storedKeys(storage, 'authority:journal:')).toEqual([]);
  });

  it('accepts a structurally verified batch that compaction removed immediately', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const transaction = acceptedTransaction(initial);
    const compacted: PersistedAuthorityTransaction = {
      ...transaction,
      snapshot: {
        ...transaction.snapshot,
        replayHistory: {
          baseState: transaction.snapshot.state,
          baseStateHash: stableHash(transaction.snapshot.state),
          entries: [],
        },
      },
    };

    await expect(store.commit(compacted)).resolves.toEqual({
      snapshotValidationMs: expect.any(Number),
      transactionMs: expect.any(Number),
    });
    expect((await store.load())?.state).toEqual(transaction.snapshot.state);
    const journal = [...storage.values.entries()].find(([key]) =>
      key.startsWith('authority:journal:')
    )?.[1];
    expect(journal).toMatchObject({
      expectedAuthorityVersion: transaction.expectedAuthorityVersion,
      resultingAuthorityVersion: compacted.snapshot.authorityVersion,
      expectedRevision: transaction.expectedRevision,
      resultingRevision: compacted.snapshot.state.revision,
      sessionId: transaction.sessionId,
      outcome: transaction.outcome,
      eventBatch: transaction.eventBatch,
    });
  });

  it('does not accept a command proof minted for another room at the same frontier', async () => {
    const foreign = initialSnapshot('foreign-room');
    let captured: PersistedAuthorityTransaction | undefined;
    let opaque = 0;
    await processAuthorityCommand(
      foreign,
      {
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'foreign-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      },
      {
        commandContext: {
          nextCardId: () => asCardInstanceId('foreign-card'),
          nextStackId: () => asStackId('foreign-stack'),
          nextInspectionId: () => asInspectionId('foreign-inspection'),
          nextWorkAreaId: () => asWorkAreaId('foreign-work-area'),
          shuffle: (values) => [...values],
          randomInt: () => 0,
        },
        opaqueIds: {
          nextOpaqueId: (kind) =>
            `foreign-${kind}-${String(++opaque).padStart(16, '0')}`,
        },
        persistence: {
          commit: async (transaction) => {
            captured = transaction;
          },
        },
        policy: DEFAULT_AUTHORITY_POLICY,
      }
    );
    if (!captured) throw new Error('foreign command was not captured');

    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const local = initialSnapshot('local-room');
    await store.initialize(local);
    await expect(store.commit(captured)).rejects.toThrow(
      'does not produce the candidate state'
    );
    expect(await store.load()).toEqual(local);
    expect(storedKeys(storage, 'authority:journal:')).toEqual([]);
  });

  it('validates and recursively freezes a proofless direct commit snapshot', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    const transaction = acceptedTransaction(initial);

    expect(transaction.snapshotValidation).toBeUndefined();
    expect(Object.isFrozen(transaction.snapshot)).toBe(false);

    await store.commit(transaction);

    expect(Object.isFrozen(transaction.snapshot)).toBe(true);
    expect(Object.isFrozen(transaction.snapshot.state)).toBe(true);
    expect(Object.isFrozen(transaction.snapshot.replayHistory)).toBe(true);
    expect(
      Object.isFrozen(
        transaction.snapshot.replayHistory.entries[0]?.batch.events[0]
      )
    ).toBe(true);
    expect(authoritySnapshotValidationFor(transaction.snapshot)).toBeDefined();
    const authorityJournal = [...storage.values.entries()].find(([key]) =>
      key.startsWith('authority:journal:')
    )?.[1] as { eventBatch?: unknown } | undefined;
    expect(authorityJournal?.eventBatch).toEqual(
      transaction.snapshot.replayHistory.entries.at(-1)?.batch
    );
    expect(JSON.stringify([...storage.values.values()])).not.toContain(
      'snapshotValidation'
    );
    expect(JSON.stringify([...storage.values.values()])).not.toContain(
      'replayHistoryTransition'
    );
  });

  it('returns a recursively frozen proof-bound snapshot after loading', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    await store.initialize(initialSnapshot());

    const restored = await store.load();

    expect(restored).toBeDefined();
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.state)).toBe(true);
    expect(Object.isFrozen(restored?.replayHistory)).toBe(true);
    expect(authoritySnapshotValidationFor(restored!)).toBeDefined();
  });

  it('fails closed on a corrupt replay checkpoint', async () => {
    const storage = new MemoryDurableStorage();
    const snapshot = initialSnapshot();
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
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
