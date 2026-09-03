import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  cloneMatchState,
  createEmptyMatch,
  MATCH_STATE_SCHEMA_VERSION,
  playerZoneId,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  appendReplayHistory,
  createRoomAdmissionState,
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
    const store = new DurableRoomSnapshotStore(storage);
    const initial = initialSnapshot();
    await store.initialize(initial);
    expect(storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toMatchObject({
      format: 'ptcgsim-room-authority-v6',
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
