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
  playerZoneId,
  type CommandContext,
  type GameCommand,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  admitRoomSession,
  createRoomAdmissionState,
  issueRoomAdmissionTicket,
  openSoloRoom,
  redeemRoomAdmissionTicket,
  type RoomOpeningCrypto,
} from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  assertAdmissionTransactionTransition,
  collectAuthoritySnapshotProblems,
} from './invariants.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type PersistedAdmissionTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';
import { createReplayHistory } from './replay-history.js';

const blue = asPlayerId('player-blue');
const red = asPlayerId('player-red');
const hostClaim = 'solo-host-seat-capability-00000000001';
const unusedClaim = 'solo-unused-seat-capability-0000000002';

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, '0').repeat(8);
};

/**
 * The Solo player has set up the other seat's deck and is looking at its
 * Prizes, as Solo lets them (both seats consent).
 */
const lookingAcross = (state: MatchState): MatchState => {
  let card = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`opening-card-${String(++card)}`),
    nextStackId: () => asStackId('opening-stack'),
    nextInspectionId: () => asInspectionId('opening-look'),
    nextWorkAreaId: () => asWorkAreaId('opening-work-area'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
  const run = (current: MatchState, command: GameCommand) => {
    const result = executeCommand(current, command, context);
    if (!result.accepted) throw new Error(result.message);
    return result.state;
  };
  let next = run(state, {
    type: 'LoadDeck',
    playerId: red,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('opening-definition'),
          name: 'Opening card',
          category: 'Pokémon',
          imageUrl: '/opening.png',
        },
        count: 14,
      },
    ],
  });
  next = run(next, { type: 'SetupPlayer', playerId: red });
  const prizes = playerZoneId(red, 'prizes');
  return run(next, {
    type: 'BeginZoneInspection',
    sourcePlayerId: red,
    viewerPlayerId: blue,
    sourceZoneId: prizes,
    expectedCardIds: [...next.zones[prizes]!.cardIds],
  });
};

/** A Solo room as created: both seats consent to flips, one may be taken. */
const soloRoom = (
  prepare: (state: MatchState) => MatchState = (state) => state
): RoomAuthoritySnapshot => {
  const created = createEmptyMatch(asMatchId('solo-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const state = prepare({
    ...created,
    players: Object.fromEntries(
      Object.entries(created.players).map(([id, player]) => [
        id,
        { ...player, coachingConsent: true },
      ])
    ),
  } as typeof created);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'solo',
    state,
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerSeatLimit: 1,
      playerIds: [blue, red],
      seatCapabilityDigests: {
        [blue]: digest(hostClaim),
        [red]: digest(unusedClaim),
      },
    }),
  };
};

const crypto = (): RoomOpeningCrypto & {
  readonly nextAdmissionTicket: () => string;
} => {
  let n = 0;
  const next = (kind: string) =>
    `${kind}-capability-${String(++n).padStart(24, '0')}`;
  return {
    digestCapability: vi.fn(async (capability: string) => digest(capability)),
    equalDigest: (left, right) => left === right,
    nextSessionId: () => `session-${String(++n).padStart(24, '0')}`,
    nextResumeCapability: () => next('resume'),
    nextAdmissionTicket: () => next('ticket'),
    nextSeatCapability: () => next('seat'),
    nextSpectatorCapability: () => next('spectator'),
  };
};

const harness = () => {
  const transactions: PersistedAdmissionTransaction[] = [];
  let opaque = 0;
  return {
    transactions,
    deps: {
      crypto: crypto(),
      persistence: {
        commitAdmission: async (transaction: PersistedAdmissionTransaction) => {
          transactions.push(transaction);
        },
      },
      opaqueIds: {
        nextOpaqueId: (kind: 'card' | 'definition') =>
          `opaque-${kind}-${String(++opaque).padStart(12, '0')}`,
      },
      now: () => 1_000,
    },
  };
};

/** The Solo room with its player sat at it. */
const seatedSoloRoom = async (
  deps: ReturnType<typeof harness>['deps'],
  prepare?: (state: MatchState) => MatchState
) => {
  const seated = await admitRoomSession(
    soloRoom(prepare),
    { type: 'ClaimSeat', seatCapability: hostClaim, displayName: 'Blue' },
    deps
  );
  if (!seated.accepted) throw new Error('Solo player was not seated');
  return seated;
};

