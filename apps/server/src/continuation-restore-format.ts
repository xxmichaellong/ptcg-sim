import { stableHash, stableSerialize, type PlayerId } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import { ContinuationCorruptError } from './continuation-errors.js';
import {
  DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
  MAX_CONTINUATION_PLAINTEXT_BYTES,
} from './continuation-limits.js';
import type {
  ContinuationCheckpoint,
  ContinuationCryptography,
} from './continuation-contract.js';
import type { PreparedContinuationFork } from './continuation-fork.js';

const CONTINUATION_RESTORE_PLAN_FORMAT = 'ptcgsim-continuation-restore-plan-v1';
const CONTINUATION_RESTORE_RESULT_FORMAT =
  'ptcgsim-continuation-restore-result-v1';
const RESTORE_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export { DEFAULT_CONTINUATION_TARGET_LIFETIME_MS };

export interface ContinuationRestorePreparation {
  readonly targetRoomCode: string;
  readonly fork: PreparedContinuationFork;
}

export interface ContinuationRestorePlan {
  readonly format: typeof CONTINUATION_RESTORE_PLAN_FORMAT;
  readonly saveId: string;
  readonly operationId: string;
  readonly reservedAt: number;
  readonly targetRoomCode: string;
  readonly targetUnclaimedExpiresAt: number;
  readonly requesterPlayerId: PlayerId;
  readonly canonicalStateHash: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSeatCapability: string;
  readonly opponentInvitation: {
    readonly invitation: string;
    readonly expiresAt: number;
  };
}

export interface ContinuationRestoreResult {
  readonly format: typeof CONTINUATION_RESTORE_RESULT_FORMAT;
  readonly saveId: string;
  readonly operationId: string;
  readonly completedAt: number;
  readonly targetRoomCode: string;
  readonly requesterSeatCapability: string;
  readonly opponentInvitation: {
    readonly invitation: string;
    readonly expiresAt: number;
  };
}

export type ContinuationRestoreReservation =
  | {
      readonly state: 'reserved';
      readonly created: boolean;
      readonly plan: ContinuationRestorePlan;
    }
  | {
      readonly state: 'completed';
      readonly result: ContinuationRestoreResult;
    };

export interface ReserveContinuationRestoreInput {
  readonly capability: string;
  readonly operationId: string;
  readonly reservedAt: number;
  readonly targetLifetimeMs?: number;
}

export interface CompleteContinuationRestoreInput {
  readonly capability: string;
  readonly operationId: string;
  readonly completedAt: number;
}

export type ContinuationRestorePreparer = (
  checkpoint: ContinuationCheckpoint
) => Promise<ContinuationRestorePreparation>;

