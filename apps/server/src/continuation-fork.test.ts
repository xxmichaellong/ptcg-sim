import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  stableHash,
  type CommandContext,
  type PlayerId,
  type ViewerRole,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  appendReplayHistory,
  assertAuthoritySnapshotInvariants,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  issueRoomAdmissionTicket,
  projectRecipient,
  type ProjectionIdentityState,
  type RoomAuthoritySnapshot,
  type RoomInvitationCrypto,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CONTINUATION_FORK_POLICY,
  prepareContinuationFork,
  type ContinuationForkCrypto,
  type ContinuationForkSource,
} from './continuation-fork.js';

const p1 = asPlayerId('continuation-fork-player-one');
const p2 = asPlayerId('continuation-fork-player-two');
const restoredAt = 2_000_000_100_000;

const oldAuthorization = {
  seatOne: 'old-seat-one-capability-000000000000001',
  seatTwo: 'old-seat-two-capability-000000000000002',
  spectator: 'old-spectator-capability-0000000000003',
  invitation: 'old-room-invitation-000000000000000004',
  ticket: 'old-admission-ticket-00000000000000005',
  ticketResume: 'old-ticket-resume-000000000000000006',
  sessionOneResume: 'old-session-resume-one-0000000000007',
  sessionTwoResume: 'old-session-resume-two-0000000000008',
} as const;

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, '0').repeat(6).slice(0, 43);
};

const commandContext = (): CommandContext => {
  let card = 0;
  return {
    nextCardId: () =>
      asCardInstanceId(`continuation-fork-canonical-card-${++card}`),
    nextStackId: () => asStackId('continuation-fork-stack-0000000001'),
    nextInspectionId: () =>
      asInspectionId('continuation-fork-inspection-0000001'),
    nextWorkAreaId: () => asWorkAreaId('continuation-fork-work-area-00000001'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const populatedIdentities = (
  state: RoomAuthoritySnapshot['state']
): ProjectionIdentityState => {
  let identities = emptyProjectionIdentityState();
  let next = 0;
  const opaqueIds = {
    nextOpaqueId: (kind: 'card' | 'definition') =>
      `old-view-${kind}-${String(++next).padStart(20, '0')}`,
  };
  for (const viewer of [
    { kind: 'player', playerId: p1 } as const,
    { kind: 'player', playerId: p2 } as const,
    { kind: 'spectator' } as const,
  ]) {
    identities = projectRecipient(
      state,
      viewer,
      identities,
      opaqueIds
    ).identities;
  }
  return identities;
};

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const initial = createEmptyMatch(asMatchId('canonical-saved-match'), [
    {
      playerId: p1,
      displayName: 'Blue',
      cardBackUrl: 'https://images.example/blue.png',
    },
    {
      playerId: p2,
      displayName: 'Red',
      cardBackUrl: 'https://images.example/red.png',
    },
  ]);
  const loaded = executeCommand(
    initial,
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('continuation-fork-secret-definition'),
            name: 'Private Saved Card',
            category: 'Pokémon',
            imageUrl: 'https://images.example/private-card.png',
          },
          count: 4,
        },
      ],
    },
    commandContext()
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: digest(oldAuthorization.seatOne),
      [p2]: digest(oldAuthorization.seatTwo),
    },
    spectatorCapabilityDigest: digest(oldAuthorization.spectator),
  });
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 19,
    mode: 'multiplayer',
    state: loaded.state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: appendReplayHistory(
      createReplayHistory(initial),
      loaded.batch,
      loaded.state,
      128
    ),
    identities: populatedIdentities(loaded.state),
    sessions: {
      'old-session-player-one': {
        id: 'old-session-player-one',
        viewer: { kind: 'player', playerId: p1 },
        displayName: 'Blue',
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [
          {
            commandId: 'old-idempotency-command',
            clientSequence: 1,
            accepted: true,
            revision: loaded.state.revision,
          },
        ],
        resumeCapabilityDigest: digest(oldAuthorization.sessionOneResume),
      },
      'old-session-player-two': {
        id: 'old-session-player-two',
        viewer: { kind: 'player', playerId: p2 },
        displayName: 'Red',
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
        resumeCapabilityDigest: digest(oldAuthorization.sessionTwoResume),
      },
    },
    admission: {
      ...admission,
      seats: {
        [p1]: {
          ...admission.seats[p1]!,
          claimedSessionId: 'old-session-player-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'old-session-player-two',
        },
      },
      invitations: {
        [digest(oldAuthorization.invitation)]: {
          role: 'spectator',
          expiresAt: restoredAt + 100_000,
        },
      },
      tickets: {
        [digest(oldAuthorization.ticket)]: {
          role: 'spectator',
          displayName: 'Old Viewer',
          expiresAt: restoredAt + 10_000,
          resumeCapabilityDigest: digest(oldAuthorization.ticketResume),
        },
      },
    },
  };
  assertAuthoritySnapshotInvariants(snapshot);
  return snapshot;
};

