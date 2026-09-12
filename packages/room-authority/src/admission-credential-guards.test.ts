import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  createRoomAdmissionState,
  issueRoomAdmissionTicket,
  issueRoomInvitation,
  type RoomInvitationCrypto,
} from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import { createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type PersistedAdmissionTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';

const p1 = asPlayerId('guard-player-one');
const p2 = asPlayerId('guard-player-two');
const seatOneToken = 'seat-one-capability-0000000000000001';
const seatTwoToken = 'seat-two-capability-0000000000000002';
const spectatorToken = 'spectator-capability-000000000000003';
const foreignToken = 'not-a-room-capability-00000000000004';

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  // The snapshot invariant requires a realistic digest length.
  return `digest-${value.toString(16).padStart(8, '0')}`.padEnd(64, '0');
};

const createSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('guard-match'), [
    { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerSeatLimit: 2,
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: digest(seatOneToken),
        [p2]: digest(seatTwoToken),
      },
      spectatorCapabilityDigest: digest(spectatorToken),
    }),
  };
};

/**
 * A snapshot where player two's seat is occupied. The claim and its session
 * must agree: a seat pointing at a session that does not exist is itself an
 * invariant violation.
 */
const withClaimedSeatTwo = (): RoomAuthoritySnapshot => {
  const current = createSnapshot();
  const admission = current.admission!;
  const claimSessionId = 'session-existing-000000000000000000000001';
  return {
    ...current,
    sessions: {
      ...current.sessions,
      [claimSessionId]: {
        id: claimSessionId,
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
    admission: {
      ...admission,
      seats: {
        ...admission.seats,
        [p2]: { ...admission.seats[p2]!, claimedSessionId: claimSessionId },
      },
    },
  };
};

const createCrypto = (): RoomInvitationCrypto => {
  let session = 0;
  let resume = 0;
  let ticket = 0;
  let invitation = 0;
  return {
    digestCapability: vi.fn(async (capability) => digest(capability)),
    equalDigest: (left, right) => left === right,
    nextSessionId: () => `session-${String(++session).padStart(24, '0')}`,
    nextResumeCapability: () =>
      `resume-capability-${String(++resume).padStart(24, '0')}`,
    nextAdmissionTicket: () =>
      `socket-admission-${String(++ticket).padStart(24, '0')}`,
    nextRoomInvitation: () =>
      `room-invitation-${String(++invitation).padStart(24, '0')}`,
  };
};

const dependencies = () => {
  const transactions: PersistedAdmissionTransaction[] = [];
  let opaque = 0;
  return {
    transactions,
    deps: {
      crypto: createCrypto(),
      persistence: {
        commitAdmission: async (transaction: PersistedAdmissionTransaction) => {
          transactions.push(transaction);
        },
      },
      opaqueIds: {
        nextOpaqueId: (kind: 'card' | 'definition') =>
          `opaque-${kind}-${String(++opaque).padStart(12, '0')}`,
      },
    },
  };
};

/**
 * Credential and occupancy guards on the invitation and ticket paths. Each was
 * uncovered: neutralising it left the whole authority suite green at 300 tests,
 * so a refactor could have removed it silently.
 *
 * These are the room's front door. A caller reaches them with nothing but a
 * bearer string, so the checks are the only thing separating a stranger from a
 * seat or a spectator grant.
 */
describe('admission credential guards', () => {
  it('refuses a spectator invitation for an unrecognised capability', async () => {
    const { deps } = dependencies();
    const issued = await issueRoomInvitation(
      createSnapshot(),
      { capability: foreignToken, requestedRole: 'spectator' },
      10_000,
      deps
    );
    expect(issued.accepted).toBe(false);
    if (issued.accepted) return;
    expect(issued.code).toBe('invalid_capability');
  });

  it('still mints a spectator invitation for the real capability', async () => {
    const { deps } = dependencies();
    const issued = await issueRoomInvitation(
      createSnapshot(),
      { capability: spectatorToken, requestedRole: 'spectator' },
      10_000,
      deps
    );
    expect(issued.accepted).toBe(true);
  });

  it('refuses a player invitation once the seat is claimed', async () => {
    const { deps } = dependencies();
    const issued = await issueRoomInvitation(
      withClaimedSeatTwo(),
      { capability: seatTwoToken, requestedRole: 'player' },
      10_000,
      deps
    );
    expect(issued.accepted).toBe(false);
    if (issued.accepted) return;
    expect(issued.code).toBe('seat_unavailable');
  });

  it('refuses a ticket for an invitation whose seat was claimed meanwhile', async () => {
    const { deps } = dependencies();
    // Mint the invitation while the seat is free, then let someone else take
    // it before the invitation is exchanged for a socket ticket.
    const issued = await issueRoomInvitation(
      createSnapshot(),
      { capability: seatTwoToken, requestedRole: 'player' },
      10_000,
      deps
    );
    expect(issued.accepted).toBe(true);
    if (!issued.accepted) return;
    const claimed = withClaimedSeatTwo();
    const raced: RoomAuthoritySnapshot = {
      ...claimed,
      admission: {
        ...claimed.admission!,
        invitations: issued.snapshot.admission!.invitations,
      },
    };
    const ticket = await issueRoomAdmissionTicket(
      raced,
      {
        capability: issued.invitation,
        displayName: 'Late Guest',
        requestedRole: 'player',
      },
      20_000,
      deps
    );
    expect(ticket.accepted).toBe(false);
    if (ticket.accepted) return;
    expect(ticket.code).toBe('invalid_capability');
  });

  it('accepts that same invitation while the seat is still free', async () => {
    const { deps } = dependencies();
    const issued = await issueRoomInvitation(
      createSnapshot(),
      { capability: seatTwoToken, requestedRole: 'player' },
      10_000,
      deps
    );
    expect(issued.accepted).toBe(true);
    if (!issued.accepted) return;
    const ticket = await issueRoomAdmissionTicket(
      issued.snapshot,
      {
        capability: issued.invitation,
        displayName: 'Guest',
        requestedRole: 'player',
      },
      20_000,
      deps
    );
    expect(ticket.accepted).toBe(true);
  });
});