interface RestorePlanExpectation {
  readonly saveId: string;
  readonly operationId: string;
  readonly reservedAt: number;
  readonly continuationExpiresAt: number;
  readonly checkpoint?: ContinuationCheckpoint;
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

const boundedCapability = (value: string): boolean =>
  value.length >= 32 && value.length <= 512;

export const validContinuationRestoreOperationId = (value: string): boolean =>
  RESTORE_OPERATION_PATTERN.test(value);

const authorityDigests = (
  snapshot: RoomAuthoritySnapshot
): ReadonlySet<string> => {
  const digests = new Set<string>();
  for (const session of Object.values(snapshot.sessions)) {
    if (session.resumeCapabilityDigest) {
      digests.add(session.resumeCapabilityDigest);
    }
  }
  if (!snapshot.admission) return digests;
  for (const seat of Object.values(snapshot.admission.seats)) {
    digests.add(seat.claimCapabilityDigest);
  }
  if (snapshot.admission.spectatorCapabilityDigest) {
    digests.add(snapshot.admission.spectatorCapabilityDigest);
  }
  for (const digest of Object.keys(snapshot.admission.invitations)) {
    digests.add(digest);
  }
  for (const [digest, ticket] of Object.entries(snapshot.admission.tickets)) {
    digests.add(digest);
    if (ticket.resumeCapabilityDigest) {
      digests.add(ticket.resumeCapabilityDigest);
    }
    if (ticket.sourceInvitationDigest) {
      digests.add(ticket.sourceInvitationDigest);
    }
  }
  return digests;
};

export const continuationTargetUnclaimedExpiry = (
  reservedAt: number,
  targetLifetimeMs: number,
  continuationExpiresAt: number
): number => {
  const targetUnclaimedExpiresAt = reservedAt + targetLifetimeMs;
  if (
    !safeNonNegativeInteger(targetLifetimeMs) ||
    targetLifetimeMs < 30_000 ||
    targetLifetimeMs > 24 * 60 * 60_000 ||
    !Number.isSafeInteger(targetUnclaimedExpiresAt) ||
    reservedAt >= continuationExpiresAt
  ) {
    throw new Error('Continuation restore lifecycle policy is invalid');
  }
  return targetUnclaimedExpiresAt;
};

const credentialDigest = (
  value: string,
  cryptography: ContinuationCryptography
): Promise<string> => cryptography.digest(encoder.encode(value));

const validateRestorePlan = async (
  plan: ContinuationRestorePlan,
  cryptography: ContinuationCryptography,
  expected: RestorePlanExpectation
): Promise<void> => {
  if (
    plan.format !== CONTINUATION_RESTORE_PLAN_FORMAT ||
    plan.saveId !== expected.saveId ||
    plan.operationId !== expected.operationId ||
    plan.reservedAt !== expected.reservedAt ||
    !ROOM_CODE_PATTERN.test(plan.targetRoomCode) ||
    !safeNonNegativeInteger(plan.targetUnclaimedExpiresAt) ||
    plan.targetUnclaimedExpiresAt <= plan.reservedAt ||
    plan.targetUnclaimedExpiresAt - plan.reservedAt > 24 * 60 * 60_000 ||
    typeof plan.requesterPlayerId !== 'string' ||
    typeof plan.canonicalStateHash !== 'string' ||
    !boundedCapability(plan.requesterSeatCapability) ||
    typeof plan.opponentInvitation !== 'object' ||
    plan.opponentInvitation === null ||
    !exactKeys(plan.opponentInvitation, ['expiresAt', 'invitation']) ||
    !boundedCapability(plan.opponentInvitation.invitation) ||
    !safeNonNegativeInteger(plan.opponentInvitation.expiresAt) ||
    plan.opponentInvitation.expiresAt <= plan.reservedAt ||
    plan.opponentInvitation.expiresAt > plan.targetUnclaimedExpiresAt ||
    plan.reservedAt >= expected.continuationExpiresAt
  ) {
    throw new ContinuationCorruptError();
  }
  try {
    validateAuthoritySnapshot(plan.snapshot);
  } catch {
    throw new ContinuationCorruptError();
  }
  const admission = plan.snapshot.admission;
  const playerIds = plan.snapshot.state.playerOrder;
  const opponentPlayerId = playerIds.find(
    (playerId) => playerId !== plan.requesterPlayerId
  );
  if (
    plan.snapshot.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION ||
    plan.snapshot.authorityVersion !== 0 ||
    plan.snapshot.mode !== 'multiplayer' ||
    plan.snapshot.state.matchId === plan.targetRoomCode ||
    stableHash(plan.snapshot.state) !== plan.canonicalStateHash ||
    playerIds.length !== 2 ||
    !playerIds.includes(plan.requesterPlayerId) ||
    !opponentPlayerId ||
    Object.keys(plan.snapshot.sessions).length !== 0 ||
    plan.snapshot.identities.cardAliases.length !== 0 ||
    plan.snapshot.identities.definitionAliases.length !== 0 ||
    plan.snapshot.soloUndoHistory.baseState !== null ||
    plan.snapshot.soloUndoHistory.baseStateHash !== null ||
    plan.snapshot.soloUndoHistory.entries.length !== 0 ||
    !admission ||
    admission.playerSeatLimit !== 2 ||
    admission.spectatorCapabilityDigest !== null ||
    Object.keys(admission.tickets).length !== 0 ||
    Object.keys(admission.seats).length !== 2 ||
    Object.values(admission.seats).some(
      (seat) => seat.claimedSessionId !== null
    ) ||
    Object.keys(admission.invitations).length !== 1
  ) {
    throw new ContinuationCorruptError();
  }
  const requesterSeat = admission.seats[plan.requesterPlayerId];
  const opponentSeat = admission.seats[opponentPlayerId];
  const requesterDigest = await credentialDigest(
    plan.requesterSeatCapability,
    cryptography
  );
  const opponentInvitationDigest = await credentialDigest(
    plan.opponentInvitation.invitation,
    cryptography
  );
  const invitation = admission.invitations[opponentInvitationDigest];
  if (
    !requesterSeat ||
    !opponentSeat ||
    !SHA256_DIGEST_PATTERN.test(requesterDigest) ||
    !SHA256_DIGEST_PATTERN.test(opponentSeat.claimCapabilityDigest) ||
    !SHA256_DIGEST_PATTERN.test(opponentInvitationDigest) ||
    !cryptography.equalDigest(
      requesterSeat.claimCapabilityDigest,
      requesterDigest
    ) ||
    requesterSeat.claimCapabilityDigest ===
      opponentSeat.claimCapabilityDigest ||
    opponentInvitationDigest === requesterSeat.claimCapabilityDigest ||
    opponentInvitationDigest === opponentSeat.claimCapabilityDigest ||
    !invitation ||
    invitation.role !== 'player' ||
    invitation.playerId !== opponentPlayerId ||
    invitation.expiresAt !== plan.opponentInvitation.expiresAt
  ) {
    throw new ContinuationCorruptError();
  }
  if (expected.checkpoint) {
    const checkpoint = expected.checkpoint;
    const oldDigests = authorityDigests(checkpoint.snapshot);
    const newDigests = authorityDigests(plan.snapshot);
    if (
      checkpoint.requesterPlayerId !== plan.requesterPlayerId ||
      checkpoint.canonicalStateHash !== plan.canonicalStateHash ||
      stableSerialize(checkpoint.snapshot.state) !==
        stableSerialize(plan.snapshot.state) ||
      stableSerialize(checkpoint.snapshot.replayHistory) !==
        stableSerialize(plan.snapshot.replayHistory) ||
      [...newDigests].some((digest) => oldDigests.has(digest))
    ) {
      throw new ContinuationCorruptError();
    }
  }
};

export const createContinuationRestorePlan = async (
  checkpoint: ContinuationCheckpoint,
  preparation: ContinuationRestorePreparation,
  operationId: string,
  reservedAt: number,
  targetUnclaimedExpiresAt: number,
  continuationExpiresAt: number,
  cryptography: ContinuationCryptography
): Promise<{
  readonly plan: ContinuationRestorePlan;
  readonly bytes: Uint8Array;
}> => {
  const plan: ContinuationRestorePlan = {
    format: CONTINUATION_RESTORE_PLAN_FORMAT,
    saveId: checkpoint.saveId,
    operationId,
    reservedAt,
    targetRoomCode: preparation.targetRoomCode,
    targetUnclaimedExpiresAt,
    requesterPlayerId: checkpoint.requesterPlayerId,
    canonicalStateHash: checkpoint.canonicalStateHash,
    snapshot: preparation.fork.snapshot,
    requesterSeatCapability: preparation.fork.requesterSeatCapability,
    opponentInvitation: preparation.fork.opponentInvitation,
  };
  await validateRestorePlan(plan, cryptography, {
    saveId: checkpoint.saveId,
    operationId,
    reservedAt,
    continuationExpiresAt,
    checkpoint,
  });
  const bytes = encoder.encode(stableSerialize(plan));
  if (bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES) {
    throw new RangeError('Continuation restore plan exceeds its byte limit');
  }
  return { plan, bytes };
};

export const readContinuationRestorePlan = async (
  bytes: Uint8Array,
  expected: RestorePlanExpectation,
  cryptography: ContinuationCryptography
): Promise<ContinuationRestorePlan> => {
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES
  ) {
    throw new ContinuationCorruptError();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new ContinuationCorruptError();
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'canonicalStateHash',
      'format',
      'operationId',
      'opponentInvitation',
      'requesterPlayerId',
      'requesterSeatCapability',
      'reservedAt',
      'saveId',
      'snapshot',
      'targetRoomCode',
      'targetUnclaimedExpiresAt',
    ])
  ) {
    throw new ContinuationCorruptError();
  }
  const plan = value as ContinuationRestorePlan;
  await validateRestorePlan(plan, cryptography, expected);
  return Object.freeze(plan);
};

