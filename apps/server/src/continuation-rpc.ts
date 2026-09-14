import { validateAuthoritySnapshot } from '@ptcgsim/room-authority';

import {
  DEFAULT_CONTINUATION_TTL_MS,
  MINIMUM_CONTINUATION_TTL_MS,
  parseContinuationCapability,
  type CreateReservedContinuationInput,
  type RecoverReservedContinuationInput,
  type ContinuationRestoreResult,
} from './continuation-custody.js';
import type { CoordinateContinuationCreationInput } from './continuation-create.js';
import type { ReserveContinuationQuotaLeaseInput } from './continuation-quota.js';
import { validContinuationRestoreOperationId } from './continuation-restore-format.js';

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const CREATION_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;

export interface ContinuationRestoreRpcInput {
  readonly capability: string;
  readonly operationId: string;
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validSessionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 256;

const validSourceBuild = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 128 &&
  [...value].every((character) => character >= ' ');

export const readContinuationSourceCreationRpcInput = (
  value: unknown
):
  | Omit<CoordinateContinuationCreationInput, 'sourceBuild' | 'sourceRoomCode'>
  | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['operationId', 'requesterSessionId'])
  ) {
    return undefined;
  }
  const operationId = Reflect.get(value, 'operationId');
  const requesterSessionId = Reflect.get(value, 'requesterSessionId');
  if (
    typeof operationId !== 'string' ||
    !CREATION_OPERATION_PATTERN.test(operationId) ||
    !validSessionId(requesterSessionId)
  ) {
    return undefined;
  }
  return Object.freeze({ operationId, requesterSessionId });
};

export const readContinuationSaveCreationRpcInput = (
  value: unknown,
  expectedSaveId: string | undefined
): CreateReservedContinuationInput | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'createdAt',
      'expiresAt',
      'operationId',
      'requestedAt',
      'requesterSessionId',
      'saveId',
      'snapshot',
      'sourceBuild',
    ])
  ) {
    return undefined;
  }
  const saveId = Reflect.get(value, 'saveId');
  const operationId = Reflect.get(value, 'operationId');
  const snapshot = Reflect.get(value, 'snapshot');
  const requesterSessionId = Reflect.get(value, 'requesterSessionId');
  const sourceBuild = Reflect.get(value, 'sourceBuild');
  const createdAt = Reflect.get(value, 'createdAt');
  const expiresAt = Reflect.get(value, 'expiresAt');
  const requestedAt = Reflect.get(value, 'requestedAt');
  if (
    typeof saveId !== 'string' ||
    !SAVE_ID_PATTERN.test(saveId) ||
    !expectedSaveId ||
    saveId !== expectedSaveId ||
    typeof operationId !== 'string' ||
    !CREATION_OPERATION_PATTERN.test(operationId) ||
    typeof snapshot !== 'object' ||
    snapshot === null ||
    !validSessionId(requesterSessionId) ||
    !validSourceBuild(sourceBuild) ||
    !safeNonNegativeInteger(createdAt) ||
    !safeNonNegativeInteger(expiresAt) ||
    expiresAt <= createdAt ||
    expiresAt - createdAt < MINIMUM_CONTINUATION_TTL_MS ||
    expiresAt - createdAt > DEFAULT_CONTINUATION_TTL_MS ||
    !safeNonNegativeInteger(requestedAt) ||
    requestedAt < createdAt ||
    requestedAt >= expiresAt
  ) {
    return undefined;
  }
  try {
    validateAuthoritySnapshot(snapshot);
  } catch {
    return undefined;
  }
  const session = snapshot.sessions[requesterSessionId];
  if (
    snapshot.mode !== 'multiplayer' ||
    !session?.active ||
    session.viewer.kind !== 'player' ||
    snapshot.admission?.seats[session.viewer.playerId]?.claimedSessionId !==
      requesterSessionId
  ) {
    return undefined;
  }
  return Object.freeze({
    saveId,
    operationId,
    snapshot,
    requesterSessionId,
    sourceBuild,
    createdAt,
    expiresAt,
    requestedAt,
  });
};

export const readContinuationSaveRecoveryRpcInput = (
  value: unknown,
  expectedSaveId: string | undefined
): RecoverReservedContinuationInput | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['operationId', 'requestedAt', 'saveId'])
  ) {
    return undefined;
  }
  const saveId = Reflect.get(value, 'saveId');
  const operationId = Reflect.get(value, 'operationId');
  const requestedAt = Reflect.get(value, 'requestedAt');
  if (
    typeof saveId !== 'string' ||
    !SAVE_ID_PATTERN.test(saveId) ||
    !expectedSaveId ||
    saveId !== expectedSaveId ||
    typeof operationId !== 'string' ||
    !CREATION_OPERATION_PATTERN.test(operationId) ||
    !safeNonNegativeInteger(requestedAt)
  ) {
    return undefined;
  }
  return Object.freeze({ saveId, operationId, requestedAt });
};

export const readContinuationQuotaReservationRpcInput = (
  value: unknown
): ReserveContinuationQuotaLeaseInput | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'createdAt',
      'expiresAt',
      'operationId',
      'requestedAt',
      'saveId',
      'sourceRoomCode',
    ])
  ) {
    return undefined;
  }
  const sourceRoomCode = Reflect.get(value, 'sourceRoomCode');
  const operationId = Reflect.get(value, 'operationId');
  const saveId = Reflect.get(value, 'saveId');
  const createdAt = Reflect.get(value, 'createdAt');
  const expiresAt = Reflect.get(value, 'expiresAt');
  const requestedAt = Reflect.get(value, 'requestedAt');
  if (
    typeof sourceRoomCode !== 'string' ||
    !ROOM_CODE_PATTERN.test(sourceRoomCode) ||
    typeof operationId !== 'string' ||
    !CREATION_OPERATION_PATTERN.test(operationId) ||
    typeof saveId !== 'string' ||
    !SAVE_ID_PATTERN.test(saveId) ||
    !safeNonNegativeInteger(createdAt) ||
    !safeNonNegativeInteger(expiresAt) ||
    expiresAt <= createdAt ||
    expiresAt - createdAt < MINIMUM_CONTINUATION_TTL_MS ||
    expiresAt - createdAt > DEFAULT_CONTINUATION_TTL_MS ||
    !safeNonNegativeInteger(requestedAt) ||
    requestedAt < createdAt ||
    requestedAt >= expiresAt
  ) {
    return undefined;
  }
  return Object.freeze({
    sourceRoomCode,
    operationId,
    saveId,
    createdAt,
    expiresAt,
    requestedAt,
  });
};

export const readContinuationRestoreRpcInput = (
  value: unknown,
  expectedSaveId: string | undefined
): ContinuationRestoreRpcInput | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['capability', 'operationId'])
  ) {
    return undefined;
  }
  const capability = Reflect.get(value, 'capability');
  const operationId = Reflect.get(value, 'operationId');
  if (
    typeof capability !== 'string' ||
    typeof operationId !== 'string' ||
    !validContinuationRestoreOperationId(operationId)
  ) {
    return undefined;
  }
  const parsed = parseContinuationCapability(capability);
  if (!parsed || !expectedSaveId || parsed.saveId !== expectedSaveId) {
    return undefined;
  }
  return Object.freeze({ capability, operationId });
};

export type ContinuationRestoreRpcResult =
  ContinuationRestoreResult | undefined;
