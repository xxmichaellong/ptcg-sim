import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  MATCH_STATE_SCHEMA_VERSION,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createRoomAdmissionState,
  createReplayHistory,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from './durable-storage.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('corruption-player-one');
const p2 = asPlayerId('corruption-player-two');

const snapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('corruption-room'), [
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
    sessions: {},
    admission: createRoomAdmissionState({
      playerSeatLimit: 2,
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: 'a'.repeat(64),
        [p2]: 'b'.repeat(64),
      },
      spectatorCapabilityDigest: 'c'.repeat(64),
    }),
  };
};

const initializedStore = async () => {
  const storage = new MemoryDurableStorage();
  const store = new DurableRoomSnapshotStore(storage);
  await store.initialize(snapshot(), {
    createdAt: 1_000,
    unclaimedExpiresAt: 301_000,
  });
  return { storage, store };
};

/**
 * The durable store refuses to load persisted data it cannot fully validate,
 * so a partial write or a bad migration surfaces as a failed load rather than
 * as a corrupt match silently entering the authority.
 *
 * Several of those branches were unreachable from the suite: neutralising the
 * throw left every test green, because the existing malformed-lifecycle case
 * exercises only one of the three lifecycle branches, neither match-state
 * schema branch, and not the fencing-generation check. This covers the rest.
 *
 * Unlike the admission guards these are not attacker-facing -- storage is
 * written by the server -- so the realistic trigger is a migration defect
 * rather than an intruder. The generation case is the sharpest of them: it is
 * the token that keeps a stale durable instance from overwriting a newer one.
 *
 * Two neighbouring throws are deliberately left uncovered because they are
 * unreachable by construction, not untested: `migrateStoredSnapshot`'s
 * non-object check sits behind `isStoredSnapshot`, which has already proven the
 * value is an object, and `assertGenerationRotated`'s malformed-token check
 * only ever sees this module's own crypto-random generator.
 */
describe('durable storage corruption guards', () => {
  it('refuses a lifecycle record with an unknown format', async () => {
    const { storage, store } = await initializedStore();
    storage.values.set(ROOM_LIFECYCLE_STORAGE_KEY, {
      format: 'ptcgsim-room-lifecycle-v0',
      state: 'unclaimed',
      createdAt: 1_000,
      unclaimedExpiresAt: 301_000,
    });
    await expect(store.expireUnclaimedRoom(301_000)).rejects.toThrow(
      'lifecycle is malformed'
    );
  });

  it('refuses a lifecycle record with a non-integer creation time', async () => {
    const { storage, store } = await initializedStore();
    storage.values.set(ROOM_LIFECYCLE_STORAGE_KEY, {
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
      createdAt: 'yesterday',
      unclaimedExpiresAt: 301_000,
    });
    await expect(store.expireUnclaimedRoom(301_000)).rejects.toThrow(
      'lifecycle is malformed'
    );
  });

  it('refuses a claimed lifecycle missing its authority version', async () => {
    const { storage, store } = await initializedStore();
    storage.values.set(ROOM_LIFECYCLE_STORAGE_KEY, {
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'claimed',
      createdAt: 1_000,
    });
    await expect(store.expireUnclaimedRoom(301_000)).rejects.toThrow(
      'lifecycle is malformed'
    );
  });

  it('refuses a stored match state from an unsupported schema', async () => {
    const { storage, store } = await initializedStore();
    const stored = storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as {
      readonly snapshot: { readonly state: Record<string, unknown> };
    };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      ...stored,
      snapshot: {
        ...stored.snapshot,
        state: {
          ...stored.snapshot.state,
          schemaVersion: MATCH_STATE_SCHEMA_VERSION + 1,
        },
      },
    });
    await expect(store.load()).rejects.toThrow(/schema|malformed/u);
  });

  it('refuses a stored match state that is not an object at all', async () => {
    const { storage, store } = await initializedStore();
    const stored = storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as {
      readonly snapshot: Record<string, unknown>;
    };
    // A truncated or half-migrated write can leave a primitive here, which is
    // a different branch from an object carrying an unknown schema version.
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      ...stored,
      snapshot: { ...stored.snapshot, state: 'corrupted' },
    });
    await expect(store.load()).rejects.toThrow(/schema|malformed/u);
  });

  it('refuses a stored snapshot whose fencing generation is malformed', async () => {
    const { storage, store } = await initializedStore();
    const stored = storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as Record<
      string,
      unknown
    >;
    // The generation is the fencing token that stops a stale durable instance
    // from overwriting a newer one, so a value that is present but not a
    // 32-character hex mark must fail the load rather than fence against
    // nothing.
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      ...stored,
      generation: 'not-a-generation',
    });
    await expect(store.load()).rejects.toThrow('generation is malformed');
  });

  it('refuses a stored match state whose schema version is not a number', async () => {
    const { storage, store } = await initializedStore();
    const stored = storage.values.get(AUTHORITY_SNAPSHOT_STORAGE_KEY) as {
      readonly snapshot: { readonly state: Record<string, unknown> };
    };
    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, {
      ...stored,
      snapshot: {
        ...stored.snapshot,
        state: { ...stored.snapshot.state, schemaVersion: 'v2' },
      },
    });
    await expect(store.load()).rejects.toThrow(/schema|malformed/u);
  });
});
