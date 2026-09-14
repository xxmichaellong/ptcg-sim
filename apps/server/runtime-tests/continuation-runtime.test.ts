import { env, exports } from 'cloudflare:workers';
import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  stableHash,
  stableSerialize,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_STORAGE_KEY,
  DurableContinuationCustody,
  MINIMUM_CONTINUATION_TTL_MS,
  createContinuationCapability,
  parseContinuationCapability,
  type StoredContinuationRecord,
} from '../src/continuation-custody.js';
import { createContinuationCryptographyFromConfiguration } from '../src/continuation-configuration.js';
import { DurableRoomSnapshotStore } from '../src/durable-storage.js';
import { continuationTestKeyring } from './continuation-test-keyring.js';

const p1 = asPlayerId('continuation-runtime-player-one');
const p2 = asPlayerId('continuation-runtime-player-two');

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('continuation-runtime-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: 'a'.repeat(43),
      [p2]: 'b'.repeat(43),
    },
  });
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 3,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: {
      ...admission,
      seats: {
        ...admission.seats,
        [p1]: {
          ...admission.seats[p1]!,
          claimedSessionId: 'continuation-runtime-session-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'continuation-runtime-session-two',
        },
      },
    },
    sessions: {
      'continuation-runtime-session-one': {
        id: 'continuation-runtime-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
      },
      'continuation-runtime-session-two': {
        id: 'continuation-runtime-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const tombstone = (createdAt: number, expiresAt: number) => ({
  format: 'ptcgsim-continuation-record-v1',
  state: 'revoked',
  saveId: 'A'.repeat(22),
  capabilityDigest: 'B'.repeat(43),
  createdAt,
  expiresAt,
  revokedAt: createdAt,
});

describe('continuation Durable Object runtime', () => {
  it('is provisioned while its edge route remains absent', async () => {
    const response = await exports.default.fetch(
      new Request(
        'https://play.example/v2/continuations/AAAAAAAAAAAAAAAAAAAAAA'
      )
    );

    expect(env.PTCG_CONTINUATION).toBeDefined();
    expect(response.status).toBe(404);
  });

  it('deletes expired custody after eviction without requiring a decrypt key', async () => {
    const stub = env.PTCG_CONTINUATION.getByName('expired-runtime-record');
    const now = Date.now();
    const createdAt = now - MINIMUM_CONTINUATION_TTL_MS - 1;
    const expiresAt = now - 1;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(
        CONTINUATION_STORAGE_KEY,
        tombstone(createdAt, expiresAt)
      );
      // Prevent automatic local delivery from racing the explicit test helper.
      await state.storage.setAlarm(now + MINIMUM_CONTINUATION_TTL_MS);
    });
    await evictDurableObject(stub);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await runInDurableObject(stub, async (_instance, state) => ({
      record: await state.storage.get(CONTINUATION_STORAGE_KEY),
      alarm: await state.storage.getAlarm(),
    }));
    expect(result).toEqual({ record: undefined, alarm: null });
  });

  it('reschedules an early continuation alarm at the exact expiry', async () => {
    const stub = env.PTCG_CONTINUATION.getByName('early-runtime-record');
    const now = Date.now();
    const createdAt = now - 1;
    const expiresAt = createdAt + MINIMUM_CONTINUATION_TTL_MS;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(
        CONTINUATION_STORAGE_KEY,
        tombstone(createdAt, expiresAt)
      );
      await state.storage.setAlarm(expiresAt + MINIMUM_CONTINUATION_TTL_MS);
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await runInDurableObject(stub, async (_instance, state) => ({
      record: await state.storage.get(CONTINUATION_STORAGE_KEY),
      alarm: await state.storage.getAlarm(),
    }));
    expect(result.record).toEqual(tombstone(createdAt, expiresAt));
    expect(result.alarm).toBe(expiresAt);
  });

  it('restores through private object RPC and converges after both objects are evicted', async () => {
    const capability = createContinuationCapability().capability;
    const saveId = parseContinuationCapability(capability)!.saveId;
    const continuation = env.PTCG_CONTINUATION.getByName(saveId);
    const source = snapshotFixture();
    const createdAt = Date.now() - 1_000;
    await runInDurableObject(continuation, async (_instance, state) => {
      const cryptography =
        await createContinuationCryptographyFromConfiguration(
          continuationTestKeyring
        );
      await new DurableContinuationCustody(state.storage, cryptography).create({
        capability,
        snapshot: source,
        requesterSessionId: 'continuation-runtime-session-one',
        sourceBuild: 'continuation-runtime-test',
        createdAt,
      });
    });

    const operationId = 'R'.repeat(43);
    const [restored, concurrentRetry] = await Promise.all([
      continuation.restore({ capability, operationId }),
      continuation.restore({ capability, operationId }),
    ]);
    expect(restored).toMatchObject({ saveId, operationId });
    expect(concurrentRetry).toEqual(restored);
    const target = env.PTCG_ROOM.getByName(restored!.targetRoomCode);
    const firstTarget = await runInDurableObject(
      target,
      async (_instance, state) => ({
        snapshot: await new DurableRoomSnapshotStore(state.storage).load(),
        alarm: await state.storage.getAlarm(),
        entries: await state.storage.list(),
      })
    );
    expect(stableHash(firstTarget.snapshot!.state)).toBe(
      stableHash(source.state)
    );
    expect(stableSerialize(firstTarget.snapshot!.state)).toBe(
      stableSerialize(source.state)
    );
    expect(firstTarget.snapshot).toMatchObject({
      authorityVersion: 0,
      sessions: {},
      identities: { cardAliases: [], definitionAliases: [] },
    });
    expect(firstTarget.alarm).toBeGreaterThan(Date.now());
    expect(
      JSON.stringify(firstTarget.entries.get('room:continuation-origin'))
    ).not.toContain(saveId);
    const completed = await runInDurableObject(
      continuation,
      async (_instance, state) =>
        state.storage.get<StoredContinuationRecord>(CONTINUATION_STORAGE_KEY)
    );
    expect(completed?.state).toBe('completed');

    await evictDurableObject(target);
    await evictDurableObject(continuation);
    await expect(
      continuation.restore({ capability, operationId })
    ).resolves.toEqual(restored);
    const afterRetry = await runInDurableObject(
      target,
      async (_instance, state) => ({
        alarm: await state.storage.getAlarm(),
        entries: await state.storage.list(),
      })
    );
    expect(afterRetry).toEqual({
      alarm: firstTarget.alarm,
      entries: firstTarget.entries,
    });
  });

  it('rejects malformed and wrong-locator private restore RPC input without target work', async () => {
    const capability = createContinuationCapability().capability;
    const saveId = parseContinuationCapability(capability)!.saveId;
    const correct = env.PTCG_CONTINUATION.getByName(saveId);
    const wrong = env.PTCG_CONTINUATION.getByName('A'.repeat(22));
    const operationId = 'R'.repeat(43);

    await expect(
      correct.restore({ capability, operationId, extra: true })
    ).resolves.toBeUndefined();
    await expect(
      wrong.restore({ capability, operationId })
    ).resolves.toBeUndefined();
    const wrongStorage = await runInDurableObject(
      wrong,
      async (_instance, state) => state.storage.list()
    );
    expect(wrongStorage.size).toBe(0);

    const room = env.PTCG_ROOM.getByName('BCDEFGHJ2345');
    await expect(room.initializeContinuation({})).resolves.toBeUndefined();
    const roomStorage = await runInDurableObject(
      room,
      async (_instance, state) => state.storage.list()
    );
    expect(roomStorage.size).toBe(0);
  });
});
