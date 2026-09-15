import { stableHash } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import type { RoomInitializationLifecycle } from './durable-storage.js';
import type { ContinuationRestorePlan } from './continuation-restore-format.js';

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const RESTORE_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TARGET_IDENTITY_FORMAT = 'ptcgsim-continuation-target-identity-v1';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;

export interface ContinuationTargetDigestSource {
  readonly digestCapability: (value: string) => Promise<string>;
}

export interface ContinuationTargetStore {
  readonly initializeContinuationTarget: (
    snapshot: RoomAuthoritySnapshot,
    lifecycle: RoomInitializationLifecycle,
    restoreDigest: string
  ) => Promise<boolean>;
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

const boundedCapability = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 32 && value.length <= 512;

export const validateContinuationTargetPlan = async (
  value: unknown,
  source: ContinuationTargetDigestSource
): Promise<ContinuationRestorePlan> => {
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
    throw new Error('Continuation target plan is invalid');
  }
  const plan = value as ContinuationRestorePlan;
  const invitation = plan.opponentInvitation;
  if (
    plan.format !== 'ptcgsim-continuation-restore-plan-v1' ||
    !SAVE_ID_PATTERN.test(plan.saveId) ||
    !RESTORE_OPERATION_PATTERN.test(plan.operationId) ||
    !safeNonNegativeInteger(plan.reservedAt) ||
    !ROOM_CODE_PATTERN.test(plan.targetRoomCode) ||
    !safeNonNegativeInteger(plan.targetUnclaimedExpiresAt) ||
    plan.targetUnclaimedExpiresAt <= plan.reservedAt ||
    plan.targetUnclaimedExpiresAt - plan.reservedAt > 24 * 60 * 60_000 ||
    typeof plan.requesterPlayerId !== 'string' ||
    typeof plan.canonicalStateHash !== 'string' ||
    !boundedCapability(plan.requesterSeatCapability) ||
    typeof invitation !== 'object' ||
    invitation === null ||
    !exactKeys(invitation, ['expiresAt', 'invitation']) ||
    !boundedCapability(invitation.invitation) ||
    !safeNonNegativeInteger(invitation.expiresAt) ||
    invitation.expiresAt <= plan.reservedAt ||
    invitation.expiresAt > plan.targetUnclaimedExpiresAt ||
    typeof plan.snapshot !== 'object' ||
    plan.snapshot === null ||
    !exactKeys(plan.snapshot, [
      'admission',
      'authorityVersion',
      'identities',
      'mode',
      'replayHistory',
      'schemaVersion',
      'sessions',
      'soloUndoHistory',
      'state',
    ])
  ) {
    throw new Error('Continuation target plan is invalid');
  }
  try {
    validateAuthoritySnapshot(plan.snapshot);
  } catch {
    throw new Error('Continuation target plan is invalid');
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
    throw new Error('Continuation target plan is invalid');
  }
  const requesterSeat = admission.seats[plan.requesterPlayerId];
  const opponentSeat = admission.seats[opponentPlayerId];
  const requesterDigest = await source.digestCapability(
    plan.requesterSeatCapability
  );
  const invitationDigest = await source.digestCapability(invitation.invitation);
  const storedInvitation = admission.invitations[invitationDigest];
  if (
    !DIGEST_PATTERN.test(requesterDigest) ||
    !DIGEST_PATTERN.test(opponentSeat?.claimCapabilityDigest ?? '') ||
    !DIGEST_PATTERN.test(invitationDigest) ||
    !requesterSeat ||
    !opponentSeat ||
    requesterSeat.claimCapabilityDigest !== requesterDigest ||
    new Set([
      requesterSeat.claimCapabilityDigest,
      opponentSeat.claimCapabilityDigest,
      invitationDigest,
    ]).size !== 3 ||
    !storedInvitation ||
    storedInvitation.role !== 'player' ||
    storedInvitation.playerId !== opponentPlayerId ||
    storedInvitation.expiresAt !== invitation.expiresAt
  ) {
    throw new Error('Continuation target plan is invalid');
  }
  return plan;
};

export const deriveContinuationTargetRestoreDigest = async (
  saveId: string,
  operationId: string,
  source: ContinuationTargetDigestSource
): Promise<string> => {
  if (
    !SAVE_ID_PATTERN.test(saveId) ||
    !RESTORE_OPERATION_PATTERN.test(operationId)
  ) {
    throw new Error('Continuation target identity is invalid');
  }
  const digest = await source.digestCapability(
    `${TARGET_IDENTITY_FORMAT}\u0000${saveId}\u0000${operationId}`
  );
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error('Continuation target digest source is invalid');
  }
  return digest;
};

/**
 * Bridges one authenticated encrypted restore plan to its target-room store.
 * The target object is selected separately from plan.targetRoomCode; this
 * helper supplies only exact contents and a digest-only idempotency marker.
 */
export const initializeContinuationTarget = async (
  planValue: unknown,
  store: ContinuationTargetStore,
  digestSource: ContinuationTargetDigestSource,
  selectedRoomCode: string
): Promise<{ readonly created: boolean; readonly targetRoomCode: string }> => {
  const plan = await validateContinuationTargetPlan(planValue, digestSource);
  if (selectedRoomCode !== plan.targetRoomCode) {
    throw new Error('Continuation target selection does not match its plan');
  }
  const restoreDigest = await deriveContinuationTargetRestoreDigest(
    plan.saveId,
    plan.operationId,
    digestSource
  );
  const created = await store.initializeContinuationTarget(
    plan.snapshot,
    {
      createdAt: plan.reservedAt,
      unclaimedExpiresAt: plan.targetUnclaimedExpiresAt,
    },
    restoreDigest
  );
  return Object.freeze({ created, targetRoomCode: selectedRoomCode });
};
