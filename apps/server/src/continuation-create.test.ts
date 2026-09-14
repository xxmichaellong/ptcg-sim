import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
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
  ContinuationCreationCoordinationError,
  coordinateContinuationCreation,
  type ContinuationCreationCoordinatorDependencies,
} from './continuation-create.js';
import {
  CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
  CONTINUATION_STORAGE_KEY,
  DurableContinuationCustody,
  WebCryptoContinuationCryptography,
  importContinuationEncryptionKey,
} from './continuation-custody.js';
import {
  DurableRoomContinuationSource,
  ROOM_CONTINUATION_CREATIONS_STORAGE_KEY,
} from './continuation-source.js';
import { DurableRoomSnapshotStore } from './durable-storage.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('create-coordinator-player-one');
const p2 = asPlayerId('create-coordinator-player-two');
const createdAt = 2_000_000_000_000;
const operationId = 'C'.repeat(43);
const alternateOperationId = 'D'.repeat(43);
const saveId = 'L'.repeat(22);
const sourceBuild = 'continuation-create-coordinator-test';
const hiddenMatchId = 'create-coordinator-hidden-match';

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
    authorityVersion: 5,
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
          claimedSessionId: 'create-session-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'create-session-two',
        },
      },
    },
    sessions: {
      'create-session-one': {
        id: 'create-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
      },
      'create-session-two': {
        id: 'create-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      'create-session-spectator': {
        id: 'create-session-spectator',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const continuationCryptography = async () => {
  const key = await importContinuationEncryptionKey(
    new Uint8Array(32).fill(31)
  );
  return new WebCryptoContinuationCryptography(
    'create-coordinator-key',
    new Map([['create-coordinator-key', key]])
  );
};

interface CreationHarness {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly sourceStorage: MemoryDurableStorage;
  readonly saveStorage: MemoryDurableStorage;
  readonly source: DurableRoomContinuationSource;
  readonly custody: DurableContinuationCustody;
  readonly dependencies: ContinuationCreationCoordinatorDependencies;
  readonly selectedSaveIds: string[];
}

const createHarness = async (): Promise<CreationHarness> => {
  const snapshot = snapshotFixture();
  const sourceStorage = new MemoryDurableStorage();
  await new DurableRoomSnapshotStore(sourceStorage).initialize(snapshot);
  const authoritySource = new WebCryptoAuthoritySource();
  const source = new DurableRoomContinuationSource(sourceStorage, {
    digestCapability: (value) => authoritySource.digestCapability(value),
    nextSaveId: () => saveId,
  });
  const saveStorage = new MemoryDurableStorage();
  const custody = new DurableContinuationCustody(
    saveStorage,
    await continuationCryptography()
  );
  let now = createdAt;
  const selectedSaveIds: string[] = [];
  const dependencies: ContinuationCreationCoordinatorDependencies = {
    source: {
      reserveCreation: (input) =>
        source.reserveCreation({ ...input, snapshot }),
      completeCreation: (input) =>
        source.completeCreation({ ...input, snapshot }),
    },
    saveForId: (selectedSaveId) => {
      selectedSaveIds.push(selectedSaveId);
      return {
        createReserved: (input) => custody.createReserved(input),
        recoverReserved: (input) => custody.recoverReservedCreation(input),
      };
    },
    clock: { now: () => now++ },
  };
  return {
    snapshot,
    sourceStorage,
    saveStorage,
    source,
    custody,
    dependencies,
    selectedSaveIds,
  };
};

const coordinate = (
  harness: CreationHarness,
  dependencies = harness.dependencies,
  requestedOperationId = operationId,
  requesterSessionId = 'create-session-one'
) =>
  coordinateContinuationCreation(
    {
      requesterSessionId,
      operationId: requestedOperationId,
      sourceBuild,
    },
    dependencies
  );

describe('continuation cross-object creation coordinator', () => {
  it('reserves the exact source head, creates the named save, and compacts the source', async () => {
    const harness = await createHarness();
    const result = await coordinate(harness);

    expect(result).toMatchObject({
      state: 'created',
      receipt: {
        format: 'ptcgsim-continuation-creation-result-v1',
        saveId,
        operationId,
        createdAt,
      },
    });
    if (result?.state !== 'created') throw new Error('expected create result');
    expect(harness.selectedSaveIds).toEqual([saveId]);
    expect(harness.saveStorage.values.has(CONTINUATION_STORAGE_KEY)).toBe(true);
    expect(
      harness.saveStorage.values.has(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)
    ).toBe(true);
    const sourceLedger = JSON.stringify(
      harness.sourceStorage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    expect(sourceLedger).not.toContain(hiddenMatchId);
    expect(sourceLedger).not.toContain(operationId);
    await expect(
      harness.custody.open(result.receipt.capability, createdAt + 10)
    ).resolves.toMatchObject({
      saveId,
      checkpoint: { snapshot: harness.snapshot, requesterPlayerId: p1 },
    });

    const sourceBeforeRetry = structuredClone(
      harness.sourceStorage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    );
    await expect(coordinate(harness)).resolves.toEqual(result);
    expect(harness.selectedSaveIds).toEqual([saveId, saveId]);
    expect(
      harness.sourceStorage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    ).toEqual(sourceBeforeRetry);
  });

  it('recovers pre-commit and ambiguous committed source reservations', async () => {
    const failed = await createHarness();
    failed.sourceStorage.failPutWhenKeyStartsWith =
      ROOM_CONTINUATION_CREATIONS_STORAGE_KEY;
    await expect(coordinate(failed)).rejects.toThrow(
      'transactional put failure'
    );
    expect(
      failed.sourceStorage.values.has(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    ).toBe(false);
    expect(failed.saveStorage.values.size).toBe(0);
    expect(failed.selectedSaveIds).toEqual([]);
    failed.sourceStorage.failPutWhenKeyStartsWith = undefined;
    await expect(coordinate(failed)).resolves.toMatchObject({
      state: 'created',
      receipt: { saveId, operationId },
    });

    const harness = await createHarness();
    harness.sourceStorage.failAfterTransactionCommitOnCall =
      harness.sourceStorage.transactionCalls + 1;

    await expect(coordinate(harness)).rejects.toThrow(
      'ambiguous transaction failure'
    );
    expect(harness.selectedSaveIds).toEqual([]);
    expect(harness.saveStorage.values.size).toBe(0);
    expect(
      harness.sourceStorage.values.has(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
    ).toBe(true);

    await expect(coordinate(harness)).resolves.toMatchObject({
      state: 'created',
      receipt: { saveId, operationId, createdAt },
    });
  });

  it('recovers pre-commit and ambiguous committed save creation failures', async () => {
    const failed = await createHarness();
    failed.saveStorage.failPutWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;
    await expect(coordinate(failed)).rejects.toThrow(
      'transactional put failure'
    );
    expect(failed.saveStorage.values.size).toBe(0);
    expect(
      JSON.stringify(
        failed.sourceStorage.values.get(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      )
    ).toContain(hiddenMatchId);
    failed.saveStorage.failPutWhenKeyStartsWith = undefined;
    await expect(coordinate(failed)).resolves.toMatchObject({
      state: 'created',
      receipt: { saveId, operationId, createdAt },
    });

    const ambiguous = await createHarness();
    ambiguous.saveStorage.failAfterTransactionCommitOnCall = 2;
    await expect(coordinate(ambiguous)).rejects.toThrow(
      'ambiguous transaction failure'
    );
    expect(ambiguous.saveStorage.values.size).toBe(2);
    expect(
      JSON.stringify(
        ambiguous.sourceStorage.values.get(
          ROOM_CONTINUATION_CREATIONS_STORAGE_KEY
        )
      )
    ).toContain(hiddenMatchId);
    await expect(coordinate(ambiguous)).resolves.toMatchObject({
      state: 'created',
      receipt: { saveId, operationId, createdAt },
    });
  });

  it('recovers pre-commit and ambiguous committed source completion failures', async () => {
    const failed = await createHarness();
    const complete = failed.dependencies.source.completeCreation;
    let failCompletion = true;
    const failedDependencies: ContinuationCreationCoordinatorDependencies = {
      ...failed.dependencies,
      source: {
        ...failed.dependencies.source,
        completeCreation: async (input) => {
          if (failCompletion) {
            failCompletion = false;
            failed.sourceStorage.failPutWhenKeyStartsWith =
              ROOM_CONTINUATION_CREATIONS_STORAGE_KEY;
          }
          try {
            return await complete(input);
          } finally {
            failed.sourceStorage.failPutWhenKeyStartsWith = undefined;
          }
        },
      },
    };
    await expect(coordinate(failed, failedDependencies)).rejects.toThrow(
      'transactional put failure'
    );
    expect(failed.saveStorage.values.size).toBe(2);
    await expect(coordinate(failed, failedDependencies)).resolves.toMatchObject(
      { state: 'created', receipt: { saveId, operationId, createdAt } }
    );

    const ambiguous = await createHarness();
    ambiguous.sourceStorage.failAfterTransactionCommitOnCall = 3;
    await expect(coordinate(ambiguous)).rejects.toThrow(
      'ambiguous transaction failure'
    );
    expect(
      JSON.stringify(
        ambiguous.sourceStorage.values.get(
          ROOM_CONTINUATION_CREATIONS_STORAGE_KEY
        )
      )
    ).not.toContain(hiddenMatchId);
    await expect(coordinate(ambiguous)).resolves.toMatchObject({
      state: 'created',
      receipt: { saveId, operationId, createdAt },
    });
  });

  it('stops unauthorized and quota results before selecting a save object', async () => {
    const unauthorized = await createHarness();
    await expect(
      coordinate(
        unauthorized,
        unauthorized.dependencies,
        operationId,
        'create-session-spectator'
      )
    ).resolves.toBeUndefined();
    expect(unauthorized.selectedSaveIds).toEqual([]);

    const quota = await createHarness();
    const saveForId = vi.spyOn(quota.dependencies, 'saveForId');
    const quotaDependencies: ContinuationCreationCoordinatorDependencies = {
      ...quota.dependencies,
      source: {
        ...quota.dependencies.source,
        reserveCreation: async () => ({
          state: 'quota_exceeded',
          scope: 'player',
        }),
      },
    };
    await expect(coordinate(quota, quotaDependencies)).resolves.toEqual({
      state: 'quota_exceeded',
      scope: 'player',
    });
    expect(saveForId).not.toHaveBeenCalled();
  });

  it('rejects mismatched source plans, save receipts, and completions', async () => {
    const planMismatch = await createHarness();
    const reserve = planMismatch.dependencies.source.reserveCreation;
    const planDependencies: ContinuationCreationCoordinatorDependencies = {
      ...planMismatch.dependencies,
      source: {
        ...planMismatch.dependencies.source,
        reserveCreation: async (input) => {
          const reserved = await reserve(input);
          if (reserved?.state !== 'pending') return reserved;
          return {
            ...reserved,
            plan: {
              ...reserved.plan,
              operationId: alternateOperationId,
            },
          };
        },
      },
    };
    await expect(
      coordinate(planMismatch, planDependencies)
    ).rejects.toBeInstanceOf(ContinuationCreationCoordinationError);
    expect(planMismatch.selectedSaveIds).toEqual([]);

    const receiptMismatch = await createHarness();
    const saveForId = receiptMismatch.dependencies.saveForId;
    const receiptDependencies: ContinuationCreationCoordinatorDependencies = {
      ...receiptMismatch.dependencies,
      saveForId: (selectedSaveId) => {
        const save = saveForId(selectedSaveId);
        return {
          ...save,
          createReserved: async (input) => {
            const result = await save.createReserved(input);
            if (!result) return result;
            return {
              ...result,
              receipt: {
                ...result.receipt,
                operationId: alternateOperationId,
              },
            };
          },
        };
      },
    };
    await expect(
      coordinate(receiptMismatch, receiptDependencies)
    ).rejects.toBeInstanceOf(ContinuationCreationCoordinationError);

    const completionMismatch = await createHarness();
    const completionDependencies: ContinuationCreationCoordinatorDependencies =
      {
        ...completionMismatch.dependencies,
        source: {
          ...completionMismatch.dependencies.source,
          completeCreation: async () => ({
            saveId: 'N'.repeat(22),
            expiresAt: createdAt + 60_000,
          }),
        },
      };
    await expect(
      coordinate(completionMismatch, completionDependencies)
    ).rejects.toBeInstanceOf(ContinuationCreationCoordinationError);
  });

  it('rejects an unavailable completed receipt and an invalid clock', async () => {
    const completed = await createHarness();
    const result = await coordinate(completed);
    expect(result?.state).toBe('created');
    const unavailableDependencies: ContinuationCreationCoordinatorDependencies =
      {
        ...completed.dependencies,
        saveForId: () => ({
          createReserved: async () => undefined,
          recoverReserved: async () => undefined,
        }),
      };
    await expect(
      coordinate(completed, unavailableDependencies)
    ).rejects.toThrow('completed source receipt is unavailable');

    const invalidClock = await createHarness();
    await expect(
      coordinate(invalidClock, {
        ...invalidClock.dependencies,
        clock: { now: () => Number.NaN },
      })
    ).rejects.toThrow('coordinator clock is invalid');
    expect(invalidClock.selectedSaveIds).toEqual([]);
  });
});