export const createContinuationRestoreResult = (
  plan: ContinuationRestorePlan,
  completedAt: number
): {
  readonly result: ContinuationRestoreResult;
  readonly bytes: Uint8Array;
} => {
  const result: ContinuationRestoreResult = {
    format: CONTINUATION_RESTORE_RESULT_FORMAT,
    saveId: plan.saveId,
    operationId: plan.operationId,
    completedAt,
    targetRoomCode: plan.targetRoomCode,
    requesterSeatCapability: plan.requesterSeatCapability,
    opponentInvitation: plan.opponentInvitation,
  };
  const bytes = encoder.encode(stableSerialize(result));
  if (bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES) {
    throw new RangeError('Continuation restore result exceeds its byte limit');
  }
  return { result, bytes };
};

export const readContinuationRestoreResult = (
  bytes: Uint8Array,
  expected: {
    readonly saveId: string;
    readonly operationId: string;
    readonly completedAt: number;
  }
): ContinuationRestoreResult => {
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES
  ) {
    throw new ContinuationCorruptError();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new ContinuationCorruptError();
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'completedAt',
      'format',
      'operationId',
      'opponentInvitation',
      'requesterSeatCapability',
      'saveId',
      'targetRoomCode',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_RESTORE_RESULT_FORMAT ||
    Reflect.get(value, 'saveId') !== expected.saveId ||
    Reflect.get(value, 'operationId') !== expected.operationId ||
    Reflect.get(value, 'completedAt') !== expected.completedAt ||
    typeof Reflect.get(value, 'targetRoomCode') !== 'string' ||
    !ROOM_CODE_PATTERN.test(Reflect.get(value, 'targetRoomCode')) ||
    typeof Reflect.get(value, 'requesterSeatCapability') !== 'string' ||
    !boundedCapability(Reflect.get(value, 'requesterSeatCapability'))
  ) {
    throw new ContinuationCorruptError();
  }
  const opponentInvitation = Reflect.get(value, 'opponentInvitation');
  if (
    typeof opponentInvitation !== 'object' ||
    opponentInvitation === null ||
    !exactKeys(opponentInvitation, ['expiresAt', 'invitation']) ||
    typeof Reflect.get(opponentInvitation, 'invitation') !== 'string' ||
    !boundedCapability(Reflect.get(opponentInvitation, 'invitation')) ||
    !safeNonNegativeInteger(Reflect.get(opponentInvitation, 'expiresAt'))
  ) {
    throw new ContinuationCorruptError();
  }
  return Object.freeze(value as ContinuationRestoreResult);
};