describe('opening a Solo room to an opponent', () => {
  it('turns the same room multiplayer, with a new second-seat claim, and nothing else of its game', async () => {
    const { deps, transactions } = harness();
    const seated = await seatedSoloRoom(deps);
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: '  Ash  ' },
      deps
    );
    expect(opened.accepted).toBe(true);
    if (!opened.accepted) return;
    const room = opened.snapshot;
    expect(room.mode).toBe('multiplayer');
    expect(room.admission?.playerSeatLimit).toBe(2);
    expect(room.authorityVersion).toBe(seated.snapshot.authorityVersion + 1);
    // The host keeps their seat and claim, and plays under their name now.
    expect(room.admission?.seats[blue]).toEqual(
      seated.snapshot.admission?.seats[blue]
    );
    expect(room.state.players[blue]?.displayName).toBe('Ash');
    expect(room.sessions[seated.session.id]?.displayName).toBe('Ash');
    // The open seat waits under a plain name, its claim new and handed over.
    expect(room.state.players[red]?.displayName).toBe('Player 2');
    expect(room.admission?.seats[red]?.claimCapabilityDigest).toBe(
      digest(opened.playerTwoSeatCapability)
    );
    expect(opened.playerTwoSeatCapability).not.toBe(unusedClaim);
    expect(room.admission?.spectatorCapabilityDigest).toBe(
      digest(opened.spectatorCapability)
    );
    // Solo's consent to flips is not the new player's to have given.
    expect(
      Object.values(room.state.players).map((player) => player.coachingConsent)
    ).toEqual([false, false]);
    expect(room.replayHistory).toEqual(createReplayHistory(room.state));
    expect(collectAuthoritySnapshotProblems(room)).toEqual([]);
    expect(transactions.at(-1)).toMatchObject({ kind: 'room_opened' });
    expect(() =>
      assertAdmissionTransactionTransition(
        seated.snapshot,
        transactions.at(-1)!
      )
    ).not.toThrow();
    // The seated player is shown the table under a room's rules.
    expect(opened.refreshes.map((refresh) => refresh.sessionId)).toEqual([
      seated.session.id,
    ]);
    expect(opened.refreshes[0]?.message.type).toBe('ProjectionRefresh');
  });

  it('lets someone take the second seat with the new claim, and never the old one', async () => {
    const { deps } = harness();
    const seated = await seatedSoloRoom(deps);
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    if (!opened.accepted) throw new Error('not opened');
    const stale = await issueRoomAdmissionTicket(
      opened.snapshot,
      {
        capability: unusedClaim,
        displayName: 'Misty',
        requestedRole: 'player',
      },
      1_000,
      deps
    );
    expect(stale.accepted).toBe(false);
    const ticket = await issueRoomAdmissionTicket(
      opened.snapshot,
      {
        capability: opened.playerTwoSeatCapability,
        displayName: 'Misty',
        requestedRole: 'player',
      },
      1_000,
      deps
    );
    expect(ticket.accepted).toBe(true);
    if (!ticket.accepted) return;
    const joined = await redeemRoomAdmissionTicket(
      ticket.snapshot,
      {
        admissionTicket: ticket.admissionTicket,
        displayName: 'Misty',
        requestedRole: 'player',
        resumeCapability: ticket.resumeCapability,
      },
      1_000,
      deps
    );
    expect(joined.accepted).toBe(true);
    if (!joined.accepted) return;
    expect(joined.snapshot.state.players[red]?.displayName).toBe('Misty');
    expect(joined.snapshot.admission?.seats[red]?.claimedSessionId).toBe(
      joined.session.id
    );
  });

  it('refuses any claim but the Solo player’s own, and a room that is not Solo', async () => {
    const { deps, transactions } = harness();
    const seated = await seatedSoloRoom(deps);
    const committed = transactions.length;
    for (const capability of [
      unusedClaim,
      'someone-else-entirely-capability-0001',
    ]) {
      expect(
        await openSoloRoom(
          seated.snapshot,
          { capability, displayName: 'Ash' },
          deps
        )
      ).toMatchObject({ accepted: false, code: 'invalid_capability' });
    }
    expect(
      await openSoloRoom(
        seated.snapshot,
        { capability: 'short', displayName: 'Ash' },
        deps
      )
    ).toMatchObject({ accepted: false, code: 'invalid_request' });
    expect(
      await openSoloRoom(
        seated.snapshot,
        { capability: hostClaim, displayName: '  ' },
        deps
      )
    ).toMatchObject({ accepted: false, code: 'invalid_request' });
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    if (!opened.accepted) throw new Error('not opened');
    expect(transactions.length).toBe(committed + 1);
  });

  it('is told apart from every other admission change by what it may touch', async () => {
    const { deps, transactions } = harness();
    const seated = await seatedSoloRoom(deps);
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    if (!opened.accepted) throw new Error('not opened');
    const transaction = transactions.at(-1)!;
    const tampered =
      (change: (room: RoomAuthoritySnapshot) => RoomAuthoritySnapshot) => () =>
        assertAdmissionTransactionTransition(seated.snapshot, {
          ...transaction,
          snapshot: change(opened.snapshot),
        } as PersistedAdmissionTransaction);
    // A consent kept, the host's claim renewed, the match touched: refused.
    expect(
      tampered((room) => ({
        ...room,
        state: {
          ...room.state,
          players: {
            ...room.state.players,
            [red]: { ...room.state.players[red]!, coachingConsent: true },
          },
        },
      }))
    ).toThrow();
    expect(
      tampered((room) => ({
        ...room,
        admission: {
          ...room.admission!,
          seats: {
            ...room.admission!.seats,
            [blue]: {
              ...room.admission!.seats[blue]!,
              claimCapabilityDigest: digest(
                'another-host-claim-000000000000001'
              ),
            },
          },
        },
      }))
    ).toThrow();
    expect(
      tampered((room) => ({
        ...room,
        state: { ...room.state, revision: room.state.revision + 1 },
      }))
    ).toThrow();
    // And no other kind of admission change may turn a room multiplayer.
    expect(() =>
      assertAdmissionTransactionTransition(seated.snapshot, {
        expectedAuthorityVersion: seated.snapshot.authorityVersion,
        snapshot: opened.snapshot,
        kind: 'ticket_issued',
        ticketDigest: 'x'.repeat(64),
      })
    ).toThrow();
  });

  it('renews the claims for a host whose answer was lost, while the second seat is free, and no longer once taken', async () => {
    const { deps, transactions } = harness();
    const seated = await seatedSoloRoom(deps);
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    if (!opened.accepted) throw new Error('not opened');
    // The answer never arrived; the host asks again.
    const again = await openSoloRoom(
      opened.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    expect(again.accepted).toBe(true);
    if (!again.accepted) return;
    expect(transactions.at(-1)).toMatchObject({ kind: 'room_reopened' });
    expect(() =>
      assertAdmissionTransactionTransition(
        opened.snapshot,
        transactions.at(-1)!
      )
    ).not.toThrow();
    expect(again.playerTwoSeatCapability).not.toBe(
      opened.playerTwoSeatCapability
    );
    expect(again.spectatorCapability).not.toBe(opened.spectatorCapability);
    // Nothing else of the room changed; each session is shown the room once
    // more, in case the opening's own views never reached them.
    expect(again.snapshot.state).toEqual(opened.snapshot.state);
    expect(again.snapshot.replayHistory).toEqual(opened.snapshot.replayHistory);
    expect(again.snapshot.sessions).toEqual(opened.snapshot.sessions);
    expect(again.refreshes.map((refresh) => refresh.sessionId)).toEqual([
      seated.session.id,
    ]);
    expect(again.refreshes[0]?.message).toMatchObject({
      type: 'ProjectionRefresh',
      cause: 'room_opened',
    });
    // The lost claim is spent; the renewed one takes the seat.
    expect(
      (
        await issueRoomAdmissionTicket(
          again.snapshot,
          {
            capability: opened.playerTwoSeatCapability,
            displayName: 'Misty',
            requestedRole: 'player',
          },
          1_000,
          deps
        )
      ).accepted
    ).toBe(false);
    const ticket = await issueRoomAdmissionTicket(
      again.snapshot,
      {
        capability: again.playerTwoSeatCapability,
        displayName: 'Misty',
        requestedRole: 'player',
      },
      1_000,
      deps
    );
    if (!ticket.accepted) throw new Error('no ticket');
    const joined = await redeemRoomAdmissionTicket(
      ticket.snapshot,
      {
        admissionTicket: ticket.admissionTicket,
        displayName: 'Misty',
        requestedRole: 'player',
        resumeCapability: ticket.resumeCapability,
      },
      1_000,
      deps
    );
    if (!joined.accepted) throw new Error('not joined');
    // Taken, the room is someone's game: its claims stay as they are.
    const count = transactions.length;
    expect(
      await openSoloRoom(
        joined.snapshot,
        { capability: hostClaim, displayName: 'Ash' },
        deps
      )
    ).toMatchObject({ accepted: false, code: 'not_solo' });
    expect(transactions.length).toBe(count);
    // And a renewal that touches the game is refused.
    expect(() =>
      assertAdmissionTransactionTransition(opened.snapshot, {
        ...transactions.find((entry) => entry.kind === 'room_reopened')!,
        snapshot: {
          ...again.snapshot,
          state: { ...again.snapshot.state, revision: 7 },
        },
      } as PersistedAdmissionTransaction)
    ).toThrow();
  });

  it('takes back the looks across seats that Solo’s consent allowed', async () => {
    const { deps, transactions } = harness();
    const seated = await seatedSoloRoom(deps, lookingAcross);
    expect(
      Object.keys(seated.snapshot.state.visibility.inspectionGrants)
    ).toHaveLength(1);
    const opened = await openSoloRoom(
      seated.snapshot,
      { capability: hostClaim, displayName: 'Ash' },
      deps
    );
    expect(opened.accepted).toBe(true);
    if (!opened.accepted) return;
    // The host no longer looks at what is now someone else's Prizes.
    expect(opened.snapshot.state.visibility.inspectionGrants).toEqual({});
    expect(collectAuthoritySnapshotProblems(opened.snapshot)).toEqual([]);
    expect(() =>
      assertAdmissionTransactionTransition(
        seated.snapshot,
        transactions.at(-1)!
      )
    ).not.toThrow();
  });
});
