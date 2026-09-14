import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';

import type { RoomInitializationLifecycle } from './durable-storage.js';
import type { ContinuationRestorePlan } from './continuation-restore-format.js';

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const RESTORE_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TARGET_IDENTITY_FORMAT = 'ptcgsim-continuation-target-identity-v1';

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
  plan: ContinuationRestorePlan,
  store: ContinuationTargetStore,
  digestSource: ContinuationTargetDigestSource
): Promise<{ readonly created: boolean; readonly targetRoomCode: string }> => {
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
  return Object.freeze({ created, targetRoomCode: plan.targetRoomCode });
};
