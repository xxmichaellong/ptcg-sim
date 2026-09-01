import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

import { projectRecipient, type OpaqueIdSource } from './identity-registry.js';
import { assertAuthoritySnapshotInvariants } from './invariants.js';
import { emptySoloUndoHistory } from './solo-undo-history.js';
import { createReplayHistory } from './replay-history.js';
import type {
  AdmissionPersistence,
  AuthoritySession,
  RoomAdmissionState,
  RoomAuthoritySnapshot,
} from './model.js';

export type AdmissionRequest =
  | {
      readonly type: 'ClaimSeat';
      readonly seatCapability: string;
      readonly displayName: string;
    }
  | {
      readonly type: 'JoinSpectator';
      readonly spectatorCapability: string;
    }
  | {
      readonly type: 'Resume';
      readonly resumeCapability: string;
    };

export interface AdmissionCrypto {
  readonly digestCapability: (capability: string) => Promise<string>;
  readonly equalDigest: (left: string, right: string) => boolean;
  readonly nextResumeCapability: () => string;
  readonly nextSessionId: () => string;
}

export interface AdmissionDependencies {
  readonly crypto: AdmissionCrypto;
  readonly opaqueIds: OpaqueIdSource;
  readonly persistence: AdmissionPersistence;
}

export type AdmissionResult =
  | {
      readonly accepted: true;
      readonly committed: boolean;
      readonly snapshot: RoomAuthoritySnapshot;
      readonly session: AuthoritySession;
      readonly resumeCapability: string;
      readonly view: MatchViewState;
    }
  | {
      readonly accepted: false;
      readonly code:
        | 'invalid_request'
        | 'invalid_capability'
        | 'seat_unavailable'
        | 'room_not_ready';
      readonly snapshot: RoomAuthoritySnapshot;
    };

export const createRoomAdmissionState = (input: {
  readonly seatCapabilityDigests: Readonly<Record<string, string>>;
  readonly playerIds: readonly PlayerId[];
  readonly spectatorCapabilityDigest?: string;
}): RoomAdmissionState => ({
  seats: Object.fromEntries(
    input.playerIds.map((playerId) => [
      playerId,
      {
        playerId,
        claimCapabilityDigest: input.seatCapabilityDigests[playerId] ?? '',
        claimedSessionId: null,
      },
    ])
  ),
  spectatorCapabilityDigest: input.spectatorCapabilityDigest ?? null,
});

const validBoundedCapability = (value: string): boolean =>
  value.length >= 32 && value.length <= 512;

const validDisplayName = (value: string): boolean =>
  value.trim().length >= 1 && value.length <= 64;

const unusedSessionId = (
  snapshot: RoomAuthoritySnapshot,
  crypto: AdmissionCrypto
): string => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = crypto.nextSessionId();
    if (id.length >= 16 && id.length <= 128 && !snapshot.sessions[id])
      return id;
  }
  throw new Error('Session ID source failed to produce a unique bounded ID');
};

const rejection = (
  snapshot: RoomAuthoritySnapshot,
  code: Exclude<AdmissionResult, { accepted: true }>['code']
): AdmissionResult => ({ accepted: false, code, snapshot });

const persistSessionResume = async (
  current: RoomAuthoritySnapshot,
  session: AuthoritySession,
  resumeCapability: string,
  dependencies: AdmissionDependencies
): Promise<AdmissionResult> => {
  const projected = projectRecipient(
    current.state,
    session.viewer,
    current.identities,
    dependencies.opaqueIds
  );
  const candidate: RoomAuthoritySnapshot = {
    ...current,
    authorityVersion: current.authorityVersion + 1,
    identities: projected.identities,
  };
  assertAuthoritySnapshotInvariants(candidate);
  await dependencies.persistence.commitAdmission({
    expectedAuthorityVersion: current.authorityVersion,
    snapshot: candidate,
    sessionId: session.id,
    kind: 'session_resumed',
  });
  return {
    accepted: true,
    committed: true,
    snapshot: candidate,
    session,
    resumeCapability,
    view: projected.snapshot,
  };
};

