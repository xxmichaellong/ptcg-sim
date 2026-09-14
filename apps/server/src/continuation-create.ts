import { validateAuthoritySnapshot } from '@ptcgsim/room-authority';

import {
  DEFAULT_CONTINUATION_TTL_MS,
  MINIMUM_CONTINUATION_TTL_MS,
  parseContinuationCapability,
  type ContinuationCreationReceipt,
  type CreateReservedContinuationInput,
  type RecoverReservedContinuationInput,
  type ReservedContinuationCreationResult,
} from './continuation-custody.js';
import type {
  CompleteContinuationSourceCreationInput,
  ContinuationSourceCreationPlan,
  ContinuationSourceCreationReference,
  ContinuationSourceCreationReservation,
  ReserveContinuationSourceCreationInput,
} from './continuation-source.js';

const CREATION_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

type SourceReserveInput = Omit<
  ReserveContinuationSourceCreationInput,
  'snapshot'
>;
type SourceCompleteInput = Omit<
  CompleteContinuationSourceCreationInput,
  'snapshot'
>;

export interface ContinuationCreationSourcePort {
  readonly reserveCreation: (
    input: SourceReserveInput
  ) => Promise<ContinuationSourceCreationReservation | undefined>;
  readonly completeCreation: (
    input: SourceCompleteInput
  ) => Promise<ContinuationSourceCreationReference | undefined>;
}

export interface ContinuationCreationSavePort {
  readonly createReserved: (
    input: CreateReservedContinuationInput
  ) => Promise<ReservedContinuationCreationResult | undefined>;
  readonly recoverReserved: (
    input: RecoverReservedContinuationInput
  ) => Promise<ContinuationCreationReceipt | undefined>;
}

export interface ContinuationCreationClock {
  readonly now: () => number;
}

export interface CoordinateContinuationCreationInput {
  readonly requesterSessionId: string;
  readonly operationId: string;
  readonly sourceBuild: string;
}

export type ContinuationCreationCoordinationResult =
  | {
      readonly state: 'created';
      readonly receipt: ContinuationCreationReceipt;
    }
  | {
      readonly state: 'quota_exceeded';
      readonly scope: 'player' | 'room';
    };

export interface ContinuationCreationCoordinatorDependencies {
  readonly source: ContinuationCreationSourcePort;
  readonly saveForId: (saveId: string) => ContinuationCreationSavePort;
  readonly clock: ContinuationCreationClock;
}

export class ContinuationCreationCoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContinuationCreationCoordinationError';
  }
}

const coordinatorTime = (clock: ContinuationCreationClock): number => {
  const now = clock.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ContinuationCreationCoordinationError(
      'Continuation creation coordinator clock is invalid'
    );
  }
  return now;
};

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

const exactRpcResultKeys = (
  value: object,
  expected: readonly string[]
): boolean => {
  const keys = Reflect.ownKeys(value);
  const payloadKeys = keys.filter(
    (key): key is string => typeof key === 'string'
  );
  return (
    keys.every((key) => typeof key === 'string' || key === Symbol.dispose) &&
    JSON.stringify(payloadKeys.sort()) === JSON.stringify([...expected].sort())
  );
};

const disposeRpcResult = (value: object): void => {
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === 'function') dispose.call(value);
};

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validLifetime = (createdAt: number, expiresAt: number): boolean =>
  safeNonNegativeInteger(createdAt) &&
  safeNonNegativeInteger(expiresAt) &&
  expiresAt > createdAt &&
  expiresAt - createdAt >= MINIMUM_CONTINUATION_TTL_MS &&
  expiresAt - createdAt <= DEFAULT_CONTINUATION_TTL_MS;

const referenceMatches = (
  value: ContinuationSourceCreationReference,
  saveId: string,
  expiresAt: number
): boolean =>
  typeof value === 'object' &&
  value !== null &&
  exactKeys(value, ['expiresAt', 'saveId']) &&
  value.saveId === saveId &&
  value.expiresAt === expiresAt;

