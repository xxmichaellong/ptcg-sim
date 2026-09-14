import { stableSerialize } from '@ptcgsim/game-core';

import { parseContinuationCapability } from './continuation-custody.js';
import {
  createContinuationRestoreResult,
  validContinuationRestoreOperationId,
  type CompleteContinuationRestoreInput,
  type ContinuationRestorePlan,
  type ContinuationRestoreReservation,
  type ContinuationRestoreResult,
  type ReserveContinuationRestoreInput,
} from './continuation-restore-format.js';

export interface ContinuationRestoreSavePort {
  readonly reserveRestore: (
    input: ReserveContinuationRestoreInput
  ) => Promise<ContinuationRestoreReservation | undefined>;
  readonly completeRestore: (
    input: CompleteContinuationRestoreInput
  ) => Promise<ContinuationRestoreResult | undefined>;
}

export interface ContinuationRestoreTargetAcknowledgement {
  /** False only when the exact target initialization was already committed. */
  readonly created: boolean;
  readonly targetRoomCode: string;
}

export interface ContinuationRestoreTargetPort {
  readonly initializeRestoreTarget: (
    plan: ContinuationRestorePlan
  ) => Promise<ContinuationRestoreTargetAcknowledgement>;
}

export interface ContinuationRestoreClock {
  readonly now: () => number;
}

export interface CoordinateContinuationRestoreInput {
  readonly capability: string;
  readonly operationId: string;
}

export interface ContinuationRestoreCoordinatorDependencies {
  readonly save: ContinuationRestoreSavePort;
  readonly target: ContinuationRestoreTargetPort;
  readonly clock: ContinuationRestoreClock;
}

export class ContinuationRestoreCoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContinuationRestoreCoordinationError';
  }
}

const coordinatorTime = (clock: ContinuationRestoreClock): number => {
  const now = clock.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ContinuationRestoreCoordinationError(
      'Continuation restore coordinator clock is invalid'
    );
  }
  return now;
};

const resultMatchesRequest = (
  result: ContinuationRestoreResult,
  saveId: string,
  operationId: string
): boolean => result.saveId === saveId && result.operationId === operationId;

/**
 * Coordinates the save and target Durable Objects without assuming an atomic
 * cross-object transaction. Every irreversible boundary is retried through an
 * object-owned idempotency contract keyed by the same restore operation.
 */
export const coordinateContinuationRestore = async (
  input: CoordinateContinuationRestoreInput,
  dependencies: ContinuationRestoreCoordinatorDependencies
): Promise<ContinuationRestoreResult | undefined> => {
  const parsed = parseContinuationCapability(input.capability);
  if (!parsed || !validContinuationRestoreOperationId(input.operationId)) {
    return undefined;
  }
  const reservedAt = coordinatorTime(dependencies.clock);
  const reservation = await dependencies.save.reserveRestore({
    capability: input.capability,
    operationId: input.operationId,
    reservedAt,
  });
  if (!reservation) return undefined;
  if (reservation.state === 'completed') {
    if (
      !resultMatchesRequest(
        reservation.result,
        parsed.saveId,
        input.operationId
      )
    ) {
      throw new ContinuationRestoreCoordinationError(
        'Continuation restore retry receipt does not match its request'
      );
    }
    return reservation.result;
  }

  const { plan } = reservation;
  if (plan.saveId !== parsed.saveId || plan.operationId !== input.operationId) {
    throw new ContinuationRestoreCoordinationError(
      'Continuation restore reservation does not match its request'
    );
  }
  const acknowledgement =
    await dependencies.target.initializeRestoreTarget(plan);
  if (
    typeof acknowledgement.created !== 'boolean' ||
    acknowledgement.targetRoomCode !== plan.targetRoomCode
  ) {
    throw new ContinuationRestoreCoordinationError(
      'Continuation restore target acknowledgement does not match its plan'
    );
  }

  const completed = await dependencies.save.completeRestore({
    capability: input.capability,
    operationId: input.operationId,
    completedAt: coordinatorTime(dependencies.clock),
  });
  if (!completed) return undefined;
  const expected = createContinuationRestoreResult(
    plan,
    completed.completedAt
  ).result;
  if (stableSerialize(completed) !== stableSerialize(expected)) {
    throw new ContinuationRestoreCoordinationError(
      'Continuation restore completion does not match its plan'
    );
  }
  return completed;
};