const forkSource = (
  snapshot = snapshotFixture(),
  requesterPlayerId: PlayerId = p1
): ContinuationForkSource => ({
  canonicalStateHash: stableHash(snapshot.state),
  requesterPlayerId,
  snapshot,
});

class DeterministicForkCrypto
  implements RoomInvitationCrypto, ContinuationForkCrypto
{
  seat = 0;
  invitation = 0;
  ticket = 0;
  resume = 0;
  session = 0;

  async digestCapability(capability: string): Promise<string> {
    return digest(capability);
  }

  equalDigest(left: string, right: string): boolean {
    return left === right;
  }

  nextSeatCapability(): string {
    return `fresh-seat-capability-${String(++this.seat).padStart(32, '0')}`;
  }

  nextRoomInvitation(): string {
    return `fresh-room-invitation-${String(++this.invitation).padStart(32, '0')}`;
  }

  nextAdmissionTicket(): string {
    return `fresh-admission-ticket-${String(++this.ticket).padStart(32, '0')}`;
  }

  nextResumeCapability(): string {
    return `fresh-resume-capability-${String(++this.resume).padStart(32, '0')}`;
  }

  nextSessionId(): string {
    return `fresh-session-${String(++this.session).padStart(32, '0')}`;
  }
}

const freshProjection = (
  state: RoomAuthoritySnapshot['state'],
  viewer: ViewerRole
) => {
  let next = 0;
  return projectRecipient(state, viewer, emptyProjectionIdentityState(), {
    nextOpaqueId: (kind) =>
      `equivalent-${kind}-${String(++next).padStart(20, '0')}`,
  }).snapshot;
};

