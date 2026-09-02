import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

import { projectRecipient, type OpaqueIdSource } from './identity-registry.js';
import { assertAuthoritySnapshotInvariants } from './invariants.js';
import {
  MAX_OUTSTANDING_ADMISSION_TICKETS,
  type AdmissionPersistence,
  type AuthoritySession,
  type RoomAdmissionState,
  type RoomAdmissionTicket,
  type RoomAuthoritySnapshot,
} from './model.js';
import { createReplayHistory } from './replay-history.js';
import { emptySoloUndoHistory } from './solo-undo-history.js';

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

export interface AdmissionTicketCrypto extends AdmissionCrypto {
  readonly nextAdmissionTicket: () => string;
}

export interface AdmissionDependencies {
  readonly crypto: AdmissionCrypto;
  readonly opaqueIds: OpaqueIdSource;
  readonly persistence: AdmissionPersistence;
}

export interface AdmissionTicketDependencies extends Omit<
  AdmissionDependencies,
  'crypto'
> {
  readonly crypto: AdmissionTicketCrypto;
}

export interface AdmissionTicketPolicy {
  readonly lifetimeMs: number;
  readonly maximumOutstandingTickets: number;
}

export const DEFAULT_ADMISSION_TICKET_POLICY: AdmissionTicketPolicy = {
  lifetimeMs: 30_000,
  maximumOutstandingTickets: MAX_OUTSTANDING_ADMISSION_TICKETS,
};

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

export type AdmissionTicketIssueResult =
  | {
      readonly accepted: true;
      readonly committed: true;
      readonly snapshot: RoomAuthoritySnapshot;
      readonly admissionTicket: string;
      readonly expiresAt: number;
    }
  | {
      readonly accepted: false;
      readonly code:
        | 'invalid_request'
        | 'invalid_capability'
        | 'room_not_ready'
        | 'ticket_capacity';
      readonly snapshot: RoomAuthoritySnapshot;
    };

export interface AdmissionTicketIssueRequest {
  readonly capability: string;
  readonly displayName: string;
  readonly requestedRole: 'player' | 'spectator';
}

export interface AdmissionTicketRedemptionRequest {
  readonly admissionTicket: string;
  readonly displayName: string;
  readonly requestedRole: 'player' | 'spectator';
}

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
  tickets: {},
});

const validBoundedCapability = (value: string): boolean =>
  value.length >= 32 && value.length <= 512;

const validDisplayName = (value: string): boolean =>
  value.trim().length >= 1 && value.length <= 64;

const validNow = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const validTicketPolicy = (policy: AdmissionTicketPolicy): boolean =>
  Number.isSafeInteger(policy.lifetimeMs) &&
  policy.lifetimeMs >= 1_000 &&
  policy.lifetimeMs <= 5 * 60_000 &&
  Number.isSafeInteger(policy.maximumOutstandingTickets) &&
  policy.maximumOutstandingTickets >= 1 &&
  policy.maximumOutstandingTickets <= MAX_OUTSTANDING_ADMISSION_TICKETS;

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

const ticketRejection = (
  snapshot: RoomAuthoritySnapshot,
  code: Exclude<AdmissionTicketIssueResult, { accepted: true }>['code']
): AdmissionTicketIssueResult => ({ accepted: false, code, snapshot });

const ticketsWithout = (
  tickets: RoomAdmissionState['tickets'],
  rejectedDigest: string
): RoomAdmissionState['tickets'] =>
  Object.fromEntries(
    Object.entries(tickets).filter(([digest]) => digest !== rejectedDigest)
  );

const liveTickets = (
  tickets: RoomAdmissionState['tickets'],
  now: number
): RoomAdmissionState['tickets'] =>
  Object.fromEntries(
    Object.entries(tickets).filter(([, ticket]) => ticket.expiresAt > now)
  );

const admissionAfterTicket = (
  admission: RoomAdmissionState,
  admissionTicketDigest?: string
): RoomAdmissionState =>
  admissionTicketDigest
    ? {
        ...admission,
        tickets: ticketsWithout(admission.tickets, admissionTicketDigest),
      }
    : admission;

