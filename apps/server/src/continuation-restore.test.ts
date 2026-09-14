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
import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import {
  CONTINUATION_STORAGE_KEY,
  DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
  DurableContinuationCustody,
  MINIMUM_CONTINUATION_TTL_MS,
  WebCryptoContinuationCryptography,
  createContinuationCapability,
  importContinuationEncryptionKey,
  parseContinuationCapability,
  type CreateContinuationInput,
  type StoredContinuationRecord,
} from './continuation-custody.js';
import { prepareContinuationFork } from './continuation-fork.js';
import {
  ContinuationRestoreCoordinationError,
  coordinateContinuationRestore,
  type ContinuationRestoreCoordinatorDependencies,
  type ContinuationRestoreSavePort,
  type ContinuationRestoreTargetPort,
} from './continuation-restore.js';
import { initializeContinuationTarget } from './continuation-target.js';
import { DurableRoomSnapshotStore } from './durable-storage.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('restore-coordinator-player-one');
const p2 = asPlayerId('restore-coordinator-player-two');
const createdAt = 2_000_000_000_000;
const restoredAt = createdAt + 10_000;
const targetRoomCode = 'BCDEFGHJ2345';
const operationId = 'R'.repeat(43);

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('restore-coordinator-match'), [
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
    authorityVersion: 7,
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
          claimedSessionId: 'restore-session-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'restore-session-two',
        },
      },
    },
    sessions: {
      'restore-session-one': {
        id: 'restore-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
      },
      'restore-session-two': {
        id: 'restore-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const continuationCryptography = async () => {
  const key = await importContinuationEncryptionKey(
    new Uint8Array(32).fill(29)
  );
  return new WebCryptoContinuationCryptography(
    'restore-coordinator-key',
    new Map([['restore-coordinator-key', key]])
  );
};

interface RestoreHarness {
  readonly capability: string;
  readonly saveStorage: MemoryDurableStorage;
  readonly targetStorage: MemoryDurableStorage;
  readonly custody: DurableContinuationCustody;
  readonly dependencies: ContinuationRestoreCoordinatorDependencies;
  readonly preparationCalls: () => number;
  readonly selectedRoomCodes: string[];
  readonly times: number[];
}

const createHarness = async (ttlMs?: number): Promise<RestoreHarness> => {
  const capability = createContinuationCapability().capability;
  const saveStorage = new MemoryDurableStorage();
  const targetStorage = new MemoryDurableStorage();
  const custody = new DurableContinuationCustody(
    saveStorage,
    await continuationCryptography()
  );
  const input: CreateContinuationInput = {
    capability,
    snapshot: snapshotFixture(),
    requesterSessionId: 'restore-session-one',
    sourceBuild: 'restore-coordinator-test',
    createdAt,
    ...(ttlMs === undefined ? {} : { ttlMs }),
  };
  await custody.create(input);
  const authoritySource = new WebCryptoAuthoritySource();
  let prepareCalls = 0;
  const save: ContinuationRestoreSavePort = {
    reserveRestore: (restoreInput) =>
      custody.reserveRestore(restoreInput, async (checkpoint) => {
        prepareCalls += 1;
        return {
          targetRoomCode,
          fork: await prepareContinuationFork(
            checkpoint,
            authoritySource,
            restoreInput.reservedAt
          ),
        };
      }),
    completeRestore: (restoreInput) => custody.completeRestore(restoreInput),
  };
  const selectedRoomCodes: string[] = [];
  const target: ContinuationRestoreTargetPort = {
    initializeRestoreTarget: async (plan) => {
      selectedRoomCodes.push(plan.targetRoomCode);
      return initializeContinuationTarget(
        plan,
        new DurableRoomSnapshotStore(targetStorage),
        authoritySource
      );
    },
  };
  const times = [restoredAt, restoredAt + 1];
  return {
    capability,
    saveStorage,
    targetStorage,
    custody,
    dependencies: {
      save,
      target,
      clock: { now: () => times.shift() ?? restoredAt + 2 },
    },
    preparationCalls: () => prepareCalls,
    selectedRoomCodes,
    times,
  };
};

const restoreInput = (capability: string) => ({ capability, operationId });

const storedSaveRecord = (harness: RestoreHarness): StoredContinuationRecord =>
  harness.saveStorage.values.get(
    CONTINUATION_STORAGE_KEY
  ) as StoredContinuationRecord;

describe('continuation cross-object restore coordinator', () => {
  it('reserves, initializes the exact room, and completes without changing canonical state', async () => {
    const harness = await createHarness();
    const result = await coordinateContinuationRestore(
      restoreInput(harness.capability),
      harness.dependencies
    );

    expect(result).toMatchObject({
      saveId: parseContinuationCapability(harness.capability)!.saveId,
      operationId,
      targetRoomCode,
      completedAt: restoredAt + 1,
    });
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode]);
    expect(harness.preparationCalls()).toBe(1);
    expect(storedSaveRecord(harness).state).toBe('completed');
    const target = await new DurableRoomSnapshotStore(
      harness.targetStorage
    ).load();
    expect(stableHash(target!.state)).toBe(stableHash(snapshotFixture().state));
    expect(stableSerialize(target!.state)).toBe(
      stableSerialize(snapshotFixture().state)
    );
  });

  it('recovers an ambiguous committed reservation with the same plan and target', async () => {
    const harness = await createHarness();
    const reserve = harness.dependencies.save.reserveRestore;
    let first = true;
    const dependencies: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      save: {
        ...harness.dependencies.save,
        reserveRestore: async (input) => {
          const result = await reserve(input);
          if (first) {
            first = false;
            throw new Error('ambiguous save reservation response');
          }
          return result;
        },
      },
    };

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).rejects.toThrow('ambiguous save reservation');
    expect(storedSaveRecord(harness).state).toBe('restoring');
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).resolves.toMatchObject({ targetRoomCode });
    expect(harness.preparationCalls()).toBe(1);
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode]);
  });

  it('does not leave active custody when reservation or preparation fails before commit', async () => {
    const harness = await createHarness();
    const target = vi.spyOn(
      harness.dependencies.target,
      'initializeRestoreTarget'
    );
    const unavailable: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      save: {
        ...harness.dependencies.save,
        reserveRestore: async () => {
          throw new Error('save unavailable before reservation');
        },
      },
    };
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        unavailable
      )
    ).rejects.toThrow('save unavailable');
    expect(storedSaveRecord(harness).state).toBe('active');

    const preparationFailure: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      save: {
        ...harness.dependencies.save,
        reserveRestore: (input) =>
          harness.custody.reserveRestore(input, async () => {
            throw new Error('fork preparation failed');
          }),
      },
    };
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        preparationFailure
      )
    ).rejects.toThrow('fork preparation failed');
    expect(storedSaveRecord(harness).state).toBe('active');
    expect(target).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous committed target without choosing or preparing again', async () => {
    const harness = await createHarness();
    const initialize = harness.dependencies.target.initializeRestoreTarget;
    let first = true;
    const dependencies: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      target: {
        initializeRestoreTarget: async (plan) => {
          const result = await initialize(plan);
          if (first) {
            first = false;
            throw new Error('ambiguous target response');
          }
          return result;
        },
      },
    };

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).rejects.toThrow('ambiguous target');
    expect(storedSaveRecord(harness).state).toBe('restoring');
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).resolves.toMatchObject({ targetRoomCode });
    expect(harness.preparationCalls()).toBe(1);
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode, targetRoomCode]);
  });

  it('recovers an ambiguous committed completion directly from its retry receipt', async () => {
    const harness = await createHarness();
    const complete = harness.dependencies.save.completeRestore;
    let first = true;
    const dependencies: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      save: {
        ...harness.dependencies.save,
        completeRestore: async (input) => {
          const result = await complete(input);
          if (first) {
            first = false;
            throw new Error('ambiguous save completion response');
          }
          return result;
        },
      },
    };

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).rejects.toThrow('ambiguous save completion');
    expect(storedSaveRecord(harness).state).toBe('completed');
    const selectedBeforeRetry = [...harness.selectedRoomCodes];
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).resolves.toMatchObject({
      targetRoomCode,
      completedAt: restoredAt + 1,
    });
    expect(harness.selectedRoomCodes).toEqual(selectedBeforeRetry);
    expect(harness.preparationCalls()).toBe(1);
  });

  it('leaves a reserved save recoverable after target or completion pre-commit failure', async () => {
    const harness = await createHarness();
    let failTarget = true;
    let failCompletion = true;
    const initialize = harness.dependencies.target.initializeRestoreTarget;
    const complete = harness.dependencies.save.completeRestore;
    const dependencies: ContinuationRestoreCoordinatorDependencies = {
      ...harness.dependencies,
      target: {
        initializeRestoreTarget: async (plan) => {
          if (failTarget) {
            failTarget = false;
            throw new Error('target unavailable before commit');
          }
          return initialize(plan);
        },
      },
      save: {
        ...harness.dependencies.save,
        completeRestore: async (input) => {
          if (failCompletion) {
            failCompletion = false;
            throw new Error('completion unavailable before commit');
          }
          return complete(input);
        },
      },
    };

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).rejects.toThrow('target unavailable');
    expect(storedSaveRecord(harness).state).toBe('restoring');
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).rejects.toThrow('completion unavailable');
    expect(storedSaveRecord(harness).state).toBe('restoring');
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        dependencies
      )
    ).resolves.toMatchObject({ targetRoomCode });
    expect(harness.preparationCalls()).toBe(1);
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode, targetRoomCode]);
  });

  it('never returns credentials when the target expires before save completion', async () => {
    const harness = await createHarness();
    harness.times.splice(
      0,
      harness.times.length,
      restoredAt,
      restoredAt + DEFAULT_CONTINUATION_TARGET_LIFETIME_MS
    );

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        harness.dependencies
      )
    ).rejects.toThrow('completion time is invalid');
    expect(storedSaveRecord(harness).state).toBe('restoring');
    expect(harness.targetStorage.alarm).toBe(
      restoredAt + DEFAULT_CONTINUATION_TARGET_LIFETIME_MS
    );
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode]);
  });

  it('leaves only an alarm-bounded orphan when custody expires during target work', async () => {
    const harness = await createHarness(MINIMUM_CONTINUATION_TTL_MS);
    harness.times.splice(
      0,
      harness.times.length,
      restoredAt,
      createdAt + MINIMUM_CONTINUATION_TTL_MS
    );

    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        harness.dependencies
      )
    ).resolves.toBeUndefined();
    expect(harness.saveStorage.values.has(CONTINUATION_STORAGE_KEY)).toBe(
      false
    );
    expect(harness.saveStorage.alarm).toBeNull();
    expect(harness.targetStorage.alarm).toBe(
      restoredAt + DEFAULT_CONTINUATION_TARGET_LIFETIME_MS
    );
    expect(harness.selectedRoomCodes).toEqual([targetRoomCode]);
  });

  it('never reaches a target for an unavailable, foreign, or completed restore', async () => {
    const harness = await createHarness();
    const target = vi.spyOn(
      harness.dependencies.target,
      'initializeRestoreTarget'
    );
    const parsed = parseContinuationCapability(harness.capability)!;
    const alternateBearer = createContinuationCapability()
      .capability.split('.')
      .at(-1)!;
    const malformed = await coordinateContinuationRestore(
      { capability: 'not-a-capability', operationId },
      harness.dependencies
    );
    const foreign = await coordinateContinuationRestore(
      {
        capability: `ptcgsave.v1.${parsed.saveId}.${alternateBearer}`,
        operationId,
      },
      harness.dependencies
    );
    expect(malformed).toBeUndefined();
    expect(foreign).toBeUndefined();
    expect(target).not.toHaveBeenCalled();

    const completed = await coordinateContinuationRestore(
      restoreInput(harness.capability),
      harness.dependencies
    );
    expect(completed).toBeDefined();
    expect(target).toHaveBeenCalledTimes(1);

    const completedTargetCalls = target.mock.calls.length;
    await expect(
      coordinateContinuationRestore(
        restoreInput(harness.capability),
        harness.dependencies
      )
    ).resolves.toEqual(completed);
    expect(target).toHaveBeenCalledTimes(completedTargetCalls);
    await expect(
      coordinateContinuationRestore(
        { capability: harness.capability, operationId: 'S'.repeat(43) },
        harness.dependencies
      )
    ).resolves.toBeUndefined();
    expect(target).toHaveBeenCalledTimes(completedTargetCalls);
  });

  it('fails closed on mismatched room acknowledgements and completion receipts', async () => {
    const acknowledgementHarness = await createHarness();
    const acknowledgeWrongRoom: ContinuationRestoreCoordinatorDependencies = {
      ...acknowledgementHarness.dependencies,
      target: {
        initializeRestoreTarget: async () => ({
          created: true,
          targetRoomCode: 'CDEFGHJK3456',
        }),
      },
    };
    await expect(
      coordinateContinuationRestore(
        restoreInput(acknowledgementHarness.capability),
        acknowledgeWrongRoom
      )
    ).rejects.toBeInstanceOf(ContinuationRestoreCoordinationError);
    expect(storedSaveRecord(acknowledgementHarness).state).toBe('restoring');

    const completionHarness = await createHarness();
    const complete = completionHarness.dependencies.save.completeRestore;
    const alteredReceipt: ContinuationRestoreCoordinatorDependencies = {
      ...completionHarness.dependencies,
      save: {
        ...completionHarness.dependencies.save,
        completeRestore: async (input) => {
          const result = await complete(input);
          return result && { ...result, targetRoomCode: 'CDEFGHJK3456' };
        },
      },
    };
    await expect(
      coordinateContinuationRestore(
        restoreInput(completionHarness.capability),
        alteredReceipt
      )
    ).rejects.toBeInstanceOf(ContinuationRestoreCoordinationError);
  });

  it('rejects an invalid coordinator clock before calling either object', async () => {
    const reserveRestore =
      vi.fn<ContinuationRestoreSavePort['reserveRestore']>();
    const completeRestore =
      vi.fn<ContinuationRestoreSavePort['completeRestore']>();
    const initializeRestoreTarget =
      vi.fn<ContinuationRestoreTargetPort['initializeRestoreTarget']>();
    const capability = createContinuationCapability().capability;

    await expect(
      coordinateContinuationRestore(restoreInput(capability), {
        save: { reserveRestore, completeRestore },
        target: { initializeRestoreTarget },
        clock: { now: () => Number.NaN },
      })
    ).rejects.toThrow('clock is invalid');
    expect(reserveRestore).not.toHaveBeenCalled();
    expect(completeRestore).not.toHaveBeenCalled();
    expect(initializeRestoreTarget).not.toHaveBeenCalled();
  });
});