const validCompletedReference = (
  value: ContinuationSourceCreationReference,
  reservedAt: number
): boolean =>
  typeof value === 'object' &&
  value !== null &&
  exactKeys(value, ['expiresAt', 'saveId']) &&
  SAVE_ID_PATTERN.test(value.saveId) &&
  safeNonNegativeInteger(value.expiresAt) &&
  reservedAt < value.expiresAt;

const validatePlan = (
  plan: ContinuationSourceCreationPlan,
  input: CoordinateContinuationCreationInput,
  reservedAt: number
): void => {
  if (
    typeof plan !== 'object' ||
    plan === null ||
    !exactKeys(plan, [
      'createdAt',
      'expiresAt',
      'format',
      'operationId',
      'requesterPlayerId',
      'requesterSessionId',
      'saveId',
      'snapshot',
      'sourceBuild',
    ])
  ) {
    throw new ContinuationCreationCoordinationError(
      'Continuation source reservation does not match its request'
    );
  }
  let validSnapshot = true;
  try {
    validateAuthoritySnapshot(plan.snapshot);
  } catch {
    validSnapshot = false;
  }
  const session = validSnapshot
    ? plan.snapshot.sessions[plan.requesterSessionId]
    : undefined;
  if (
    plan.format !== 'ptcgsim-continuation-creation-plan-v1' ||
    plan.operationId !== input.operationId ||
    !SAVE_ID_PATTERN.test(plan.saveId) ||
    plan.requesterSessionId !== input.requesterSessionId ||
    plan.sourceBuild !== input.sourceBuild ||
    !validLifetime(plan.createdAt, plan.expiresAt) ||
    plan.createdAt > reservedAt ||
    reservedAt >= plan.expiresAt ||
    !validSnapshot ||
    plan.snapshot.mode !== 'multiplayer' ||
    !session?.active ||
    session.viewer.kind !== 'player' ||
    session.viewer.playerId !== plan.requesterPlayerId ||
    plan.snapshot.admission?.seats[plan.requesterPlayerId]?.claimedSessionId !==
      plan.requesterSessionId
  ) {
    throw new ContinuationCreationCoordinationError(
      'Continuation source reservation does not match its request'
    );
  }
};

const validateReceipt = (
  receipt: ContinuationCreationReceipt,
  operationId: string,
  reference: ContinuationSourceCreationReference,
  expectedCreatedAt?: number
): ContinuationCreationReceipt => {
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    !exactRpcResultKeys(receipt, [
      'capability',
      'createdAt',
      'expiresAt',
      'format',
      'operationId',
      'saveId',
    ])
  ) {
    throw new ContinuationCreationCoordinationError(
      'Continuation save receipt does not match its reservation'
    );
  }
  const parsed =
    typeof receipt.capability === 'string'
      ? parseContinuationCapability(receipt.capability)
      : undefined;
  if (
    receipt.format !== 'ptcgsim-continuation-creation-result-v1' ||
    receipt.operationId !== operationId ||
    receipt.saveId !== reference.saveId ||
    receipt.expiresAt !== reference.expiresAt ||
    (expectedCreatedAt !== undefined &&
      receipt.createdAt !== expectedCreatedAt) ||
    !validLifetime(receipt.createdAt, receipt.expiresAt) ||
    !parsed ||
    parsed.saveId !== receipt.saveId
  ) {
    throw new ContinuationCreationCoordinationError(
      'Continuation save receipt does not match its reservation'
    );
  }
  return Object.freeze({
    format: receipt.format,
    saveId: receipt.saveId,
    operationId: receipt.operationId,
    capability: receipt.capability,
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
  });
};

/**
 * Coordinates source-room and save-object storage without a distributed
 * transaction. Both sides own stable-operation recovery, so any thrown or lost
 * response is resolved by replaying the same operation through this function.
 */