describe('continuation fork transformation', () => {
  it('preserves exact canonical gameplay while rotating every room authority identity', async () => {
    const source = forkSource();
    const sourceBefore = structuredClone(source.snapshot);
    const cryptoSource = new DeterministicForkCrypto();
    const result = await prepareContinuationFork(
      source,
      cryptoSource,
      restoredAt
    );

    expect(result.snapshot.state).toEqual(source.snapshot.state);
    expect(result.snapshot.state).not.toBe(source.snapshot.state);
    expect(stableHash(result.snapshot.state)).toBe(source.canonicalStateHash);
    expect(result.snapshot.state.matchId).toBe('canonical-saved-match');
    expect(result.snapshot.replayHistory).toEqual(
      source.snapshot.replayHistory
    );
    expect(result.snapshot.replayHistory).not.toBe(
      source.snapshot.replayHistory
    );
    expect(result.snapshot.authorityVersion).toBe(0);
    expect(result.snapshot.sessions).toEqual({});
    expect(result.snapshot.identities).toEqual(emptyProjectionIdentityState());
    expect(result.snapshot.soloUndoHistory).toEqual({
      baseState: null,
      baseStateHash: null,
      entries: [],
    });
    expect(source.snapshot).toEqual(sourceBefore);

    const admission = result.snapshot.admission!;
    expect(admission.playerSeatLimit).toBe(2);
    expect(admission.spectatorCapabilityDigest).toBeNull();
    expect(admission.tickets).toEqual({});
    expect(admission.seats[p1]?.claimedSessionId).toBeNull();
    expect(admission.seats[p2]?.claimedSessionId).toBeNull();
    expect(admission.seats[p1]?.claimCapabilityDigest).toBe(
      digest(result.requesterSeatCapability)
    );
    expect(admission.seats[p2]?.claimCapabilityDigest).not.toBe(
      digest(result.requesterSeatCapability)
    );
    expect(admission.invitations).toEqual({
      [digest(result.opponentInvitation.invitation)]: {
        role: 'player',
        playerId: p2,
        expiresAt:
          restoredAt +
          DEFAULT_CONTINUATION_FORK_POLICY.opponentInvitationLifetimeMs,
      },
    });

    const serialized = JSON.stringify(result.snapshot);
    expect(serialized).not.toContain('old-session');
    expect(serialized).not.toContain('old-idempotency-command');
    expect(serialized).not.toContain('old-view-');
    for (const raw of Object.values(oldAuthorization)) {
      expect(serialized).not.toContain(digest(raw));
    }
    expect(JSON.stringify(result)).not.toContain(
      'fresh-seat-capability-00000000000000000000000000000002'
    );
  });

  it('produces exact fresh-alias projections for both players and spectators', async () => {
    const source = forkSource();
    const restored = await prepareContinuationFork(
      source,
      new DeterministicForkCrypto(),
      restoredAt
    );
    const viewers: readonly ViewerRole[] = [
      { kind: 'player', playerId: p1 },
      { kind: 'player', playerId: p2 },
      { kind: 'spectator' },
    ];
    for (const viewer of viewers) {
      expect(freshProjection(restored.snapshot.state, viewer)).toEqual(
        freshProjection(source.snapshot.state, viewer)
      );
    }
  });

  it('issues the opponent credential through the ordinary one-use invitation flow', async () => {
    const cryptoSource = new DeterministicForkCrypto();
    const restored = await prepareContinuationFork(
      forkSource(),
      cryptoSource,
      restoredAt
    );
    const issued = await issueRoomAdmissionTicket(
      restored.snapshot,
      {
        capability: restored.opponentInvitation.invitation,
        displayName: 'Red restored',
        requestedRole: 'player',
      },
      restoredAt + 1,
      {
        crypto: cryptoSource,
        opaqueIds: { nextOpaqueId: () => 'unused-opaque-identifier-000000001' },
        persistence: { commitAdmission: vi.fn(async () => undefined) },
      }
    );

    expect(issued.accepted).toBe(true);
    if (!issued.accepted) return;
    expect(
      issued.snapshot.admission?.tickets[digest(issued.admissionTicket)]
    ).toMatchObject({ role: 'player', playerId: p2 });
  });

  it('rejects non-multiplayer, changed-hash, and wrong-seat sources before entropy', async () => {
    const cryptoSource = new DeterministicForkCrypto();
    const nextSeat = vi.spyOn(cryptoSource, 'nextSeatCapability');
    const multiplayer = snapshotFixture();
    const solo: RoomAuthoritySnapshot = {
      ...multiplayer,
      mode: 'solo',
      sessions: {},
      admission: {
        ...multiplayer.admission!,
        playerSeatLimit: 1,
        seats: Object.fromEntries(
          Object.entries(multiplayer.admission!.seats).map(([id, seat]) => [
            id,
            { ...seat, claimedSessionId: null },
          ])
        ),
      },
    };

    await expect(
      prepareContinuationFork(forkSource(solo), cryptoSource, restoredAt)
    ).rejects.toThrow('cannot initialize');
    await expect(
      prepareContinuationFork(
        { ...forkSource(multiplayer), canonicalStateHash: 'changed' },
        cryptoSource,
        restoredAt
      )
    ).rejects.toThrow('cannot initialize');
    await expect(
      prepareContinuationFork(
        forkSource(multiplayer, asPlayerId('not-a-saved-player')),
        cryptoSource,
        restoredAt
      )
    ).rejects.toThrow('requester seat');
    expect(nextSeat).not.toHaveBeenCalled();
  });

  it('validates the fork lifecycle before reading source data or entropy', async () => {
    const cryptoSource = new DeterministicForkCrypto();
    const nextSeat = vi.spyOn(cryptoSource, 'nextSeatCapability');
    const invalidSource = undefined as unknown as ContinuationForkSource;

    await expect(
      prepareContinuationFork(invalidSource, cryptoSource, -1)
    ).rejects.toThrow('lifecycle policy');
    await expect(
      prepareContinuationFork(forkSource(), cryptoSource, restoredAt, {
        opponentInvitationLifetimeMs: 29_999,
      })
    ).rejects.toThrow('lifecycle policy');
    expect(nextSeat).not.toHaveBeenCalled();
  });

  it('retries old/raw/digest collisions and never resurrects prior authorization', async () => {
    const cryptoSource = new DeterministicForkCrypto();
    const freshRequester = 'recovered-requester-seat-capability-00000000001';
    const freshOpponent = 'recovered-opponent-seat-capability-000000000002';
    const freshInvitation = 'recovered-opponent-room-invitation-00000000003';
    const seats = [
      oldAuthorization.seatOne,
      freshRequester,
      freshRequester,
      freshOpponent,
    ];
    const invitations = [oldAuthorization.invitation, freshInvitation];
    cryptoSource.nextSeatCapability = vi.fn(() => seats.shift() ?? 'short');
    cryptoSource.nextRoomInvitation = vi.fn(
      () => invitations.shift() ?? 'short'
    );

    const result = await prepareContinuationFork(
      forkSource(),
      cryptoSource,
      restoredAt
    );
    expect(result.requesterSeatCapability).toBe(freshRequester);
    expect(result.opponentInvitation.invitation).toBe(freshInvitation);
    expect(cryptoSource.nextSeatCapability).toHaveBeenCalledTimes(4);
    expect(cryptoSource.nextRoomInvitation).toHaveBeenCalledTimes(2);
  });

  it('fails closed after bounded invalid entropy or persistent digest collision', async () => {
    const invalid = new DeterministicForkCrypto();
    invalid.nextSeatCapability = vi.fn(() => 'short');
    await expect(
      prepareContinuationFork(forkSource(), invalid, restoredAt)
    ).rejects.toThrow('requester-seat source');
    expect(invalid.nextSeatCapability).toHaveBeenCalledTimes(32);

    const colliding = new DeterministicForkCrypto();
    let next = 0;
    colliding.nextSeatCapability = vi.fn(
      () => `otherwise-valid-seat-${String(++next).padStart(32, '0')}`
    );
    colliding.digestCapability = vi.fn(async () =>
      digest(oldAuthorization.seatTwo)
    );
    await expect(
      prepareContinuationFork(forkSource(), colliding, restoredAt)
    ).rejects.toThrow('requester-seat source');
    expect(colliding.nextSeatCapability).toHaveBeenCalledTimes(32);
    expect(colliding.digestCapability).toHaveBeenCalledTimes(32);
  });
});
