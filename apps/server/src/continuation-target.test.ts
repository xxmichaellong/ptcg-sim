import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  stableHash,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomAlreadyInitializedError,
} from './durable-storage.js';
import { JOURNAL_RETENTION_STORAGE_KEY } from './journal-retention.js';
import type { ContinuationRestorePlan } from './continuation-restore-format.js';
import {
  deriveContinuationTargetRestoreDigest,
  initializeContinuationTarget,
} from './continuation-target.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('continuation-target-player-one');
const p2 = asPlayerId('continuation-target-player-two');
const saveId = 'A'.repeat(22);
const operationId = 'B'.repeat(43);
const reservedAt = 2_000_000_000_000;
const unclaimedExpiresAt = reservedAt + 15 * 60_000;
const targetRoomCode = 'BCDEFGHJ2345';
const roomContinuationOriginStorageKey = 'room:continuation-origin';
const requesterSeatCapability =
  'continuation-target-requester-seat-capability-00000001';
const requesterSeatDigest = 'ppZHI3ix1e8_XCNlOIt_S-226zb4wK_xGVxjQPI0UD4';
const opponentInvitation = 'continuation-target-opponent-invitation-000000002';
const opponentInvitationDigest = '6tmPSM5f-mLGXejcVES2IqQ_CZZipYBcLuX4jq7nDkE';

const targetSnapshot = (
  matchId = 'continuation-source-match'
): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId(matchId), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: requesterSeatDigest,
      [p2]: 'b'.repeat(43),
    },
  });
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: {
      ...admission,
      invitations: {
        [opponentInvitationDigest]: {
          role: 'player',
          playerId: p2,
          expiresAt: unclaimedExpiresAt,
        },
      },
    },
  };
};

const restorePlan = (snapshot = targetSnapshot()): ContinuationRestorePlan => ({
  format: 'ptcgsim-continuation-restore-plan-v1',
  saveId,
  operationId,
  reservedAt,
  targetRoomCode,
  targetUnclaimedExpiresAt: unclaimedExpiresAt,
  requesterPlayerId: p1,
  canonicalStateHash: stableHash(snapshot.state),
  snapshot,
  requesterSeatCapability,
  opponentInvitation: {
    invitation: opponentInvitation,
    expiresAt: unclaimedExpiresAt,
  },
});

const lifecycle = {
  createdAt: reservedAt,
  unclaimedExpiresAt,
};

