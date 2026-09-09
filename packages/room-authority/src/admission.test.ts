import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
} from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  admitRoomSession,
  createRoomAdmissionState,
  issueRoomAdmissionTicket,
  issueRoomInvitation,
  leaveRoomSession,
  redeemRoomAdmissionTicket,
  type RoomInvitationCrypto,
} from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import { appendReplayHistory, createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type PersistedAdmissionTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';
import { collectAuthoritySnapshotProblems } from './invariants.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
const seatOneToken = 'seat-one-capability-0000000000000001';
const seatTwoToken = 'seat-two-capability-0000000000000002';
const spectatorToken = 'spectator-capability-000000000000003';

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, '0').repeat(8);
};

const createSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('admission-match'), [
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

const createSingleOccupancySnapshot = (): RoomAuthoritySnapshot => {
  const current = createSnapshot();
  return {
    ...current,
    mode: 'solo',
    admission: {
      ...current.admission!,
      playerSeatLimit: 1,
    },
  } as unknown as RoomAuthoritySnapshot;
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

const persistence = () => {
  const transactions: PersistedAdmissionTransaction[] = [];
  return {
    transactions,
    commitAdmission: async (transaction: PersistedAdmissionTransaction) => {
      transactions.push(transaction);
    },
  };
};

const dependencies = (
  crypto: RoomInvitationCrypto,
  storage: ReturnType<typeof persistence>
) => {
  let opaque = 0;
  return {
    crypto,
    persistence: storage,
    opaqueIds: {
      nextOpaqueId: (kind: 'card' | 'definition') =>
        `opaque-${kind}-${String(++opaque).padStart(12, '0')}`,
    },
  };
};

describe('room capability admission', () => {
  it('mints a digest-only player invitation and consumes it only with the socket ticket', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const issued = await issueRoomInvitation(
      createSnapshot(),
      { capability: seatTwoToken, requestedRole: 'player' },
      10_000,
      dependencies(crypto, storage)
    );
    expect(issued.accepted).toBe(true);
    if (!issued.accepted) return;
    const invitationDigest = digest(issued.invitation);
    expect(issued.expiresAt).toBe(910_000);
    expect(issued.snapshot.admission?.invitations).toEqual({
      [invitationDigest]: {
        role: 'player',
        playerId: p2,
        expiresAt: 910_000,
      },
    });
    expect(JSON.stringify(issued.snapshot)).not.toContain(issued.invitation);
    expect(JSON.stringify(issued.snapshot)).not.toContain(seatTwoToken);
    expect(storage.transactions[0]).toMatchObject({
      kind: 'invitation_issued',
      invitationDigest,
    });

    const exchanged = await issueRoomAdmissionTicket(
      issued.snapshot,
      {
        capability: issued.invitation,
        displayName: 'Red',
        requestedRole: 'player',
      },
      10_001,
      dependencies(crypto, storage)
    );
    expect(exchanged.accepted).toBe(true);
    if (!exchanged.accepted) return;
    const ticketDigest = digest(exchanged.admissionTicket);
    expect(exchanged.snapshot.admission?.invitations).toHaveProperty(
      invitationDigest
    );
    expect(exchanged.snapshot.admission?.tickets[ticketDigest]).toMatchObject({
      role: 'player',
      playerId: p2,
      displayName: 'Red',
      sourceInvitationDigest: invitationDigest,
    });

    const admitted = await redeemRoomAdmissionTicket(
      exchanged.snapshot,
      {
        admissionTicket: exchanged.admissionTicket,
        resumeCapability: exchanged.resumeCapability,
        displayName: 'Red',
        requestedRole: 'player',
      },
      10_002,
      dependencies(crypto, storage)
    );
    expect(admitted.accepted).toBe(true);
    if (!admitted.accepted) return;
    expect(admitted.session.viewer).toEqual({ kind: 'player', playerId: p2 });
    expect(admitted.session.displayName).toBe('Red');
    expect(admitted.snapshot.admission?.invitations).toEqual({});
    expect(admitted.snapshot.admission?.tickets).toEqual({});
    expect(storage.transactions[2]).toMatchObject({
      kind: 'seat_claimed',
      admissionTicketDigest: ticketDigest,
      invitationDigest,
    });

    const replayed = await issueRoomAdmissionTicket(
      admitted.snapshot,
      {
        capability: issued.invitation,
        displayName: 'Attacker',
        requestedRole: 'player',
      },
      10_003,
      dependencies(crypto, storage)
    );
    expect(replayed).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
  });

  it('rotates a retrying invitation exchange so a lost ticket response is recoverable', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const invitation = await issueRoomInvitation(
      createSnapshot(),
      { capability: spectatorToken, requestedRole: 'spectator' },
      20_000,
      dependencies(crypto, storage)
    );
    if (!invitation.accepted) throw new Error(invitation.code);
    const first = await issueRoomAdmissionTicket(
      invitation.snapshot,
      {
        capability: invitation.invitation,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      20_001,
      dependencies(crypto, storage)
    );
    if (!first.accepted) throw new Error(first.code);
    const retryTicketSource = vi
      .fn()
      .mockReturnValueOnce(first.admissionTicket)
      .mockReturnValueOnce('socket-admission-retry-000000000001');
    const second = await issueRoomAdmissionTicket(
      first.snapshot,
      {
        capability: invitation.invitation,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      20_002,
      dependencies(
        { ...crypto, nextAdmissionTicket: retryTicketSource },
        storage
      )
    );
    if (!second.accepted) throw new Error(second.code);

    expect(second.admissionTicket).not.toBe(first.admissionTicket);
    expect(retryTicketSource).toHaveBeenCalledTimes(2);
    expect(Object.keys(second.snapshot.admission?.tickets ?? {})).toEqual([
      digest(second.admissionTicket),
    ]);
    const stale = await redeemRoomAdmissionTicket(
      second.snapshot,
      {
        admissionTicket: first.admissionTicket,
        resumeCapability: first.resumeCapability,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      20_003,
      dependencies(crypto, storage)
    );
    expect(stale).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
    const latest = await redeemRoomAdmissionTicket(
      second.snapshot,
      {
        admissionTicket: second.admissionTicket,
        resumeCapability: second.resumeCapability,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      20_003,
      dependencies(crypto, storage)
    );
    expect(latest.accepted).toBe(true);
    if (!latest.accepted) return;
    expect(latest.session.displayName).toBe('Viewer');
  });

  it('rotates player invitations, permits distinct spectator invitations, and enforces expiry', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const policy = {
      lifetimeMs: 30_000,
      maximumOutstandingInvitations: 2,
    };
    const firstPlayer = await issueRoomInvitation(
      createSnapshot(),
      { capability: seatTwoToken, requestedRole: 'player' },
      1_000,
      dependencies(crypto, storage),
      policy
    );
    if (!firstPlayer.accepted) throw new Error(firstPlayer.code);
    const firstPlayerTicket = await issueRoomAdmissionTicket(
      firstPlayer.snapshot,
      {
        capability: firstPlayer.invitation,
        displayName: 'Red',
        requestedRole: 'player',
      },
      1_001,
      dependencies(crypto, storage)
    );
    if (!firstPlayerTicket.accepted) throw new Error(firstPlayerTicket.code);
    const replacementInvitationSource = vi
      .fn()
      .mockReturnValueOnce(firstPlayer.invitation)
      .mockReturnValueOnce('room-invitation-replacement-00000001');
    const secondPlayer = await issueRoomInvitation(
      firstPlayerTicket.snapshot,
      { capability: seatTwoToken, requestedRole: 'player' },
      1_002,
      dependencies(
        { ...crypto, nextRoomInvitation: replacementInvitationSource },
        storage
      ),
      policy
    );
    if (!secondPlayer.accepted) throw new Error(secondPlayer.code);
    expect(replacementInvitationSource).toHaveBeenCalledTimes(2);
    expect(secondPlayer.snapshot.admission?.invitations).not.toHaveProperty(
      digest(firstPlayer.invitation)
    );
    expect(secondPlayer.snapshot.admission?.tickets).toEqual({});
    const revoked = await issueRoomAdmissionTicket(
      secondPlayer.snapshot,
      {
        capability: firstPlayer.invitation,
        displayName: 'Red',
        requestedRole: 'player',
      },
      1_003,
      dependencies(crypto, storage)
    );
    expect(revoked).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });

    const spectator = await issueRoomInvitation(
      secondPlayer.snapshot,
      { capability: spectatorToken, requestedRole: 'spectator' },
      1_004,
      dependencies(crypto, storage),
      policy
    );
    if (!spectator.accepted) throw new Error(spectator.code);
    const full = await issueRoomInvitation(
      spectator.snapshot,
      { capability: spectatorToken, requestedRole: 'spectator' },
      1_005,
      dependencies(crypto, storage),
      policy
    );
    expect(full).toMatchObject({
      accepted: false,
      code: 'invitation_capacity',
    });

    const expired = await issueRoomAdmissionTicket(
      spectator.snapshot,
      {
        capability: spectator.invitation,
        displayName: 'Late viewer',
        requestedRole: 'spectator',
      },
      31_004,
      dependencies(crypto, storage)
    );
    expect(expired).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
  });

  it('never mints an invitation or ticket that collides with a resume capability', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const ticket = await issueRoomAdmissionTicket(
      createSnapshot(),
      {
        capability: seatOneToken,
        displayName: 'Blue',
        requestedRole: 'player',
      },
      1_000,
      dependencies(crypto, storage)
    );
    if (!ticket.accepted) throw new Error(ticket.code);
    const claimed = await redeemRoomAdmissionTicket(
      ticket.snapshot,
      {
        admissionTicket: ticket.admissionTicket,
        resumeCapability: ticket.resumeCapability,
        displayName: 'Blue',
        requestedRole: 'player',
      },
      1_001,
      dependencies(crypto, storage)
    );
    if (!claimed.accepted) throw new Error(claimed.code);

    const invitationSource = vi
      .fn()
      .mockReturnValueOnce(claimed.resumeCapability)
      .mockReturnValueOnce('room-invitation-after-resume-0000001');
    const invitation = await issueRoomInvitation(
      claimed.snapshot,
      { capability: spectatorToken, requestedRole: 'spectator' },
      1_002,
      dependencies({ ...crypto, nextRoomInvitation: invitationSource }, storage)
    );
    if (!invitation.accepted) throw new Error(invitation.code);
    expect(invitationSource).toHaveBeenCalledTimes(2);

    const ticketSource = vi
      .fn()
      .mockReturnValueOnce(claimed.resumeCapability)
      .mockReturnValueOnce('socket-admission-after-resume-00000001');
    const resumeSource = vi
      .fn()
      .mockReturnValueOnce(claimed.resumeCapability)
      .mockReturnValueOnce('resume-capability-after-resume-0000001');
    const exchanged = await issueRoomAdmissionTicket(
      invitation.snapshot,
      {
        capability: invitation.invitation,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      1_003,
      dependencies(
        {
          ...crypto,
          nextAdmissionTicket: ticketSource,
          nextResumeCapability: resumeSource,
        },
        storage
      )
    );
    expect(exchanged.accepted).toBe(true);
    if (!exchanged.accepted) return;
    expect(ticketSource).toHaveBeenCalledTimes(2);
    expect(resumeSource).toHaveBeenCalledTimes(2);
    expect(exchanged.resumeCapability).toBe(
      'resume-capability-after-resume-0000001'
    );
  });

  it('issues a digest-only ticket bound to a fresh resume capability and consumes both atomically', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const issued = await issueRoomAdmissionTicket(
      createSnapshot(),
      {
        capability: seatOneToken,
        displayName: '  Blue  ',
        requestedRole: 'player',
      },
      10_000,
      dependencies(crypto, storage)
    );
    expect(issued.accepted).toBe(true);
    if (!issued.accepted) return;

    expect(issued.expiresAt).toBe(40_000);
    expect(issued.snapshot.authorityVersion).toBe(1);
    expect(Object.keys(issued.snapshot.admission?.tickets ?? {})).toEqual([
      digest(issued.admissionTicket),
    ]);
    expect(
      issued.snapshot.admission?.tickets[digest(issued.admissionTicket)]
        ?.resumeCapabilityDigest
    ).toBe(digest(issued.resumeCapability));
    expect(JSON.stringify(issued.snapshot)).not.toContain(
      issued.admissionTicket
    );
    expect(JSON.stringify(issued.snapshot)).not.toContain(
      issued.resumeCapability
    );
    expect(JSON.stringify(issued.snapshot)).not.toContain(seatOneToken);
    expect(storage.transactions[0]).toMatchObject({
      kind: 'ticket_issued',
      ticketDigest: digest(issued.admissionTicket),
    });

    const redeemed = await redeemRoomAdmissionTicket(
      issued.snapshot,
      {
        admissionTicket: issued.admissionTicket,
        resumeCapability: issued.resumeCapability,
        displayName: 'Blue',
        requestedRole: 'player',
      },
      10_001,
      dependencies(crypto, storage)
    );
    expect(redeemed.accepted).toBe(true);
    if (!redeemed.accepted) return;
    expect(redeemed.resumeCapability).toBe(issued.resumeCapability);
    expect(redeemed.session.displayName).toBe('Blue');
    expect(redeemed.session.resumeCapabilityDigest).toBe(
      digest(redeemed.resumeCapability)
    );
    expect(redeemed.snapshot.admission?.tickets).toEqual({});
    expect(storage.transactions[1]).toMatchObject({
      kind: 'seat_claimed',
      admissionTicketDigest: digest(issued.admissionTicket),
    });

    const replayed = await redeemRoomAdmissionTicket(
      redeemed.snapshot,
      {
        admissionTicket: issued.admissionTicket,
        resumeCapability: issued.resumeCapability,
        displayName: 'Blue',
        requestedRole: 'player',
      },
      10_002,
      dependencies(crypto, storage)
    );
    expect(replayed).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
    expect(storage.transactions).toHaveLength(2);
  });

  it('binds tickets to role and normalized display name and rejects expiry', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const issued = await issueRoomAdmissionTicket(
      createSnapshot(),
      {
        capability: spectatorToken,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      50_000,
      dependencies(crypto, storage),
      { lifetimeMs: 1_000, maximumOutstandingTickets: 2 }
    );
    if (!issued.accepted) throw new Error(issued.code);

    for (const request of [
      { displayName: 'Other', requestedRole: 'spectator' as const },
      { displayName: 'Viewer', requestedRole: 'player' as const },
    ]) {
      const result = await redeemRoomAdmissionTicket(
        issued.snapshot,
        {
          admissionTicket: issued.admissionTicket,
          resumeCapability: issued.resumeCapability,
          ...request,
        },
        50_500,
        dependencies(crypto, storage)
      );
      expect(result).toMatchObject({
        accepted: false,
        code: 'invalid_capability',
      });
    }
    for (const resumeCapability of [
      undefined,
      'wrong-resume-capability-0000000000000001',
    ]) {
      const result = await redeemRoomAdmissionTicket(
        issued.snapshot,
        {
          admissionTicket: issued.admissionTicket,
          ...(resumeCapability ? { resumeCapability } : {}),
          displayName: 'Viewer',
          requestedRole: 'spectator',
        },
        50_500,
        dependencies(crypto, storage)
      );
      expect(result).toMatchObject({
        accepted: false,
        code: 'invalid_capability',
      });
    }
    const expired = await redeemRoomAdmissionTicket(
      issued.snapshot,
      {
        admissionTicket: issued.admissionTicket,
        resumeCapability: issued.resumeCapability,
        displayName: 'Viewer',
        requestedRole: 'spectator',
      },
      51_000,
      dependencies(crypto, storage)
    );
    expect(expired).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
    expect(storage.transactions).toHaveLength(1);
  });

  it('redeems a short-lived pre-checkpoint v7 ticket without a bound resume digest', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const admissionTicket = 'legacy-socket-admission-capability-0000000000001';
    const current = createSnapshot();
    const legacy: RoomAuthoritySnapshot = {
      ...current,
      admission: {
        ...current.admission!,
        tickets: {
          [digest(admissionTicket)]: {
            role: 'player',
            playerId: p1,
            displayName: 'Legacy Blue',
            expiresAt: 80_000,
          },
        },
      },
    };

    const result = await redeemRoomAdmissionTicket(
      legacy,
      {
        admissionTicket,
        displayName: 'Legacy Blue',
        requestedRole: 'player',
      },
      79_999,
      dependencies(crypto, storage)
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(result.resumeCapability).toMatch(/^resume-capability-/u);
    expect(result.session.resumeCapabilityDigest).toBe(
      digest(result.resumeCapability)
    );
  });

  it('caps live tickets and prunes expired records during the next issue', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const policy = { lifetimeMs: 1_000, maximumOutstandingTickets: 2 };
    let snapshot = createSnapshot();
    for (const displayName of ['First', 'Second']) {
      const issued = await issueRoomAdmissionTicket(
        snapshot,
        {
          capability: spectatorToken,
          displayName,
          requestedRole: 'spectator',
        },
        1_000,
        dependencies(crypto, storage),
        policy
      );
      if (!issued.accepted) throw new Error(issued.code);
      snapshot = issued.snapshot;
    }
    const full = await issueRoomAdmissionTicket(
      snapshot,
      {
        capability: spectatorToken,
        displayName: 'Third',
        requestedRole: 'spectator',
      },
      1_500,
      dependencies(crypto, storage),
      policy
    );
    expect(full).toMatchObject({ accepted: false, code: 'ticket_capacity' });

    const afterExpiry = await issueRoomAdmissionTicket(
      snapshot,
      {
        capability: spectatorToken,
        displayName: 'Third',
        requestedRole: 'spectator',
      },
      2_000,
      dependencies(crypto, storage),
      policy
    );
    expect(afterExpiry.accepted).toBe(true);
    if (!afterExpiry.accepted) return;
    expect(
      Object.values(afterExpiry.snapshot.admission?.tickets ?? {})
    ).toEqual([
      {
        role: 'spectator',
        displayName: 'Third',
        expiresAt: 3_000,
        resumeCapabilityDigest: digest(afterExpiry.resumeCapability),
      },
    ]);
  });

  it('claims a seat once and persists only the resume digest', async () => {
    const storage = persistence();
    const result = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: '  Blue Player  ',
      },
      dependencies(createCrypto(), storage)
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.committed).toBe(true);
    expect(result.snapshot.authorityVersion).toBe(1);
    expect(result.snapshot.state.revision).toBe(0);
    expect(result.snapshot.state.players[p1]?.displayName).toBe('Blue Player');
    expect(result.session.viewer).toEqual({ kind: 'player', playerId: p1 });
    expect(result.session.displayName).toBe('Blue Player');
    expect(result.session.resumeCapabilityDigest).toBe(
      digest(result.resumeCapability)
    );
    expect(JSON.stringify(result.snapshot)).not.toContain(
      result.resumeCapability
    );
    expect(storage.transactions[0]).toMatchObject({
      expectedAuthorityVersion: 0,
      kind: 'seat_claimed',
    });

    const reused = await admitRoomSession(
      result.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Attacker',
      },
      dependencies(createCrypto(), storage)
    );
    expect(reused).toMatchObject({
      accepted: true,
      committed: true,
      session: { id: result.session.id },
      resumeCapability: seatOneToken,
    });
    expect(storage.transactions).toHaveLength(2);
    expect(storage.transactions[1]?.kind).toBe('session_resumed');
  });

  it('rebases replay when a first seat claim changes unversioned metadata', async () => {
    const initial = createSnapshot();
    const batch = {
      revision: 1,
      events: [
        {
          type: 'CoinFlipped' as const,
          playerId: p1,
          result: 'heads' as const,
        },
      ],
    };
    const state = applyEventBatch(initial.state, batch);
    const current: RoomAuthoritySnapshot = {
      ...initial,
      state,
      replayHistory: appendReplayHistory(
        initial.replayHistory,
        batch,
        state,
        128
      ),
    };
    const storage = persistence();
    const result = await admitRoomSession(
      current,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Renamed Blue',
      },
      dependencies(createCrypto(), storage)
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.snapshot.replayHistory).toMatchObject({
      baseState: {
        revision: 1,
        players: { [p1]: { displayName: 'Renamed Blue' } },
      },
      entries: [],
    });
  });

  it('resumes the same command session without a durable mutation', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const claimed = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Blue',
      },
      dependencies(crypto, storage)
    );
    if (!claimed.accepted) throw new Error(claimed.code);

    const resumed = await admitRoomSession(
      claimed.snapshot,
      { type: 'Resume', resumeCapability: claimed.resumeCapability },
      dependencies(crypto, storage)
    );
    expect(resumed).toMatchObject({
      accepted: true,
      committed: true,
      session: { id: claimed.session.id, nextClientSequence: 1 },
    });
    expect(storage.transactions).toHaveLength(2);
    expect(storage.transactions[1]?.kind).toBe('session_resumed');
  });

  it('durably revokes a leaving player session and releases its seat', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const claimed = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'First Blue',
      },
      dependencies(crypto, storage)
    );
    if (!claimed.accepted) throw new Error(claimed.code);

    const left = await leaveRoomSession(
      claimed.snapshot,
      claimed.session.id,
      storage
    );
    expect(left).toMatchObject({
      accepted: true,
      committed: true,
      snapshot: {
        authorityVersion: 2,
        sessions: {
          [claimed.session.id]: {
            id: claimed.session.id,
            active: false,
          },
        },
        admission: {
          seats: { [p1]: { claimedSessionId: null } },
        },
      },
    });
    if (!left.accepted) return;
    expect(left.session).not.toHaveProperty('resumeCapabilityDigest');
    expect(left.snapshot.state).toBe(claimed.snapshot.state);
    expect(left.snapshot.replayHistory).toBe(claimed.snapshot.replayHistory);
    expect(left.snapshot.soloUndoHistory).toBe(
      claimed.snapshot.soloUndoHistory
    );
    expect(storage.transactions.at(-1)).toMatchObject({
      kind: 'session_left',
      sessionId: claimed.session.id,
    });

    await expect(
      admitRoomSession(
        left.snapshot,
        { type: 'Resume', resumeCapability: claimed.resumeCapability },
        dependencies(crypto, storage)
      )
    ).resolves.toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });

    const replacement = await admitRoomSession(
      left.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Second Blue',
      },
      dependencies(crypto, storage)
    );
    expect(replacement).toMatchObject({
      accepted: true,
      session: { active: true, displayName: 'Second Blue' },
    });
    if (!replacement.accepted) return;
    expect(replacement.session.id).not.toBe(claimed.session.id);
    expect(replacement.snapshot.sessions[claimed.session.id]).toMatchObject({
      active: false,
      displayName: 'First Blue',
    });
    expect(collectAuthoritySnapshotProblems(replacement.snapshot)).toEqual([]);
  });

  it('retires a spectator without changing any player seat', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const joined = await admitRoomSession(
      createSnapshot(),
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    if (!joined.accepted) throw new Error(joined.code);

    const left = await leaveRoomSession(
      joined.snapshot,
      joined.session.id,
      storage
    );
    expect(left).toMatchObject({
      accepted: true,
      session: { active: false },
    });
    if (!left.accepted) return;
    expect(left.snapshot.admission?.seats).toEqual(
      joined.snapshot.admission?.seats
    );
    expect(left.session).not.toHaveProperty('resumeCapabilityDigest');
    await expect(
      leaveRoomSession(left.snapshot, joined.session.id, storage)
    ).resolves.toMatchObject({
      accepted: false,
      code: 'invalid_session',
      snapshot: left.snapshot,
    });
  });

  it('recovers a seat claim committed before its welcome reply was lost', async () => {
    const crypto = createCrypto();
    let durable = createSnapshot();
    await expect(
      admitRoomSession(
        durable,
        {
          type: 'ClaimSeat',
          seatCapability: seatOneToken,
          displayName: 'Blue',
        },
        {
          ...dependencies(crypto, persistence()),
          persistence: {
            commitAdmission: async (transaction) => {
              durable = transaction.snapshot;
              throw new Error('reply path crashed after commit');
            },
          },
        }
      )
    ).rejects.toThrow('reply path crashed after commit');
    expect(durable.authorityVersion).toBe(1);
    const committedSessionId = durable.admission?.seats[p1]?.claimedSessionId;

    const retryStorage = persistence();
    const retried = await admitRoomSession(
      durable,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Ignored Retry Name',
      },
      dependencies(crypto, retryStorage)
    );

    expect(retried).toMatchObject({
      accepted: true,
      session: { id: committedSessionId },
      resumeCapability: seatOneToken,
    });
    expect(retryStorage.transactions[0]?.kind).toBe('session_resumed');
    expect(retried.snapshot.state.players[p1]?.displayName).toBe('Blue');
  });

  it('creates independent spectator sessions from the spectator capability', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const first = await admitRoomSession(
      createSnapshot(),
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    if (!first.accepted) throw new Error(first.code);
    const second = await admitRoomSession(
      first.snapshot,
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    if (!second.accepted) throw new Error(second.code);

    expect(first.session.viewer).toEqual({ kind: 'spectator' });
    expect(first.session.displayName).toBe('Spectator');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.snapshot.authorityVersion).toBe(2);
    expect(storage.transactions).toHaveLength(2);
  });

  it('binds solo admission to one durably claimed player seat without blocking spectators or resume', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const first = await admitRoomSession(
      createSingleOccupancySnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Solo player',
      },
      dependencies(crypto, storage)
    );
    if (!first.accepted) throw new Error(first.code);

    const secondSeat = await admitRoomSession(
      first.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatTwoToken,
        displayName: 'Unexpected second player',
      },
      dependencies(crypto, storage)
    );
    expect(secondSeat).toMatchObject({
      accepted: false,
      code: 'seat_unavailable',
      snapshot: first.snapshot,
    });

    const resumed = await admitRoomSession(
      first.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Ignored replacement name',
      },
      dependencies(crypto, storage)
    );
    expect(resumed).toMatchObject({
      accepted: true,
      session: { id: first.session.id },
    });
    if (!resumed.accepted) return;

    const spectator = await admitRoomSession(
      resumed.snapshot,
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    expect(spectator).toMatchObject({
      accepted: true,
      session: { viewer: { kind: 'spectator' } },
    });
    expect(storage.transactions.map((entry) => entry.kind)).toEqual([
      'seat_claimed',
      'session_resumed',
      'spectator_joined',
    ]);
  });

  it('retires losing player credentials when the first single-occupancy seat wins', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const losingInvitation = await issueRoomInvitation(
      createSingleOccupancySnapshot(),
      { capability: seatTwoToken, requestedRole: 'player' },
      9_999,
      dependencies(crypto, storage)
    );
    if (!losingInvitation.accepted) throw new Error(losingInvitation.code);
    const losingTicket = await issueRoomAdmissionTicket(
      losingInvitation.snapshot,
      {
        capability: seatTwoToken,
        displayName: 'Second contender',
        requestedRole: 'player',
      },
      10_000,
      dependencies(crypto, storage)
    );
    if (!losingTicket.accepted) throw new Error(losingTicket.code);
    const spectatorTicket = await issueRoomAdmissionTicket(
      losingTicket.snapshot,
      {
        capability: spectatorToken,
        displayName: 'Spectator',
        requestedRole: 'spectator',
      },
      10_000,
      dependencies(crypto, storage)
    );
    if (!spectatorTicket.accepted) throw new Error(spectatorTicket.code);

    const winner = await admitRoomSession(
      spectatorTicket.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Solo player',
      },
      dependencies(crypto, storage)
    );
    if (!winner.accepted) throw new Error(winner.code);
    expect(winner.snapshot.admission?.invitations).toEqual({});
    expect(winner.snapshot.admission?.tickets).toEqual({
      [digest(spectatorTicket.admissionTicket)]: {
        role: 'spectator',
        displayName: 'Spectator',
        expiresAt: 40_000,
        resumeCapabilityDigest: digest(spectatorTicket.resumeCapability),
      },
    });

    const staleTicket = await redeemRoomAdmissionTicket(
      winner.snapshot,
      {
        admissionTicket: losingTicket.admissionTicket,
        resumeCapability: losingTicket.resumeCapability,
        displayName: 'Second contender',
        requestedRole: 'player',
      },
      10_001,
      dependencies(crypto, storage)
    );
    expect(staleTicket).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });

    const invitation = await issueRoomInvitation(
      winner.snapshot,
      { capability: seatTwoToken, requestedRole: 'player' },
      10_001,
      dependencies(crypto, storage)
    );
    expect(invitation).toMatchObject({
      accepted: false,
      code: 'seat_unavailable',
    });

    const directTicket = await issueRoomAdmissionTicket(
      winner.snapshot,
      {
        capability: seatTwoToken,
        displayName: 'Second contender',
        requestedRole: 'player',
      },
      10_001,
      dependencies(crypto, storage)
    );
    expect(directTicket).toMatchObject({
      accepted: false,
      code: 'seat_unavailable',
    });
  });

  it('requires room mode and persisted player-seat limit to agree', () => {
    const solo = createSingleOccupancySnapshot();
    expect(collectAuthoritySnapshotProblems(solo)).toEqual([]);
    const unsafe = {
      ...solo,
      admission: { ...solo.admission!, playerSeatLimit: 2 },
    } as unknown as RoomAuthoritySnapshot;
    expect(collectAuthoritySnapshotProblems(unsafe)).toContain(
      'solo authority requires a one-player admission limit'
    );
  });

  it('requires every player session to own its durable seat claim', () => {
    const current = createSnapshot();
    const session = {
      id: 'unbound-player-session',
      viewer: { kind: 'player' as const, playerId: p1 },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
    };
    const unbound = {
      ...current,
      sessions: { [session.id]: session },
    };

    expect(collectAuthoritySnapshotProblems(unbound)).toContain(
      `player session ${session.id} is not the durable claim for its seat`
    );
  });

  it('rejects multiple active player sessions even without admission metadata', () => {
    const current = createSnapshot();
    const sessions = Object.fromEntries(
      [p1, p2].map((playerId, index) => {
        const id = `legacy-solo-session-${index + 1}`;
        return [
          id,
          {
            id,
            viewer: { kind: 'player' as const, playerId },
            active: true,
            nextClientSequence: 1,
            recentOutcomes: [],
          },
        ];
      })
    );
    const unsafe = {
      ...current,
      mode: 'solo' as const,
      sessions,
      admission: undefined,
    };

    expect(collectAuthoritySnapshotProblems(unsafe)).toContain(
      'solo authority cannot retain multiple active player sessions'
    );
  });

  it('rejects invalid capabilities without echoing them or writing', async () => {
    const storage = persistence();
    const secret = 'wrong-capability-000000000000000000';
    const result = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: secret,
        displayName: 'Blue',
      },
      dependencies(createCrypto(), storage)
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(storage.transactions).toHaveLength(0);
  });

  it('rejects undersized tokens before hashing', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const result = await admitRoomSession(
      createSnapshot(),
      { type: 'Resume', resumeCapability: 'short' },
      dependencies(crypto, storage)
    );

    expect(result).toMatchObject({ accepted: false, code: 'invalid_request' });
    expect(crypto.digestCapability).not.toHaveBeenCalled();
  });
});