export const admitRoomSession = async (
  current: RoomAuthoritySnapshot,
  request: AdmissionRequest,
  dependencies: AdmissionDependencies
): Promise<AdmissionResult> => {
  assertAuthoritySnapshotInvariants(current);
  if (!current.admission) return rejection(current, 'room_not_ready');

  const suppliedCapability =
    request.type === 'ClaimSeat'
      ? request.seatCapability
      : request.type === 'JoinSpectator'
        ? request.spectatorCapability
        : request.resumeCapability;
  if (!validBoundedCapability(suppliedCapability)) {
    return rejection(current, 'invalid_request');
  }
  const suppliedDigest =
    await dependencies.crypto.digestCapability(suppliedCapability);

  if (request.type === 'Resume') {
    const session = Object.values(current.sessions).find(
      (candidate) =>
        candidate.active &&
        candidate.resumeCapabilityDigest !== undefined &&
        dependencies.crypto.equalDigest(
          candidate.resumeCapabilityDigest,
          suppliedDigest
        )
    );
    return session
      ? persistSessionResume(
          current,
          session,
          request.resumeCapability,
          dependencies
        )
      : rejection(current, 'invalid_capability');
  }

  let viewer: AuthoritySession['viewer'];
  let claimedPlayerId: PlayerId | undefined;
  if (request.type === 'ClaimSeat') {
    if (!validDisplayName(request.displayName)) {
      return rejection(current, 'invalid_request');
    }
    const seat = Object.values(current.admission.seats).find((candidate) =>
      dependencies.crypto.equalDigest(
        candidate.claimCapabilityDigest,
        suppliedDigest
      )
    );
    if (!seat) return rejection(current, 'invalid_capability');
    if (seat.claimedSessionId !== null) {
      const claimedSession = current.sessions[seat.claimedSessionId];
      return claimedSession?.active
        ? persistSessionResume(
            current,
            claimedSession,
            request.seatCapability,
            dependencies
          )
        : rejection(current, 'seat_unavailable');
    }
    claimedPlayerId = seat.playerId;
    viewer = { kind: 'player', playerId: seat.playerId };
  } else {
    const expected = current.admission.spectatorCapabilityDigest;
    if (
      expected === null ||
      !dependencies.crypto.equalDigest(expected, suppliedDigest)
    ) {
      return rejection(current, 'invalid_capability');
    }
    viewer = { kind: 'spectator' };
  }

  const resumeCapability = claimedPlayerId
    ? suppliedCapability
    : dependencies.crypto.nextResumeCapability();
  if (!validBoundedCapability(resumeCapability)) {
    throw new Error('Resume capability source returned an invalid token');
  }
  const sessionId = unusedSessionId(current, dependencies.crypto);
  const session: AuthoritySession = {
    id: sessionId,
    viewer,
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
    resumeCapabilityDigest:
      await dependencies.crypto.digestCapability(resumeCapability),
  };
  const sessions = { ...current.sessions, [session.id]: session };
  const admission: RoomAdmissionState = claimedPlayerId
    ? {
        ...current.admission,
        seats: {
          ...current.admission.seats,
          [claimedPlayerId]: {
            ...current.admission.seats[claimedPlayerId]!,
            claimedSessionId: session.id,
          },
        },
      }
    : current.admission;
  const state =
    request.type === 'ClaimSeat' && claimedPlayerId
      ? {
          ...current.state,
          players: {
            ...current.state.players,
            [claimedPlayerId]: {
              ...current.state.players[claimedPlayerId]!,
              displayName: request.displayName.trim(),
            },
          },
        }
      : current.state;
  let candidate: RoomAuthoritySnapshot = {
    ...current,
    authorityVersion: current.authorityVersion + 1,
    state,
    // A first-time seat claim changes canonical player metadata outside the
    // gameplay revision stream, so older whole-state checkpoints cannot be
    // restored safely across that boundary.
    soloUndoHistory: claimedPlayerId
      ? emptySoloUndoHistory()
      : current.soloUndoHistory,
    // Display names are canonical metadata but are not gameplay events. Rebase
    // so every retained replay frame has the metadata actually shown live.
    replayHistory: claimedPlayerId
      ? createReplayHistory(state)
      : current.replayHistory,
    sessions,
    admission,
  };
  const projected = projectRecipient(
    candidate.state,
    session.viewer,
    candidate.identities,
    dependencies.opaqueIds
  );
  candidate = { ...candidate, identities: projected.identities };
  assertAuthoritySnapshotInvariants(candidate);
  await dependencies.persistence.commitAdmission({
    expectedAuthorityVersion: current.authorityVersion,
    snapshot: candidate,
    sessionId: session.id,
    kind: claimedPlayerId ? 'seat_claimed' : 'spectator_joined',
  });
  return {
    accepted: true,
    committed: true,
    snapshot: candidate,
    session,
    resumeCapability,
    view: projected.snapshot,
  };
};