describe('continuation target-room initialization', () => {
  it('atomically initializes the exact target with a digest-only origin marker', async () => {
    const storage = new MemoryDurableStorage();
    const store = new DurableRoomSnapshotStore(storage);
    const snapshot = targetSnapshot();
    const restoreDigest = 'D'.repeat(43);

    await expect(
      store.initializeContinuationTarget(snapshot, lifecycle, restoreDigest)
    ).resolves.toBe(true);
    expect(await store.load()).toEqual(snapshot);
    expect(storage.alarm).toBe(unclaimedExpiresAt);
    expect([...storage.values.keys()].sort()).toEqual(
      [
        AUTHORITY_FRONTIER_STORAGE_KEY,
        AUTHORITY_SNAPSHOT_STORAGE_KEY,
        JOURNAL_RETENTION_STORAGE_KEY,
        roomContinuationOriginStorageKey,
        ROOM_LIFECYCLE_STORAGE_KEY,
      ].sort()
    );
    const origin = storage.values.get(roomContinuationOriginStorageKey);
    expect(origin).toEqual({
      format: 'ptcgsim-room-continuation-origin-v1',
      restoreDigest,
    });
    expect(JSON.stringify(origin)).not.toContain(saveId);
    expect(JSON.stringify(origin)).not.toContain(operationId);
  });

  it('recovers only an exact retry and repairs its lifecycle alarm', async () => {
    const storage = new MemoryDurableStorage();
    const snapshot = targetSnapshot();
    const restoreDigest = 'D'.repeat(43);
    await new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
      snapshot,
      lifecycle,
      restoreDigest
    );
    const before = structuredClone(storage.values);
    storage.alarm = null;

    await expect(
      new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
        structuredClone(snapshot),
        { ...lifecycle },
        restoreDigest
      )
    ).resolves.toBe(false);
    expect(storage.alarm).toBe(unclaimedExpiresAt);
    expect(storage.values).toEqual(before);

    for (const attempt of [
      {
        snapshot: targetSnapshot('different-valid-saved-match'),
        lifecycle,
        restoreDigest,
      },
      {
        snapshot,
        lifecycle: {
          ...lifecycle,
          unclaimedExpiresAt: unclaimedExpiresAt + 1,
        },
        restoreDigest,
      },
      { snapshot, lifecycle, restoreDigest: 'E'.repeat(43) },
    ]) {
      await expect(
        new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
          attempt.snapshot,
          attempt.lifecycle,
          attempt.restoreDigest
        )
      ).rejects.toBeInstanceOf(RoomAlreadyInitializedError);
      expect(storage.values).toEqual(before);
    }
  });

  it('recovers an ambiguous committed initialization without rewriting it', async () => {
    const storage = new MemoryDurableStorage();
    const snapshot = targetSnapshot();
    const restoreDigest = 'D'.repeat(43);
    storage.failAfterTransactionCommitOnce = true;

    await expect(
      new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
        snapshot,
        lifecycle,
        restoreDigest
      )
    ).rejects.toThrow('ambiguous transaction failure');
    const committed = structuredClone(storage.values);
    await expect(
      new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
        structuredClone(snapshot),
        lifecycle,
        restoreDigest
      )
    ).resolves.toBe(false);
    expect(storage.values).toEqual(committed);
  });

  it('rolls back every target key and alarm when initialization fails', async () => {
    for (const failure of ['put', 'alarm'] as const) {
      const storage = new MemoryDurableStorage();
      if (failure === 'put') {
        storage.failPutWhenKeyStartsWith = roomContinuationOriginStorageKey;
      } else {
        storage.failSetAlarm = true;
      }
      await expect(
        new DurableRoomSnapshotStore(storage).initializeContinuationTarget(
          targetSnapshot(),
          lifecycle,
          'D'.repeat(43)
        )
      ).rejects.toThrow();
      expect(storage.values.size).toBe(0);
      expect(storage.alarm).toBeNull();
    }
  });

  it('fails closed for incomplete, corrupt, or ordinary occupied rooms', async () => {
    const partial = new MemoryDurableStorage();
    partial.values.set(roomContinuationOriginStorageKey, {
      format: 'ptcgsim-room-continuation-origin-v1',
      restoreDigest: 'D'.repeat(43),
    });
    await expect(
      new DurableRoomSnapshotStore(partial).initializeContinuationTarget(
        targetSnapshot(),
        lifecycle,
        'D'.repeat(43)
      )
    ).rejects.toThrow('incomplete');
    await expect(
      new DurableRoomSnapshotStore(partial).initialize(
        targetSnapshot(),
        lifecycle
      )
    ).rejects.toThrow('origin has no snapshot');

    const corrupt = new MemoryDurableStorage();
    const corruptStore = new DurableRoomSnapshotStore(corrupt);
    await corruptStore.initializeContinuationTarget(
      targetSnapshot(),
      lifecycle,
      'D'.repeat(43)
    );
    corrupt.values.set(roomContinuationOriginStorageKey, {
      format: 'ptcgsim-room-continuation-origin-v1',
      restoreDigest: 'short',
    });
    await expect(
      new DurableRoomSnapshotStore(corrupt).initializeContinuationTarget(
        targetSnapshot(),
        lifecycle,
        'D'.repeat(43)
      )
    ).rejects.toThrow('origin is malformed');

    const occupied = new MemoryDurableStorage();
    await new DurableRoomSnapshotStore(occupied).initialize(targetSnapshot());
    await expect(
      new DurableRoomSnapshotStore(occupied).initializeContinuationTarget(
        targetSnapshot(),
        lifecycle,
        'D'.repeat(43)
      )
    ).rejects.toBeInstanceOf(RoomAlreadyInitializedError);
  });

  it('derives one save-and-operation-bound marker before invoking the target store', async () => {
    const digestSource = new WebCryptoAuthoritySource();
    const expectedDigest = await deriveContinuationTargetRestoreDigest(
      saveId,
      operationId,
      digestSource
    );
    expect(expectedDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(
      await deriveContinuationTargetRestoreDigest(
        saveId,
        operationId,
        digestSource
      )
    ).toBe(expectedDigest);
    expect(
      await deriveContinuationTargetRestoreDigest(
        saveId,
        'C'.repeat(43),
        digestSource
      )
    ).not.toBe(expectedDigest);

    const initializeTarget = vi.fn(async () => true);
    await expect(
      initializeContinuationTarget(
        restorePlan(),
        { initializeContinuationTarget: initializeTarget },
        digestSource,
        targetRoomCode
      )
    ).resolves.toEqual({ created: true, targetRoomCode });
    expect(initializeTarget).toHaveBeenCalledWith(
      restorePlan().snapshot,
      lifecycle,
      expectedDigest
    );

    const invalidDigestStore = vi.fn(async () => true);
    let digestCalls = 0;
    await expect(
      initializeContinuationTarget(
        restorePlan(),
        { initializeContinuationTarget: invalidDigestStore },
        {
          digestCapability: async (value) => {
            digestCalls += 1;
            return digestCalls <= 2
              ? digestSource.digestCapability(value)
              : 'short';
          },
        },
        targetRoomCode
      )
    ).rejects.toThrow('digest source');
    expect(invalidDigestStore).not.toHaveBeenCalled();
  });

  it('revalidates the complete plan before invoking target storage', async () => {
    const digestSource = new WebCryptoAuthoritySource();
    for (const invalid of [
      { ...restorePlan(), unexpected: true },
      { ...restorePlan(), requesterSeatCapability: 'x'.repeat(32) },
      {
        ...restorePlan(),
        opponentInvitation: {
          ...restorePlan().opponentInvitation,
          expiresAt: unclaimedExpiresAt + 1,
        },
      },
    ]) {
      const initializeTarget = vi.fn(async () => true);
      await expect(
        initializeContinuationTarget(
          invalid,
          { initializeContinuationTarget: initializeTarget },
          digestSource,
          targetRoomCode
        )
      ).rejects.toThrow('target plan is invalid');
      expect(initializeTarget).not.toHaveBeenCalled();
    }

    const wrongSelection = vi.fn(async () => true);
    await expect(
      initializeContinuationTarget(
        restorePlan(),
        { initializeContinuationTarget: wrongSelection },
        digestSource,
        'CDEFGHJK3456'
      )
    ).rejects.toThrow('selection does not match');
    expect(wrongSelection).not.toHaveBeenCalled();
  });
});
