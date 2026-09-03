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
  executeCommand,
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
  projectRecipient,
  validateAuthoritySnapshot,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type AuthoritySnapshotValidation,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomAlreadyInitializedError,
  RoomExpiredError,
  type StoredAuthorityFrontier,
} from './durable-storage.js';
import {
  JOURNAL_RETENTION_STORAGE_KEY,
  MAX_ADMISSION_JOURNAL_BYTES,
  MAX_ADMISSION_JOURNAL_ENTRIES,
  MAX_AUTHORITY_JOURNAL_BYTES,
  MAX_AUTHORITY_JOURNAL_ENTRIES,
} from './journal-retention.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

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

const snapshotWithActiveAlias = (): RoomAuthoritySnapshot => {
  const initial = initialSnapshot('durable-alias-integrity');
  const loaded = executeCommand(
    initial.state,
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('durable-alias-definition'),
            name: 'Durable alias',
            category: 'Trainer',
            imageUrl: '/durable-alias.png',
          },
          count: 1,
        },
      ],
    },
    {
      nextCardId: () => asCardInstanceId('durable-alias-card'),
      nextStackId: () => asStackId('durable-alias-stack'),
      nextInspectionId: () => asInspectionId('durable-alias-inspection'),
      nextWorkAreaId: () => asWorkAreaId('durable-alias-work'),
      shuffle: (values) => [...values],
      randomInt: () => 0,
    }
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  const projected = projectRecipient(
    loaded.state,
    { kind: 'player', playerId: p1 },
    emptyProjectionIdentityState(),
    { nextOpaqueId: () => 'durable-alias-opaque-id-0001' }
  );
  return {
    ...initial,
    state: loaded.state,
    replayHistory: createReplayHistory(loaded.state),
    identities: projected.identities,
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

const capturedAcceptedTransaction = async (
  current: RoomAuthoritySnapshot,
  commandId: string
): Promise<PersistedAuthorityTransaction> => {
  let captured: PersistedAuthorityTransaction | undefined;
  await processAuthorityCommand(
    current,
    {
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: current.sessions.session!.nextClientSequence,
      commandId,
      lastSeenRevision: current.state.revision,
      command: { type: 'FlipCoin' },
    },
    {
      commandContext: {
        nextCardId: () => asCardInstanceId('unused-card'),
        nextStackId: () => asStackId('unused-stack'),
        nextInspectionId: () => asInspectionId('unused-inspection'),
        nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
        shuffle: (values) => [...values],
        randomInt: () => 0,
      },
      opaqueIds: { nextOpaqueId: (kind) => `captured-${kind}-opaque-id` },
      persistence: {
        commit: async (transaction) => {
          captured = transaction;
        },
      },
      policy: DEFAULT_AUTHORITY_POLICY,
      currentSnapshotValidation: authoritySnapshotValidationFor(current),
    }
  );
  if (!captured)
    throw new Error('Accepted command transaction was not captured');
  return captured;
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

const nextGeneration = (() => {
  let generation = 0;
  return (): string => (++generation).toString(16).padStart(32, '0');
})();

const storedFrontier = (
  storage: MemoryDurableStorage
): StoredAuthorityFrontier =>
  storage.values.get(AUTHORITY_FRONTIER_STORAGE_KEY) as StoredAuthorityFrontier;

const testFrontier = (
  snapshot: RoomAuthoritySnapshot,
  generation = '1'.repeat(32)
): StoredAuthorityFrontier => ({
  format: 'ptcgsim-authority-frontier-v1',
  envelopeFormat: 'ptcgsim-room-authority-v6',
  authoritySchemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  matchStateSchemaVersion: MATCH_STATE_SCHEMA_VERSION,
  matchId: snapshot.state.matchId,
  mode: snapshot.mode,
  authorityVersion: snapshot.authorityVersion,
  stateRevision: snapshot.state.revision,
  generation,
});

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

  it('fails closed when an active-viewer alias is stale or forges knownness on restore', async () => {
    for (const mutation of ['generation', 'known'] as const) {
      const storage = new MemoryDurableStorage();
      const snapshot = snapshotWithActiveAlias();
      const alias = snapshot.identities.cardAliases[0]!;
      const corrupted: RoomAuthoritySnapshot = {
        ...snapshot,
        identities: {
          ...snapshot.identities,
          cardAliases: [
            mutation === 'generation'
              ? {
                  ...alias,
                  visibilityGeneration: alias.visibilityGeneration + 1,
                }
              : { ...alias, known: !alias.known },
          ],
        },
      };
      storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
        format: 'ptcgsim-room-authority-v6',
        generation: 'a'.repeat(32),
        snapshot: corrupted,
      });

      await expect(
        new DurableRoomSnapshotStore(storage).load()
      ).rejects.toThrow(
        'active projection alias is stale or has invalid visibility'
      );
    }
  });

  it('atomically initializes a generated snapshot/frontier pair and rejects an orphan frontier', async () => {
    const initial = initialSnapshot();
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(
      storage,
      () => 0,
      () => 'a'.repeat(32)
    );

    await store.initialize(initial);
    expect(storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toMatchObject({
      format: 'ptcgsim-room-authority-v6',
      generation: 'a'.repeat(32),
      snapshot: initial,
    });
    expect(storedFrontier(storage)).toEqual(
      testFrontier(initial, 'a'.repeat(32))
    );

    const failed = new MemoryDurableStorage();
    failed.failPutWhenKeyStartsWith = AUTHORITY_FRONTIER_STORAGE_KEY;
    await expect(
      new DurableRoomSnapshotStore(failed).initialize(initialSnapshot())
    ).rejects.toThrow('injected transactional put failure');
    expect(failed.values.size).toBe(0);

    const orphaned = new MemoryDurableStorage();
    orphaned.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, testFrontier(initial));
    await expect(
      new DurableRoomSnapshotStore(orphaned).initialize(initialSnapshot())
    ).rejects.toThrow('frontier has no snapshot');
    expect(orphaned.values.has(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toBe(false);
  });

  it('backfills old v6 snapshots and repairs missing or malformed frontiers only after full validation', async () => {
    const cases: readonly unknown[] = [
      undefined,
      { format: 'unsupported' },
      { ...testFrontier(initialSnapshot()), generation: 'A'.repeat(32) },
      { ...testFrontier(initialSnapshot()), authoritySchemaVersion: 999 },
      { ...testFrontier(initialSnapshot()), unexpected: true },
    ];

    for (const [index, rawFrontier] of cases.entries()) {
      const storage = new MemoryDurableStorage();
      const initial = initialSnapshot(`repair-room-${index}`);
      const generation = String(index + 1).padStart(32, '0');
      storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
        format: 'ptcgsim-room-authority-v6',
        ...(index === 0 ? {} : { generation }),
        snapshot: initial,
      });
      if (rawFrontier !== undefined) {
        storage.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, rawFrontier);
      }
      const restored = await new DurableRoomSnapshotStore(
        storage,
        () => 0,
        () => generation
      ).load();

      expect(restored).toEqual(initial);
      expect(Object.isFrozen(restored)).toBe(true);
      const envelope = storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as {
        generation?: string;
      };
      expect(envelope.generation).toBe(generation);
      expect(storedFrontier(storage)).toEqual(
        testFrontier(initial, generation)
      );
    }

    const corruptStorage = new MemoryDurableStorage();
    const initial = initialSnapshot('corrupt-paired-room');
    const generation = 'c'.repeat(32);
    corruptStorage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      generation,
      snapshot: {
        ...initial,
        replayHistory: { ...initial.replayHistory, baseStateHash: 'corrupt' },
      },
    });
    corruptStorage.values.set(
      AUTHORITY_FRONTIER_STORAGE_KEY,
      testFrontier(initial, generation)
    );
    const before = structuredClone([...corruptStorage.values]);
    await expect(
      new DurableRoomSnapshotStore(corruptStorage).load()
    ).rejects.toThrow('replay base hash does not match');
    expect([...corruptStorage.values]).toEqual(before);
  });

  it('fails closed on orphaned or well-formed divergent frontiers', async () => {
    const initial = initialSnapshot();
    const orphaned = new MemoryDurableStorage();
    orphaned.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, testFrontier(initial));
    await expect(new DurableRoomSnapshotStore(orphaned).load()).rejects.toThrow(
      'frontier has no snapshot'
    );

    const divergent = new MemoryDurableStorage();
    const generation = 'd'.repeat(32);
    divergent.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: 'ptcgsim-room-authority-v6',
      generation,
      snapshot: initial,
    });
    divergent.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, {
      ...testFrontier(initial, generation),
      authorityVersion: 1,
    });
    const before = structuredClone([...divergent.values]);
    await expect(
      new DurableRoomSnapshotStore(divergent).load()
    ).rejects.toThrow('frontier diverges');
    expect([...divergent.values]).toEqual(before);
  });

  it('repairs rollback-era generation removal on the next command or admission commit', async () => {
    const commandStorage = new MemoryDurableStorage();
    const commandStore = new DurableRoomSnapshotStore(commandStorage);
    const initial = initialSnapshot('rollback-command-room');
    await commandStore.initialize(initial);
    const first = acceptedTransaction(initial);
    await commandStore.commit(first);
    const firstEnvelope = commandStorage.values.get(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    ) as { format: string; snapshot: RoomAuthoritySnapshot };
    commandStorage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: firstEnvelope.format,
      snapshot: firstEnvelope.snapshot,
    });

    const second = rejectedTransaction(first.snapshot);
    await expect(commandStore.commit(second)).resolves.toMatchObject({
      frontierFastPathHit: 0,
    });
    expect(
      commandStorage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)
    ).toMatchObject({ generation: expect.stringMatching(/^[0-9a-f]{32}$/u) });
    expect(storedFrontier(commandStorage).authorityVersion).toBe(2);

    const admissionStorage = new MemoryDurableStorage();
    const admissionStore = new DurableRoomSnapshotStore(admissionStorage);
    const admissionInitial = initialSnapshot('rollback-admission-room');
    await admissionStore.initialize(admissionInitial);
    const firstAdmission = resumedTransaction(admissionInitial);
    await admissionStore.commitAdmission(firstAdmission);
    const admissionEnvelope = admissionStorage.values.get(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    ) as { format: string; snapshot: RoomAuthoritySnapshot };
    admissionStorage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: admissionEnvelope.format,
      snapshot: admissionEnvelope.snapshot,
    });

    await admissionStore.commitAdmission(
      resumedTransaction(firstAdmission.snapshot)
    );
    expect(
      admissionStorage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)
    ).toMatchObject({ generation: expect.stringMatching(/^[0-9a-f]{32}$/u) });
    expect(storedFrontier(admissionStorage).authorityVersion).toBe(2);
  });

  it('rejects a command against a divergent persisted frontier before writing', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    storage.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, {
      ...storedFrontier(storage),
      stateRevision: 1,
    });
    const before = structuredClone([...storage.values]);

    await expect(store.commit(acceptedTransaction(initial))).rejects.toThrow(
      'frontier diverges'
    );
    expect([...storage.values]).toEqual(before);
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

  it('validates frontier consistency before expiry and repairs a rollback-era pair', async () => {
    const divergentStorage = new MemoryDurableStorage();
    const divergentStore = new DurableRoomSnapshotStore(divergentStorage);
    await divergentStore.initialize(unclaimedSnapshot(), {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    divergentStorage.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, {
      ...storedFrontier(divergentStorage),
      authorityVersion: 1,
    });
    const divergentBefore = structuredClone([...divergentStorage.values]);
    await expect(divergentStore.expireUnclaimedRoom(2_000)).rejects.toThrow(
      'frontier diverges'
    );
    expect([...divergentStorage.values]).toEqual(divergentBefore);
    expect(divergentStorage.alarm).toBe(301_000);

    const rollbackStorage = new MemoryDurableStorage();
    const rollbackStore = new DurableRoomSnapshotStore(
      rollbackStorage,
      () => 0,
      nextGeneration
    );
    await rollbackStore.initialize(unclaimedSnapshot(), {
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    const oldGeneration = storedFrontier(rollbackStorage).generation;
    const envelope = rollbackStorage.values.get(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    ) as { format: string; snapshot: RoomAuthoritySnapshot };
    rollbackStorage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      format: envelope.format,
      snapshot: envelope.snapshot,
    });

    await expect(rollbackStore.expireUnclaimedRoom(2_000)).resolves.toBe(
      'scheduled'
    );
    const repairedEnvelope = rollbackStorage.values.get(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    ) as { generation?: string; snapshot: RoomAuthoritySnapshot };
    expect(repairedEnvelope.generation).toMatch(/^[0-9a-f]{32}$/u);
    expect(repairedEnvelope.generation).not.toBe(oldGeneration);
    if (!repairedEnvelope.generation) {
      throw new Error('Rollback-era envelope was not assigned a generation');
    }
    expect(storedFrontier(rollbackStorage)).toEqual(
      testFrontier(repairedEnvelope.snapshot, repairedEnvelope.generation)
    );
    expect(rollbackStorage.alarm).toBe(301_000);
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

    const marks = [0, 5, 10, 15, 20, 25];
    const store = new DurableRoomSnapshotStore(storage, () => marks.shift()!);
    const transaction = acceptedTransaction(initial);
    await expect(store.commit(transaction)).resolves.toEqual({
      snapshotValidationMs: 5,
      predecessorValidationMs: 5,
      frontierFastPathHit: 0,
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
      predecessorValidationMs: 0,
      frontierFastPathHit: 0,
      transactionMs: 0,
    });
    expect(await clockFailureStore.load()).toEqual(nextTransaction.snapshot);
  });

  it('reports only the final retried transaction callback timing', async () => {
    const storage = new MemoryDurableStorage();
    const initial = initialSnapshot('retry-timing-room');
    const marks = [0, 1, 2, 20, 27, 40];
    const store = new DurableRoomSnapshotStore(storage, () => marks.shift()!);
    await store.initialize(initial);
    const transaction = await capturedAcceptedTransaction(
      initial,
      'retried-frontier-command'
    );
    storage.retryTransactionOnce = true;
    storage.beforeTransactionRetry = () => {
      storage.values.delete(AUTHORITY_FRONTIER_STORAGE_KEY);
    };
    storage.transactionGetKeys = [];

    await expect(store.commit(transaction)).resolves.toEqual({
      snapshotValidationMs: 1,
      predecessorValidationMs: 7,
      frontierFastPathHit: 0,
      transactionMs: 38,
    });
    expect(
      storage.transactionGetKeys.filter(
        (key) => key === AUTHORITY_SNAPSHOT_STORAGE_KEY
      )
    ).toHaveLength(1);
    expect(marks).toEqual([]);
  });

  it('rejects a repeated generation source before command or admission writes', async () => {
    const repeated = 'a'.repeat(32);
    const commandStorage = new MemoryDurableStorage();
    const commandStore = new DurableRoomSnapshotStore(
      commandStorage,
      () => 0,
      () => repeated
    );
    const initial = initialSnapshot('repeated-command-generation');
    await commandStore.initialize(initial);
    const commandBefore = structuredClone([...commandStorage.values]);
    await expect(
      commandStore.commit(acceptedTransaction(initial))
    ).rejects.toThrow('generation did not rotate');
    expect([...commandStorage.values]).toEqual(commandBefore);

    const admissionStorage = new MemoryDurableStorage();
    const admissionStore = new DurableRoomSnapshotStore(
      admissionStorage,
      () => 0,
      () => repeated
    );
    const admissionInitial = initialSnapshot('repeated-admission-generation');
    await admissionStore.initialize(admissionInitial);
    const admissionBefore = structuredClone([...admissionStorage.values]);
    await expect(
      admissionStore.commitAdmission(resumedTransaction(admissionInitial))
    ).rejects.toThrow('generation did not rotate');
    expect([...admissionStorage.values]).toEqual(admissionBefore);
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
    const dependencies = {
      commandContext: {
        nextCardId: () => asCardInstanceId(`canonical-card-${++card}`),
        nextStackId: () => asStackId(`canonical-stack-${++stack}`),
        nextInspectionId: () =>
          asInspectionId(`canonical-inspection-${++inspection}`),
        nextWorkAreaId: () => asWorkAreaId(`canonical-work-area-${++workArea}`),
        shuffle: <Value>(values: readonly Value[]) => [...values].reverse(),
        randomInt: () => 0,
      },
      opaqueIds: {
        nextOpaqueId: (kind: string) =>
          `canonical-${kind}-${String(++opaque).padStart(12, '0')}`,
      },
      persistence: store,
      policy: DEFAULT_AUTHORITY_POLICY,
    };

    storage.transactionGetKeys = [];
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
        ...dependencies,
        currentSnapshotValidation: authoritySnapshotValidationFor(initial),
      }
    );

    expect(result.timing.breakdown.frontierFastPathHit).toBe(1);
    expect(storage.transactionGetKeys).not.toContain(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
    const firstGeneration = storedFrontier(storage).generation;

    storage.transactionGetKeys = [];
    const rejected = await processAuthorityCommand(
      result.snapshot,
      {
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 2,
        commandId: 'canonical-rejected-command',
        lastSeenRevision: 1,
        command: { type: 'ApplySoloUndo', targetPlayerId: p1 },
      },
      {
        ...dependencies,
        currentSnapshotValidation: result.snapshotValidation,
      }
    );
    expect(rejected.committed).toBe(true);
    expect(rejected.snapshot.state).toBe(result.snapshot.state);
    expect(rejected.snapshot.replayHistory).toBe(result.snapshot.replayHistory);
    expect(rejected.timing.breakdown.frontierFastPathHit).toBe(1);
    expect(storage.transactionGetKeys).not.toContain(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
    expect(storedFrontier(storage).generation).not.toBe(firstGeneration);

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
    expect(
      JSON.stringify(
        [...storage.values.entries()].filter(([key]) =>
          key.startsWith('authority:journal:')
        )
      )
    ).not.toContain('generation');
  });

  it('uses the frontier fast path when an accepted batch is compacted away immediately', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    storage.transactionGetKeys = [];
    let opaque = 0;

    const result = await processAuthorityCommand(
      initial,
      {
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'fast-compacted-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      },
      {
        commandContext: {
          nextCardId: () => asCardInstanceId('unused-card'),
          nextStackId: () => asStackId('unused-stack'),
          nextInspectionId: () => asInspectionId('unused-inspection'),
          nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
          shuffle: (values) => [...values],
          randomInt: () => 0,
        },
        opaqueIds: {
          nextOpaqueId: (kind) => `compacted-${kind}-${++opaque}`,
        },
        persistence: store,
        policy: {
          ...DEFAULT_AUTHORITY_POLICY,
          maximumReplayEventBatches: 1,
          maximumReplayEventBytes: 2,
        },
        currentSnapshotValidation: authoritySnapshotValidationFor(initial),
      }
    );

    expect(result.snapshot.replayHistory.entries).toEqual([]);
    expect(result.timing.breakdown.frontierFastPathHit).toBe(1);
    expect(storage.transactionGetKeys).not.toContain(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
    const journal = [...storage.values.entries()].find(([key]) =>
      key.startsWith('authority:journal:')
    )?.[1] as { eventBatch?: { revision: number } } | undefined;
    expect(journal?.eventBatch?.revision).toBe(1);
  });

  it('keeps solo commands on the full predecessor-validation path', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = {
      ...initialSnapshot('solo-frontier-room'),
      mode: 'solo' as const,
    };
    await store.initialize(initial);
    storage.transactionGetKeys = [];

    const result = await processAuthorityCommand(
      initial,
      {
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'solo-frontier-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      },
      {
        commandContext: {
          nextCardId: () => asCardInstanceId('unused-card'),
          nextStackId: () => asStackId('unused-stack'),
          nextInspectionId: () => asInspectionId('unused-inspection'),
          nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
          shuffle: (values) => [...values],
          randomInt: () => 0,
        },
        opaqueIds: { nextOpaqueId: (kind) => `solo-${kind}-opaque-id` },
        persistence: store,
        policy: DEFAULT_AUTHORITY_POLICY,
        currentSnapshotValidation: authoritySnapshotValidationFor(initial),
      }
    );

    expect(result.committed).toBe(true);
    expect(result.timing.breakdown.frontierFastPathHit).toBe(0);
    expect(storage.transactionGetKeys).toContain(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
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
    const beforeRetry = structuredClone([...storage.values]);

    await expect(store.commit(transaction)).rejects.toBeInstanceOf(
      ConcurrentRoomWriteError
    );
    expect([...storage.values]).toEqual(beforeRetry);
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

  it('rotates the frontier for every admission kind while fully reading its predecessor', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(
      storage,
      () => 0,
      nextGeneration
    );
    let current = initialSnapshot('admission-frontier-room');
    await store.initialize(current);
    let previousGeneration = storedFrontier(storage).generation;
    const transactions: readonly PersistedAdmissionTransaction[] = [
      {
        expectedAuthorityVersion: 0,
        kind: 'invitation_issued',
        invitationDigest: 'a'.repeat(64),
        snapshot: { ...current, authorityVersion: 1 },
      },
      {
        expectedAuthorityVersion: 1,
        kind: 'ticket_issued',
        ticketDigest: 'b'.repeat(64),
        snapshot: { ...current, authorityVersion: 2 },
      },
      {
        expectedAuthorityVersion: 2,
        kind: 'session_resumed',
        sessionId: 'session',
        snapshot: { ...current, authorityVersion: 3 },
      },
    ];

    for (const transaction of transactions) {
      storage.transactionGetKeys = [];
      await store.commitAdmission(transaction);
      current = transaction.snapshot;
      expect(storage.transactionGetKeys).toContain(
        AUTHORITY_SNAPSHOT_STORAGE_KEY
      );
      expect(storedFrontier(storage)).toMatchObject({
        authorityVersion: transaction.snapshot.authorityVersion,
        stateRevision: transaction.snapshot.state.revision,
      });
      expect(storedFrontier(storage).generation).not.toBe(previousGeneration);
      previousGeneration = storedFrontier(storage).generation;
    }
  });

  it('invalidates its cache after definite and ambiguous transaction failures', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot('failure-cache-room');
    await store.initialize(initial);
    const first = acceptedTransaction(initial);

    storage.failPutWhenKeyStartsWith = 'authority:journal:';
    await expect(store.commit(first)).rejects.toThrow(
      'injected transactional put failure'
    );
    storage.failPutWhenKeyStartsWith = undefined;
    storage.transactionGetKeys = [];
    await expect(store.commit(first)).resolves.toMatchObject({
      frontierFastPathHit: 0,
    });
    expect(storage.transactionGetKeys).toContain(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );

    const second = rejectedTransaction(first.snapshot);
    storage.failAfterTransactionCommitOnce = true;
    await expect(store.commit(second)).rejects.toThrow(
      'injected ambiguous transaction failure'
    );
    expect(storedFrontier(storage).authorityVersion).toBe(2);
    const afterAmbiguousCommit = structuredClone([...storage.values]);
    await expect(store.commit(second)).rejects.toBeInstanceOf(
      ConcurrentRoomWriteError
    );
    expect([...storage.values]).toEqual(afterAmbiguousCommit);

    const restored = await store.load();
    expect(restored?.authorityVersion).toBe(2);
    expect(authoritySnapshotValidationFor(restored!)).toBeDefined();
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
      predecessorValidationMs: expect.any(Number),
      frontierFastPathHit: 0,
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