export const coordinateContinuationCreation = async (
  input: CoordinateContinuationCreationInput,
  dependencies: ContinuationCreationCoordinatorDependencies
): Promise<ContinuationCreationCoordinationResult | undefined> => {
  if (
    !CREATION_OPERATION_PATTERN.test(input.operationId) ||
    input.requesterSessionId.length < 1 ||
    input.requesterSessionId.length > 256 ||
    input.sourceBuild.length < 1 ||
    input.sourceBuild.length > 128 ||
    [...input.sourceBuild].some((character) => character < ' ')
  ) {
    return undefined;
  }
  const reservedAt = coordinatorTime(dependencies.clock);
  const reservation = await dependencies.source.reserveCreation({
    requesterSessionId: input.requesterSessionId,
    operationId: input.operationId,
    sourceBuild: input.sourceBuild,
    createdAt: reservedAt,
  });
  if (!reservation) return undefined;
  if (typeof reservation !== 'object') {
    throw new ContinuationCreationCoordinationError(
      'Continuation source reservation state is malformed'
    );
  }
  if (reservation.state === 'quota_exceeded') {
    if (
      !exactKeys(reservation, ['scope', 'state']) ||
      (reservation.scope !== 'player' && reservation.scope !== 'room')
    ) {
      throw new ContinuationCreationCoordinationError(
        'Continuation source quota result is malformed'
      );
    }
    return reservation;
  }
  if (reservation.state === 'completed') {
    if (
      !exactKeys(reservation, ['reference', 'state']) ||
      !validCompletedReference(reservation.reference, reservedAt)
    ) {
      throw new ContinuationCreationCoordinationError(
        'Continuation completed source reference is malformed'
      );
    }
    const receipt = await dependencies
      .saveForId(reservation.reference.saveId)
      .recoverReserved({
        saveId: reservation.reference.saveId,
        operationId: input.operationId,
        requestedAt: coordinatorTime(dependencies.clock),
      });
    if (!receipt) {
      throw new ContinuationCreationCoordinationError(
        'Continuation completed source receipt is unavailable'
      );
    }
    try {
      return {
        state: 'created',
        receipt: validateReceipt(
          receipt,
          input.operationId,
          reservation.reference
        ),
      };
    } finally {
      disposeRpcResult(receipt);
    }
  }

  if (
    reservation.state !== 'pending' ||
    !exactKeys(reservation, ['created', 'plan', 'state']) ||
    typeof reservation.created !== 'boolean'
  ) {
    throw new ContinuationCreationCoordinationError(
      'Continuation source reservation state is malformed'
    );
  }
  validatePlan(reservation.plan, input, reservedAt);
  const plan = reservation.plan;
  const reference = { saveId: plan.saveId, expiresAt: plan.expiresAt };
  const saved = await dependencies.saveForId(plan.saveId).createReserved({
    saveId: plan.saveId,
    operationId: plan.operationId,
    snapshot: plan.snapshot,
    requesterSessionId: plan.requesterSessionId,
    sourceBuild: plan.sourceBuild,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    requestedAt: coordinatorTime(dependencies.clock),
  });
  if (!saved)
    throw new ContinuationCreationCoordinationError(
      'Continuation save rejected its source reservation'
    );
  let receipt: ContinuationCreationReceipt;
  try {
    if (
      typeof saved !== 'object' ||
      !exactRpcResultKeys(saved, ['created', 'receipt']) ||
      typeof saved.created !== 'boolean'
    ) {
      throw new ContinuationCreationCoordinationError(
        'Continuation save creation result is malformed'
      );
    }
    receipt = validateReceipt(
      saved.receipt,
      input.operationId,
      reference,
      plan.createdAt
    );
  } finally {
    if (typeof saved === 'object') disposeRpcResult(saved);
  }
  const completed = await dependencies.source.completeCreation({
    requesterSessionId: input.requesterSessionId,
    operationId: input.operationId,
    completedAt: coordinatorTime(dependencies.clock),
    reference,
  });
  if (!completed || !referenceMatches(completed, plan.saveId, plan.expiresAt)) {
    throw new ContinuationCreationCoordinationError(
      'Continuation source completion does not match its reservation'
    );
  }
  return { state: 'created', receipt };
};