const persistSessionResume = async (
  current: RoomAuthoritySnapshot,
  session: AuthoritySession,
  resumeCapability: string,
  dependencies: AdmissionDependencies,
  admissionTicketDigest?: string
): Promise<AdmissionResult> => {
  const projected = projectRecipient(
    current.state,
    session.viewer,
    current.identities,
    dependencies.opaqueIds
  );
  const resumedSession: AuthoritySession = {
    ...session,
    resumeCapabilityDigest:
      await dependencies.crypto.digestCapability(resumeCapability),
  };
  const candidate: RoomAuthoritySnapshot = {
    ...current,
    authorityVersion: current.authorityVersion + 1,
    identities: projected.identities,
    sessions: {
      ...current.sessions,
      [session.id]: resumedSession,
    },
    ...(current.admission
      ? {
          admission: admissionAfterTicket(
            current.admission,
            admissionTicketDigest
          ),
        }
      : {}),
  };
  assertAuthoritySnapshotInvariants(candidate);
  await dependencies.persistence.commitAdmission({
    expectedAuthorityVersion: current.authorityVersion,
    snapshot: candidate,
    sessionId: session.id,
    kind: 'session_resumed',
    ...(admissionTicketDigest ? { admissionTicketDigest } : {}),
  });
  return {
    accepted: true,
    committed: true,
    snapshot: candidate,
    session: resumedSession,
    resumeCapability,
    view: projected.snapshot,
  };
};

type AuthorizedAdmission =
  | {
      readonly role: 'player';
      readonly playerId: PlayerId;
      readonly displayName: string;
      readonly resumeCapability: string;
    }
  | {
      readonly role: 'spectator';
      readonly resumeCapability: string;
    };

const admitAuthorizedSession = async (
  current: RoomAuthoritySnapshot,
  authorized: AuthorizedAdmission,
  dependencies: AdmissionDependencies,
  admissionTicketDigest?: string
): Promise<AdmissionResult> => {
  if (!current.admission) return rejection(current, 'room_not_ready');
  if (!validBoundedCapability(authorized.resumeCapability)) {
    throw new Error('Resume capability source returned an invalid token');
  }

  const claimedPlayerId =
    authorized.role === 'player' ? authorized.playerId : undefined;
  if (claimedPlayerId) {
    const seat = current.admission.seats[claimedPlayerId];
    if (!seat) return rejection(current, 'invalid_capability');
    if (seat.claimedSessionId !== null) {
      const claimedSession = current.sessions[seat.claimedSessionId];
      return claimedSession?.active
        ? persistSessionResume(
            current,
            claimedSession,
            authorized.resumeCapability,
            dependencies,
            admissionTicketDigest
          )
        : rejection(current, 'seat_unavailable');
    }
  }

  const viewer: AuthoritySession['viewer'] = claimedPlayerId
    ? { kind: 'player', playerId: claimedPlayerId }
    : { kind: 'spectator' };
  const sessionId = unusedSessionId(current, dependencies.crypto);
  const session: AuthoritySession = {
    id: sessionId,
    viewer,
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
    resumeCapabilityDigest: await dependencies.crypto.digestCapability(
      authorized.resumeCapability
    ),
  };
  const sessions = { ...current.sessions, [session.id]: session };
  const consumedAdmission = admissionAfterTicket(
    current.admission,
    admissionTicketDigest
  );
  const admission: RoomAdmissionState = claimedPlayerId
    ? {
        ...consumedAdmission,
        seats: {
          ...consumedAdmission.seats,
          [claimedPlayerId]: {
            ...consumedAdmission.seats[claimedPlayerId]!,
            claimedSessionId: session.id,
          },
        },
      }
    : consumedAdmission;
  const state =
    authorized.role === 'player'
      ? {
          ...current.state,
          players: {
            ...current.state.players,
            [authorized.playerId]: {
              ...current.state.players[authorized.playerId]!,
              displayName: authorized.displayName,
            },
          },
        }
      : current.state;
  let candidate: RoomAuthoritySnapshot = {
    ...current,
    authorityVersion: current.authorityVersion + 1,
    state,
    soloUndoHistory: claimedPlayerId
      ? emptySoloUndoHistory()
      : current.soloUndoHistory,
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
    ...(admissionTicketDigest ? { admissionTicketDigest } : {}),
  });
  return {
    accepted: true,
    committed: true,
    snapshot: candidate,
    session,
    resumeCapability: authorized.resumeCapability,
    view: projected.snapshot,
  };
};

