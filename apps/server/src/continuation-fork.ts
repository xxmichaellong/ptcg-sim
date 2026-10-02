import { stableHash, type PlayerId } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_ROOM_INVITATION_POLICY,
  assertAuthoritySnapshotInvariants,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

export interface ContinuationForkSource {
  readonly canonicalStateHash: string;
  readonly requesterPlayerId: PlayerId;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface ContinuationForkCrypto {
  readonly digestCapability: (capability: string) => Promise<string>;
  readonly nextRoomInvitation: () => string;
  readonly nextSeatCapability: () => string;
}

export interface ContinuationForkPolicy {
  readonly opponentInvitationLifetimeMs: number;
}

export const DEFAULT_CONTINUATION_FORK_POLICY: ContinuationForkPolicy = {
  opponentInvitationLifetimeMs: DEFAULT_ROOM_INVITATION_POLICY.lifetimeMs,
};

export interface PreparedContinuationFork {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSeatCapability: string;
  readonly opponentInvitation: {
    readonly invitation: string;
    readonly expiresAt: number;
  };
}

interface FreshCredential {
  readonly raw: string;
  readonly digest: string;
}

const boundedCapability = (value: string): boolean =>
  value.length >= 32 && value.length <= 512;

const validDigest = (value: string): boolean =>
  /^[A-Za-z0-9_-]{43}$/u.test(value);

const authorizationDigests = (
  snapshot: RoomAuthoritySnapshot
): ReadonlySet<string> => {
  const result = new Set<string>();
  for (const session of Object.values(snapshot.sessions)) {
    if (session.resumeCapabilityDigest) {
      result.add(session.resumeCapabilityDigest);
    }
  }
  const admission = snapshot.admission;
  if (!admission) return result;
  for (const seat of Object.values(admission.seats)) {
    result.add(seat.claimCapabilityDigest);
  }
  if (admission.spectatorCapabilityDigest) {
    result.add(admission.spectatorCapabilityDigest);
  }
  for (const digest of Object.keys(admission.invitations)) {
    result.add(digest);
  }
  for (const [digest, ticket] of Object.entries(admission.tickets)) {
    result.add(digest);
    if (ticket.resumeCapabilityDigest) {
      result.add(ticket.resumeCapabilityDigest);
    }
    if (ticket.sourceInvitationDigest) {
      result.add(ticket.sourceInvitationDigest);
    }
  }
  return result;
};

const nextFreshCredential = async (
  next: () => string,
  cryptoSource: ContinuationForkCrypto,
  usedRaw: Set<string>,
  usedDigests: Set<string>,
  label: string
): Promise<FreshCredential> => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const raw = next();
    if (!boundedCapability(raw) || usedRaw.has(raw)) continue;
    const digest = await cryptoSource.digestCapability(raw);
    if (!validDigest(digest) || usedDigests.has(digest)) continue;
    usedRaw.add(raw);
    usedDigests.add(digest);
    return { raw, digest };
  }
  throw new Error(
    `Continuation ${label} source failed to produce a fresh bounded credential`
  );
};

const validateForkPolicy = (
  restoredAt: number,
  policy: ContinuationForkPolicy
): number => {
  const lifetimeMs = policy.opponentInvitationLifetimeMs;
  const expiresAt = restoredAt + lifetimeMs;
  if (
    !Number.isSafeInteger(restoredAt) ||
    restoredAt < 0 ||
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 30_000 ||
    lifetimeMs > 24 * 60 * 60_000 ||
    !Number.isSafeInteger(expiresAt)
  ) {
    throw new Error('Continuation fork lifecycle policy is invalid');
  }
  return expiresAt;
};

const validateForkSource = (
  source: ContinuationForkSource
): readonly [PlayerId, PlayerId] => {
  validateAuthoritySnapshot(source.snapshot);
  if (
    source.snapshot.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION ||
    source.snapshot.mode !== 'multiplayer' ||
    !source.snapshot.admission ||
    source.snapshot.admission.playerSeatLimit !== 2 ||
    source.canonicalStateHash !== stableHash(source.snapshot.state)
  ) {
    throw new Error('Continuation checkpoint cannot initialize a fork');
  }
  const playerIds = source.snapshot.state.playerOrder;
  if (
    playerIds.length !== 2 ||
    !playerIds.includes(source.requesterPlayerId) ||
    !source.snapshot.admission.seats[source.requesterPlayerId]
  ) {
    throw new Error('Continuation requester seat is invalid');
  }
  const opponentPlayerId = playerIds.find(
    (playerId) => playerId !== source.requesterPlayerId
  );
  if (!opponentPlayerId || !source.snapshot.admission.seats[opponentPlayerId]) {
    throw new Error('Continuation opponent seat is invalid');
  }
  return [source.requesterPlayerId, opponentPlayerId];
};

/**
 * Produces a detached target-room snapshot without mutating or persisting
 * either side of the fork. The caller must still use the continuation object's
 * one-time reservation protocol and the target room's idempotent initializer.
 */
export const prepareContinuationFork = async (
  source: ContinuationForkSource,
  cryptoSource: ContinuationForkCrypto,
  restoredAt: number,
  policy: ContinuationForkPolicy = DEFAULT_CONTINUATION_FORK_POLICY
): Promise<PreparedContinuationFork> => {
  const opponentInvitationExpiresAt = validateForkPolicy(restoredAt, policy);
  const [requesterPlayerId, opponentPlayerId] = validateForkSource(source);
  const usedRaw = new Set<string>();
  const usedDigests = new Set(authorizationDigests(source.snapshot));
  const requesterSeat = await nextFreshCredential(
    () => cryptoSource.nextSeatCapability(),
    cryptoSource,
    usedRaw,
    usedDigests,
    'requester-seat'
  );
  const opponentSeat = await nextFreshCredential(
    () => cryptoSource.nextSeatCapability(),
    cryptoSource,
    usedRaw,
    usedDigests,
    'opponent-seat'
  );
  const opponentInvitation = await nextFreshCredential(
    () => cryptoSource.nextRoomInvitation(),
    cryptoSource,
    usedRaw,
    usedDigests,
    'opponent-invitation'
  );

  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: source.snapshot.state.playerOrder,
    seatCapabilityDigests: {
      [requesterPlayerId]: requesterSeat.digest,
      [opponentPlayerId]: opponentSeat.digest,
    },
  });
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state: structuredClone(source.snapshot.state),
    soloUndoHistory: {
      baseState: null,
      baseStateHash: null,
      entries: [],
    },
    replayHistory: structuredClone(source.snapshot.replayHistory),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: {
      ...admission,
      invitations: {
        [opponentInvitation.digest]: {
          role: 'player',
          playerId: opponentPlayerId,
          expiresAt: opponentInvitationExpiresAt,
        },
      },
    },
  };
  assertAuthoritySnapshotInvariants(snapshot);
  if (stableHash(snapshot.state) !== source.canonicalStateHash) {
    throw new Error('Continuation fork changed canonical game state');
  }
  return Object.freeze({
    snapshot,
    requesterSeatCapability: requesterSeat.raw,
    opponentInvitation: Object.freeze({
      invitation: opponentInvitation.raw,
      expiresAt: opponentInvitationExpiresAt,
    }),
  });
};
