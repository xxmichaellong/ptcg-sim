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

import { WebCryptoAuthoritySource } from '../src/authority-crypto.js';
import { readContinuationQuotaConfiguration } from '../src/continuation-quota-configuration.js';
import {
  CONTINUATION_QUOTA_LEASES_STORAGE_KEY,
  continuationQuotaShardName,
} from '../src/continuation-quota.js';
import {
  CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
  CONTINUATION_STORAGE_KEY,
  DurableContinuationCustody,
  MINIMUM_CONTINUATION_TTL_MS,
  createContinuationCapability,
  parseContinuationCapability,
  type StoredContinuationRecord,
} from '../src/continuation-custody.js';
import { createContinuationCryptographyFromConfiguration } from '../src/continuation-configuration.js';
import { ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY } from '../src/continuation-request-rate.js';
import { ROOM_CONTINUATION_CREATIONS_STORAGE_KEY } from '../src/continuation-source.js';
import { DurableRoomSnapshotStore } from '../src/durable-storage.js';
import { continuationTestKeyring } from './continuation-test-keyring.js';
import { continuationTestQuotaConfiguration } from './continuation-test-quota-configuration.js';

const p1 = asPlayerId('continuation-runtime-player-one');
const p2 = asPlayerId('continuation-runtime-player-two');
const playerOneResumeCapability =
  'resume_continuation-runtime-player-one-000000000001';

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
        resumeCapabilityDigest: '8n5oQEIQvJDwkfv3GACKoigDn8TOts9ZDcmUWp2Y7hk',
      },
      'continuation-runtime-session-two': {
        id: 'continuation-runtime-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
        resumeCapabilityDigest: '2MwtLchA0XgVvBpLGgFz9z379Tp_Spqdb5naWyd10O8',
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
  it('is provisioned while exact production-default edge routes remain absent', async () => {
    const creation = await exports.default.fetch(
      new Request('https://play.example/v2/rooms/ABCDEFGH2345/continuations', {
        method: 'POST',
        headers: {
          Origin: 'https://play.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resumeToken: playerOneResumeCapability,
          operationId: 'C'.repeat(43),
        }),
      })
    );
    const restore = await exports.default.fetch(
      new Request(
        `https://play.example/v2/continuations/${'A'.repeat(22)}/restore`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://play.example',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            capability: `ptcgsave.v1.${'A'.repeat(22)}.${'B'.repeat(43)}`,
            operationId: 'R'.repeat(43),
          }),
        }
      )
    );

    expect(env.PTCG_CONTINUATION).toBeDefined();
    expect(env.PTCG_CONTINUATION_QUOTA).toBeDefined();
    expect(creation.status).toBe(404);
    expect(restore.status).toBe(404);
  });

  it('reserves only the exact configured quota shard and recovers after eviction', async () => {
    const sourceRoomCode = 'CDEFGHJK2345';
    const configuration = readContinuationQuotaConfiguration(
      continuationTestQuotaConfiguration
    );
    const shardName = await continuationQuotaShardName(
      sourceRoomCode,
      configuration.shardCount,
      new WebCryptoAuthoritySource()
    );
    const quota = env.PTCG_CONTINUATION_QUOTA.getByName(shardName);
    const createdAt = Date.now();
    const input = {
      sourceRoomCode,
      operationId: 'Q'.repeat(43),
      saveId: 'Q'.repeat(22),
      createdAt,
      expiresAt: createdAt + MINIMUM_CONTINUATION_TTL_MS,
      requestedAt: createdAt,
    };
    await expect(quota.reserveContinuation(input)).resolves.toEqual({
      state: 'reserved',
      created: true,
    });
    const stored = await runInDurableObject(quota, async (_instance, state) =>
      state.storage.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    );
    expect(JSON.stringify(stored)).not.toContain(sourceRoomCode);
    expect(JSON.stringify(stored)).not.toContain(input.operationId);
    expect(JSON.stringify(stored)).toContain(input.saveId);

    const wrongShard = env.PTCG_CONTINUATION_QUOTA.getByName(
      'continuation-quota-v1-fff'
    );
    await expect(
      wrongShard.reserveContinuation(input)
    ).resolves.toBeUndefined();
    await expect(
      runInDurableObject(wrongShard, async (_instance, state) =>
        state.storage.list()
      )
    ).resolves.toEqual(new Map());

    await evictDurableObject(quota);
    await expect(
      quota.reserveContinuation({ ...input, requestedAt: createdAt + 1 })
    ).resolves.toEqual({ state: 'reserved', created: false });

    const now = Date.now();
    await runInDurableObject(quota, async (_instance, state) => {
      const ledger = await state.storage.get<{
        format: string;
        leases: readonly Record<string, unknown>[];
      }>(CONTINUATION_QUOTA_LEASES_STORAGE_KEY);
      if (!ledger) throw new Error('expected quota ledger');
      await state.storage.put(CONTINUATION_QUOTA_LEASES_STORAGE_KEY, {
        ...ledger,
        leases: ledger.leases.map((lease) => ({
          ...lease,
          createdAt: now - MINIMUM_CONTINUATION_TTL_MS - 1,
          expiresAt: now - 1,
        })),
      });
      await state.storage.setAlarm(now + MINIMUM_CONTINUATION_TTL_MS);
    });
    await evictDurableObject(quota);
    await expect(runDurableObjectAlarm(quota)).resolves.toBe(true);
    await expect(
      runInDurableObject(quota, async (_instance, state) =>
        state.storage.list()
      )
    ).resolves.toEqual(new Map());
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

  it('creates and recovers an encrypted receipt through the private save RPC', async () => {
    const saveId = 'L'.repeat(22);
    const continuation = env.PTCG_CONTINUATION.getByName(saveId);
    const operationId = 'P'.repeat(43);
    const createdAt = Date.now();
    const input = {
      saveId,
      operationId,
      snapshot: snapshotFixture(),
      requesterSessionId: 'continuation-runtime-session-one',
      sourceBuild: 'continuation-runtime-test',
      createdAt,
      expiresAt: createdAt + MINIMUM_CONTINUATION_TTL_MS,
      requestedAt: createdAt + 1,
    };
    const created = await continuation.createContinuation(input);
    expect(created).toMatchObject({
      created: true,
      receipt: { saveId, operationId },
    });
    await expect(
      continuation.recoverContinuation({
        saveId,
        operationId,
        requestedAt: createdAt + 2,
      })
    ).resolves.toEqual(created!.receipt);
  });

  it('creates through private room/save RPCs and converges concurrently and after eviction', async () => {
    const room = env.PTCG_ROOM.getByName('CDEFGHJK2345');
    const source = snapshotFixture();
    await runInDurableObject(room, async (_instance, state) => {
      await new DurableRoomSnapshotStore(state.storage).initialize(source);
    });
    await evictDurableObject(room);

    const operationId = 'C'.repeat(43);
    const input = {
      resumeToken: playerOneResumeCapability,
      operationId,
    };
    await expect(
      room.createContinuation({ ...input, extra: true })
    ).resolves.toBeUndefined();
    await expect(
      room.createContinuation({
        ...input,
        resumeToken: 'resume_wrong-runtime-player-00000000000000000001',
      })
    ).resolves.toBeUndefined();
    const sourceHead = await runInDurableObject(
      room,
      async (_instance, state) =>
        new DurableRoomSnapshotStore(state.storage).load()
    );
    expect(sourceHead).toBeDefined();

    const secondOperation = 'D'.repeat(43);
    const [created, concurrentRetry] = await Promise.all([
      room.createContinuation(input),
      room.createContinuation(input),
    ]);
    expect(created).toMatchObject({
      state: 'created',
      receipt: {
        operationId,
        format: 'ptcgsim-continuation-creation-result-v1',
      },
    });
    expect(concurrentRetry).toEqual(created);
    if (created?.state !== 'created') throw new Error('expected create result');
    const parsed = parseContinuationCapability(created.receipt.capability);
    expect(parsed?.saveId).toBe(created.receipt.saveId);
    const continuation = env.PTCG_CONTINUATION.getByName(
      created.receipt.saveId
    );
    const quotaConfiguration = readContinuationQuotaConfiguration(
      continuationTestQuotaConfiguration
    );
    const quota = env.PTCG_CONTINUATION_QUOTA.getByName(
      await continuationQuotaShardName(
        'CDEFGHJK2345',
        quotaConfiguration.shardCount,
        new WebCryptoAuthoritySource()
      )
    );
    const sourceLedger = await runInDurableObject(
      room,
      async (_instance, state) =>
        state.storage.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    expect(JSON.stringify(sourceLedger)).not.toContain(
      'continuation-runtime-match'
    );
    expect(JSON.stringify(sourceLedger)).not.toContain(operationId);
    const saveEntries = await runInDurableObject(
      continuation,
      async (_instance, state) => state.storage.list()
    );
    expect(saveEntries.has(CONTINUATION_STORAGE_KEY)).toBe(true);
    expect(saveEntries.has(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)).toBe(
      true
    );
    expect(JSON.stringify([...saveEntries])).not.toContain(
      created.receipt.capability
    );
    expect(JSON.stringify([...saveEntries])).not.toContain(operationId);
    expect(JSON.stringify([...saveEntries])).not.toContain(
      'continuation-runtime-match'
    );
    const quotaEntries = await runInDurableObject(
      quota,
      async (_instance, state) => state.storage.list()
    );
    expect(quotaEntries.has(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)).toBe(true);
    expect(JSON.stringify([...quotaEntries])).not.toContain(
      created.receipt.capability
    );
    expect(JSON.stringify([...quotaEntries])).not.toContain(operationId);
    expect(JSON.stringify([...quotaEntries])).not.toContain('CDEFGHJK2345');
    const opened = await runInDurableObject(
      continuation,
      async (_instance, state) => {
        const cryptography =
          await createContinuationCryptographyFromConfiguration(
            continuationTestKeyring
          );
        return new DurableContinuationCustody(state.storage, cryptography).open(
          created.receipt.capability,
          Date.now()
        );
      }
    );
    expect(stableSerialize(opened!.checkpoint.snapshot)).toBe(
      stableSerialize(sourceHead)
    );

    await evictDurableObject(continuation);
    await evictDurableObject(quota);
    await evictDurableObject(room);
    await expect(room.createContinuation(input)).resolves.toEqual(created);
    await expect(
      room.createContinuation({ ...input, operationId: secondOperation })
    ).resolves.toMatchObject({ state: 'created' });
  });

  it('atomically rate limits authenticated new create operations without charging exact retries', async () => {
    const room = env.PTCG_ROOM.getByName('DEFGHJKM3456');
    await runInDurableObject(room, async (_instance, state) => {
      await new DurableRoomSnapshotStore(state.storage).initialize(
        snapshotFixture()
      );
    });
    await evictDurableObject(room);

    await expect(
      room.createContinuation({
        resumeToken: 'resume_wrong-runtime-player-00000000000000000001',
        operationId: 'Z'.repeat(43),
      })
    ).resolves.toBeUndefined();
    await expect(
      runInDurableObject(room, async (_instance, state) =>
        Promise.all([
          state.storage.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY),
          state.storage.get(ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY),
        ])
      )
    ).resolves.toEqual([undefined, undefined]);

    const inputs = Array.from({ length: 13 }, (_, index) => ({
      resumeToken: playerOneResumeCapability,
      operationId: String.fromCharCode(65 + index).repeat(43),
    }));
    const results = await Promise.all(
      inputs.map((createInput) => room.createContinuation(createInput))
    );
    expect(
      results.filter((result) => result?.state === 'created')
    ).toHaveLength(4);
    expect(
      results.filter((result) => result?.state === 'quota_exceeded')
    ).toHaveLength(8);
    expect(
      results.filter((result) => result?.state === 'rate_limited')
    ).toHaveLength(1);

    const storedBeforeRetry = await runInDurableObject(
      room,
      async (_instance, state) =>
        state.storage.get(ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY)
    );
    expect(storedBeforeRetry).toMatchObject({
      buckets: [{ requesterPlayerId: p1, attempts: 12 }],
    });
    expect(JSON.stringify(storedBeforeRetry)).not.toContain(
      inputs[0]!.operationId
    );

    const createdIndex = results.findIndex(
      (result) => result?.state === 'created'
    );
    if (createdIndex < 0) throw new Error('expected one created continuation');
    await evictDurableObject(room);
    await expect(
      room.createContinuation(inputs[createdIndex]!)
    ).resolves.toEqual(results[createdIndex]);
    await expect(
      runInDurableObject(room, async (_instance, state) =>
        state.storage.get(ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY)
      )
    ).resolves.toEqual(storedBeforeRetry);
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