export const issueRoomAdmissionTicket = async (
  current: RoomAuthoritySnapshot,
  request: AdmissionTicketIssueRequest,
  now: number,
  dependencies: AdmissionTicketDependencies,
  policy: AdmissionTicketPolicy = DEFAULT_ADMISSION_TICKET_POLICY
): Promise<AdmissionTicketIssueResult> => {
  assertAuthoritySnapshotInvariants(current);
  if (!current.admission) return ticketRejection(current, 'room_not_ready');
  if (
    !validNow(now) ||
    !validTicketPolicy(policy) ||
    !validBoundedCapability(request.capability) ||
    !validDisplayName(request.displayName)
  ) {
    return ticketRejection(current, 'invalid_request');
  }

  const suppliedDigest = await dependencies.crypto.digestCapability(
    request.capability
  );
  let ticket: RoomAdmissionTicket;
  if (request.requestedRole === 'player') {
    const seat = Object.values(current.admission.seats).find((candidate) =>
      dependencies.crypto.equalDigest(
        candidate.claimCapabilityDigest,
        suppliedDigest
      )
    );
    if (!seat) return ticketRejection(current, 'invalid_capability');
    ticket = {
      role: 'player',
      playerId: seat.playerId,
      displayName: request.displayName.trim(),
      expiresAt: now + policy.lifetimeMs,
    };
  } else {
    const expected = current.admission.spectatorCapabilityDigest;
    if (
      expected === null ||
      !dependencies.crypto.equalDigest(expected, suppliedDigest)
    ) {
      return ticketRejection(current, 'invalid_capability');
    }
    ticket = {
      role: 'spectator',
      displayName: request.displayName.trim(),
      expiresAt: now + policy.lifetimeMs,
    };
  }
  if (!Number.isSafeInteger(ticket.expiresAt)) {
    return ticketRejection(current, 'invalid_request');
  }

  const retainedTickets = liveTickets(current.admission.tickets, now);
  if (Object.keys(retainedTickets).length >= policy.maximumOutstandingTickets) {
    return ticketRejection(current, 'ticket_capacity');
  }

  let admissionTicket: string | undefined;
  let ticketDigest: string | undefined;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = dependencies.crypto.nextAdmissionTicket();
    if (!validBoundedCapability(candidate)) continue;
    const digest = await dependencies.crypto.digestCapability(candidate);
    if (!retainedTickets[digest]) {
      admissionTicket = candidate;
      ticketDigest = digest;
      break;
    }
  }
  if (!admissionTicket || !ticketDigest) {
    throw new Error('Admission ticket source failed to produce a unique token');
  }

  const candidate: RoomAuthoritySnapshot = {
    ...current,
    authorityVersion: current.authorityVersion + 1,
    admission: {
      ...current.admission,
      tickets: { ...retainedTickets, [ticketDigest]: ticket },
    },
  };
  assertAuthoritySnapshotInvariants(candidate);
  await dependencies.persistence.commitAdmission({
    expectedAuthorityVersion: current.authorityVersion,
    snapshot: candidate,
    kind: 'ticket_issued',
    ticketDigest,
  });
  return {
    accepted: true,
    committed: true,
    snapshot: candidate,
    admissionTicket,
    expiresAt: ticket.expiresAt,
  };
};

export const redeemRoomAdmissionTicket = async (
  current: RoomAuthoritySnapshot,
  request: AdmissionTicketRedemptionRequest,
  now: number,
  dependencies: AdmissionDependencies
): Promise<AdmissionResult> => {
  assertAuthoritySnapshotInvariants(current);
  if (!current.admission) return rejection(current, 'room_not_ready');
  if (
    !validNow(now) ||
    !validBoundedCapability(request.admissionTicket) ||
    !validDisplayName(request.displayName)
  ) {
    return rejection(current, 'invalid_request');
  }
  const ticketDigest = await dependencies.crypto.digestCapability(
    request.admissionTicket
  );
  const ticket = current.admission.tickets[ticketDigest];
  if (
    !ticket ||
    ticket.expiresAt <= now ||
    ticket.role !== request.requestedRole ||
    ticket.displayName !== request.displayName.trim()
  ) {
    return rejection(current, 'invalid_capability');
  }

  const resumeCapability = dependencies.crypto.nextResumeCapability();
  return admitAuthorizedSession(
    current,
    ticket.role === 'player'
      ? {
          role: 'player',
          playerId: ticket.playerId,
          displayName: ticket.displayName,
          resumeCapability,
        }
      : { role: 'spectator', resumeCapability },
    dependencies,
    ticketDigest
  );
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
    return seat
      ? admitAuthorizedSession(
          current,
          {
            role: 'player',
            playerId: seat.playerId,
            displayName: request.displayName.trim(),
            resumeCapability: request.seatCapability,
          },
          dependencies
        )
      : rejection(current, 'invalid_capability');
  }

  const expected = current.admission.spectatorCapabilityDigest;
  if (
    expected === null ||
    !dependencies.crypto.equalDigest(expected, suppliedDigest)
  ) {
    return rejection(current, 'invalid_capability');
  }
  return admitAuthorizedSession(
    current,
    {
      role: 'spectator',
      resumeCapability: dependencies.crypto.nextResumeCapability(),
    },
    dependencies
  );
};
