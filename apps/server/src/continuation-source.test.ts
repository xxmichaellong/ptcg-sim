import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY,
  DurableRoomContinuationSource,
  ROOM_CONTINUATION_CREATIONS_STORAGE_KEY,
  type ContinuationSourceCreationPolicy,
  type ContinuationSourceIdentity,
} from './continuation-source.js';
import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  ConcurrentRoomWriteError,
  DurableRoomSnapshotStore,
} from './durable-storage.js';
import { MINIMUM_CONTINUATION_TTL_MS } from './continuation-custody.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('continuation-source-player-one');
const p2 = asPlayerId('continuation-source-player-two');
const createdAt = 2_000_000_000_000;
const operationOne = 'R'.repeat(43);
const operationTwo = 'S'.repeat(43);
const operationThree = 'T'.repeat(43);
const hiddenMatchId = 'continuation-source-hidden-match';

const digest = (value: string): string => {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16_777_619) >>> 0;
  }
  return result.toString(16).padStart(8, '0').repeat(6).slice(0, 43);
};

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId(hiddenMatchId), [
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
    authorityVersion: 4,
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
          claimedSessionId: 'source-session-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'source-session-two',
        },
      },
    },
    sessions: {
      'source-session-one': {
        id: 'source-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
      },
      'source-session-two': {
        id: 'source-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      'source-session-spectator': {
        id: 'source-session-spectator',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const identityFixture = () => {
  let save = 0;
  const identity: ContinuationSourceIdentity = {
    digestCapability: async (value) => digest(value),
    nextSaveId: () => String(++save).padStart(22, 'A'),
  };
  return { identity, calls: () => save };
};

const input = (
  snapshot: RoomAuthoritySnapshot,
  operationId = operationOne,
  requesterSessionId = 'source-session-one',
  at = createdAt
) => ({
  snapshot,
  requesterSessionId,
  operationId,
  sourceBuild: 'continuation-source-test',
  createdAt: at,
});

const setup = async (
  policy: ContinuationSourceCreationPolicy = DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY
) => {
  const storage = new MemoryDurableStorage();
  const snapshot = snapshotFixture();
  await new DurableRoomSnapshotStore(storage).initialize(snapshot);
  const identity = identityFixture();
  return {
    storage,
    snapshot,
    identity,
    source: new DurableRoomContinuationSource(
      storage,
      identity.identity,
      policy
    ),
  };
};

describe('source-room continuation creation reservations', () => {
  it('captures one exact source snapshot under a digest-only operation and recovers its retry', async () => {
    const harness = await setup();
    const reserved = await harness.source.reserveCreation(
      input(harness.snapshot)
    );
    expect(reserved).toMatchObject({
      state: 'pending',
      created: true,
      plan: {
        operationId: operationOne,
        requesterPlayerId: p1,
        requesterSessionId: 'source-session-one',
        sourceBuild: 'continuation-source-test',
        createdAt,
      },
    });
    if (reserved?.state !== 'pending') throw new Error('expected pending plan');
    expect(reserved.plan.snapshot).toEqual(harness.snapshot);
    expect(reserved.plan.snapshot).not.toBe(harness.snapshot);
    const stored = JSON.stringify(
      harness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    expect(stored).not.toContain(operationOne);
    expect(stored).toContain(hiddenMatchId);

    await expect(
      harness.source.reserveCreation(
        input(
          harness.snapshot,
          operationOne,
          'source-session-one',
          createdAt + 1
        )
      )
    ).resolves.toEqual({
      state: 'pending',
      created: false,
      plan: reserved.plan,
    });
  });

  it('requires a currently active claimed multiplayer player before identity work', async () => {
    for (const [snapshot, sessionId] of [
      [snapshotFixture(), 'source-session-spectator'],
      [
        {
          ...snapshotFixture(),
          sessions: {
            ...snapshotFixture().sessions,
            'source-session-one': {
              ...snapshotFixture().sessions['source-session-one']!,
              active: false,
            },
          },
        },
        'source-session-one',
      ],
      [
        {
          ...snapshotFixture(),
          mode: 'solo' as const,
          sessions: {},
          admission: {
            ...snapshotFixture().admission!,
            playerSeatLimit: 1 as const,
            seats: Object.fromEntries(
              Object.entries(snapshotFixture().admission!.seats).map(
                ([playerId, seat]) => [
                  playerId,
                  { ...seat, claimedSessionId: null },
                ]
              )
            ),
          },
        },
        'source-session-one',
      ],
    ] as const) {
      const storage = new MemoryDurableStorage();
      const identity = identityFixture();
      const source = new DurableRoomContinuationSource(
        storage,
        identity.identity
      );
      await expect(
        source.reserveCreation(input(snapshot, operationOne, sessionId))
      ).resolves.toBeUndefined();
      expect(identity.calls()).toBe(0);
      expect(storage.values.size).toBe(0);
    }
  });

  it('enforces independent unexpired player and room limits', async () => {
    const playerLimited = await setup({
      maximumPerPlayer: 1,
      maximumPerRoom: 2,
      retentionMs: MINIMUM_CONTINUATION_TTL_MS,
    });
    await playerLimited.source.reserveCreation(input(playerLimited.snapshot));
    await expect(
      playerLimited.source.reserveCreation(
        input(playerLimited.snapshot, operationTwo)
      )
    ).resolves.toEqual({ state: 'quota_exceeded', scope: 'player' });

    const roomLimited = await setup({
      maximumPerPlayer: 2,
      maximumPerRoom: 2,
      retentionMs: MINIMUM_CONTINUATION_TTL_MS,
    });
    await roomLimited.source.reserveCreation(input(roomLimited.snapshot));
    await roomLimited.source.reserveCreation(
      input(roomLimited.snapshot, operationTwo, 'source-session-two')
    );
    await expect(
      roomLimited.source.reserveCreation(
        input(roomLimited.snapshot, operationThree)
      )
    ).resolves.toEqual({ state: 'quota_exceeded', scope: 'room' });
  });

  it('compacts the canonical plan after completion and recovers exact completion retries', async () => {
    const harness = await setup();
    const reserved = await harness.source.reserveCreation(
      input(harness.snapshot)
    );
    if (reserved?.state !== 'pending') throw new Error('expected pending plan');
    const reference = {
      saveId: reserved.plan.saveId,
      expiresAt: reserved.plan.expiresAt,
    };
    await expect(
      harness.source.completeCreation({
        snapshot: harness.snapshot,
        requesterSessionId: 'source-session-one',
        operationId: operationOne,
        completedAt: createdAt + 1,
        reference,
      })
    ).resolves.toEqual(reference);
    const stored = JSON.stringify(
      harness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    expect(stored).not.toContain(hiddenMatchId);
    expect(stored).not.toContain('source-session-one');
    expect(stored).not.toContain('continuation-source-test');
    expect(stored).not.toContain(operationOne);

    await expect(
      harness.source.completeCreation({
        snapshot: harness.snapshot,
        requesterSessionId: 'source-session-one',
        operationId: operationOne,
        completedAt: createdAt + 50,
        reference,
      })
    ).resolves.toEqual(reference);
    await expect(
      harness.source.reserveCreation(
        input(
          harness.snapshot,
          operationOne,
          'source-session-one',
          createdAt + 60
        )
      )
    ).resolves.toEqual({ state: 'completed', reference });
  });

  it('refuses foreign completion identity without changing the pending plan', async () => {
    const harness = await setup();
    const reserved = await harness.source.reserveCreation(
      input(harness.snapshot)
    );
    if (reserved?.state !== 'pending') throw new Error('expected pending plan');
    const before = structuredClone(
      harness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    for (const attempt of [
      {
        requesterSessionId: 'source-session-two',
        operationId: operationOne,
        reference: {
          saveId: reserved.plan.saveId,
          expiresAt: reserved.plan.expiresAt,
        },
      },
      {
        requesterSessionId: 'source-session-one',
        operationId: operationTwo,
        reference: {
          saveId: reserved.plan.saveId,
          expiresAt: reserved.plan.expiresAt,
        },
      },
      {
        requesterSessionId: 'source-session-one',
        operationId: operationOne,
        reference: {
          saveId: 'Z'.repeat(22),
          expiresAt: reserved.plan.expiresAt,
        },
      },
    ]) {
      await expect(
        harness.source.completeCreation({
          snapshot: harness.snapshot,
          completedAt: createdAt + 1,
          ...attempt,
        })
      ).resolves.toBeUndefined();
      expect(
        harness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      ).toEqual(before);
    }
  });

  it('prunes expired references before applying quota', async () => {
    const harness = await setup({
      maximumPerPlayer: 1,
      maximumPerRoom: 1,
      retentionMs: MINIMUM_CONTINUATION_TTL_MS,
    });
    await harness.source.reserveCreation(input(harness.snapshot));
    const replacement = await harness.source.reserveCreation(
      input(
        harness.snapshot,
        operationTwo,
        'source-session-one',
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    );
    expect(replacement).toMatchObject({ state: 'pending', created: true });
    expect(
      JSON.stringify(
        harness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      )
    ).not.toContain(
      digest(`ptcgsim-continuation-create-operation-v1\u0000${operationOne}`)
    );

    const completionHarness = await setup({
      maximumPerPlayer: 1,
      maximumPerRoom: 1,
      retentionMs: MINIMUM_CONTINUATION_TTL_MS,
    });
    const original = await completionHarness.source.reserveCreation(
      input(completionHarness.snapshot)
    );
    if (original?.state !== 'pending') throw new Error('expected pending plan');
    await expect(
      completionHarness.source.completeCreation({
        snapshot: completionHarness.snapshot,
        requesterSessionId: 'source-session-one',
        operationId: operationOne,
        completedAt: original.plan.expiresAt,
        reference: {
          saveId: original.plan.saveId,
          expiresAt: original.plan.expiresAt,
        },
      })
    ).resolves.toBeUndefined();
    expect(
      completionHarness.storage.values.get(
        ROOM_CONTINUATION_CREATIONS_STORAGE_KEY
      )
    ).toEqual({
      format: 'ptcgsim-room-continuation-creations-v1',
      entries: [],
    });

    const quotaHarness = await setup({
      maximumPerPlayer: 1,
      maximumPerRoom: 2,
      retentionMs: MINIMUM_CONTINUATION_TTL_MS,
    });
    await quotaHarness.source.reserveCreation(input(quotaHarness.snapshot));
    await quotaHarness.source.reserveCreation(
      input(
        quotaHarness.snapshot,
        operationTwo,
        'source-session-two',
        createdAt + MINIMUM_CONTINUATION_TTL_MS - 1
      )
    );
    await expect(
      quotaHarness.source.reserveCreation(
        input(
          quotaHarness.snapshot,
          operationThree,
          'source-session-two',
          createdAt + MINIMUM_CONTINUATION_TTL_MS
        )
      )
    ).resolves.toEqual({ state: 'quota_exceeded', scope: 'player' });
    expect(
      JSON.stringify(
        quotaHarness.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      )
    ).not.toContain(
      digest(`ptcgsim-continuation-create-operation-v1\u0000${operationOne}`)
    );
  });

  it('fails a stale frontier and malformed ledger closed', async () => {
    const stale = await setup();
    const frontier = stale.storage.values.get(
      AUTHORITY_FRONTIER_STORAGE_KEY
    ) as Record<string, unknown>;
    stale.storage.values.set(AUTHORITY_FRONTIER_STORAGE_KEY, {
      ...frontier,
      authorityVersion: stale.snapshot.authorityVersion + 1,
    });
    await expect(
      stale.source.reserveCreation(input(stale.snapshot))
    ).rejects.toBeInstanceOf(ConcurrentRoomWriteError);

    const malformedFrontier = await setup();
    const incompleteFrontier = structuredClone(
      malformedFrontier.storage.values.get(AUTHORITY_FRONTIER_STORAGE_KEY)
    ) as Record<string, unknown>;
    Reflect.deleteProperty(incompleteFrontier, 'generation');
    malformedFrontier.storage.values.set(
      AUTHORITY_FRONTIER_STORAGE_KEY,
      incompleteFrontier
    );
    await expect(
      malformedFrontier.source.reserveCreation(
        input(malformedFrontier.snapshot)
      )
    ).rejects.toBeInstanceOf(ConcurrentRoomWriteError);

    const corrupt = await setup();
    corrupt.storage.values.set(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY, {
      format: 'ptcgsim-room-continuation-creations-v1',
      entries: [{ state: 'pending' }],
    });
    await expect(
      corrupt.source.reserveCreation(input(corrupt.snapshot))
    ).rejects.toThrow('creation is malformed');
  });

  it('rolls back failed writes and recovers ambiguous reservation/completion commits', async () => {
    const retried = await setup();
    const transactionAttemptsBeforeRetry = retried.storage.transactionAttempts;
    retried.storage.retryTransactionOnce = true;
    await expect(
      retried.source.reserveCreation(input(retried.snapshot))
    ).resolves.toMatchObject({ state: 'pending', created: true });
    expect(retried.storage.transactionAttempts).toBe(
      transactionAttemptsBeforeRetry + 2
    );
    expect(retried.identity.calls()).toBe(1);
    expect(
      (
        retried.storage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY) as {
          entries: unknown[];
        }
      ).entries
    ).toHaveLength(1);

    const rollback = await setup();
    rollback.storage.failPutWhenKeyStartsWith =
      ROOM_CONTINUATION_CREATIONS_STORAGE_KEY;
    await expect(
      rollback.source.reserveCreation(input(rollback.snapshot))
    ).rejects.toThrow('transactional put failure');
    expect(
      rollback.storage.values.has(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    ).toBe(false);

    const harness = await setup();
    harness.storage.failAfterTransactionCommitOnce = true;
    await expect(
      harness.source.reserveCreation(input(harness.snapshot))
    ).rejects.toThrow('ambiguous transaction failure');
    const recovered = await harness.source.reserveCreation(
      input(harness.snapshot, operationOne, 'source-session-one', createdAt + 1)
    );
    expect(recovered).toMatchObject({ state: 'pending', created: false });
    if (recovered?.state !== 'pending')
      throw new Error('expected pending plan');

    harness.storage.failAfterTransactionCommitOnce = true;
    const completion = {
      snapshot: harness.snapshot,
      requesterSessionId: 'source-session-one',
      operationId: operationOne,
      completedAt: createdAt + 2,
      reference: {
        saveId: recovered.plan.saveId,
        expiresAt: recovered.plan.expiresAt,
      },
    };
    await expect(harness.source.completeCreation(completion)).rejects.toThrow(
      'ambiguous transaction failure'
    );
    await expect(
      harness.source.completeCreation({
        ...completion,
        completedAt: createdAt + 3,
      })
    ).resolves.toEqual(completion.reference);
  });

  it('validates policy bounds when the source adapter is constructed', () => {
    const identity = identityFixture();
    for (const policy of [
      {
        ...DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY,
        maximumPerPlayer: 0,
      },
      {
        ...DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY,
        maximumPerRoom: 3,
      },
      {
        ...DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY,
        retentionMs: MINIMUM_CONTINUATION_TTL_MS - 1,
      },
    ]) {
      expect(
        () =>
          new DurableRoomContinuationSource(
            new MemoryDurableStorage(),
            identity.identity,
            policy
          )
      ).toThrow('policy is invalid');
    }
  });
});
