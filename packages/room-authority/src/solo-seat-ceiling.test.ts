import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { createRoomAdmissionState } from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  assertAuthorityTransactionTransition,
  collectAuthoritySnapshotProblems,
} from './invariants.js';
import { createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type AuthorityMode,
  type PersistedAuthorityTransaction,
  type RoomAdmissionState,
  type RoomAuthoritySnapshot,
} from './model.js';

const p1 = asPlayerId('ceiling-player-one');
const p2 = asPlayerId('ceiling-player-two');

const matchState = (): MatchState =>
  createEmptyMatch(asMatchId('ceiling-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

const snapshotWith = (options: {
  readonly mode: AuthorityMode;
  readonly playerSeatLimit: RoomAdmissionState['playerSeatLimit'];
  readonly claimedPlayerIds: readonly (typeof p1)[];
}): RoomAuthoritySnapshot => {
  const state = matchState();
  const admission = createRoomAdmissionState({
    playerSeatLimit: options.playerSeatLimit,
    playerIds: [p1, p2],
    seatCapabilityDigests: { [p1]: 'a'.repeat(32), [p2]: 'b'.repeat(32) },
    spectatorCapabilityDigest: 'c'.repeat(32),
  });
  const sessionIdFor = (playerId: typeof p1) => `session-${playerId}`;
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: options.mode,
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: {
      ...admission,
      seats: Object.fromEntries(
        Object.entries(admission.seats).map(([playerId, seat]) => [
          playerId,
          options.claimedPlayerIds.includes(playerId as typeof p1)
            ? { ...seat, claimedSessionId: sessionIdFor(playerId as typeof p1) }
            : seat,
        ])
      ),
    },
    sessions: Object.fromEntries(
      options.claimedPlayerIds.map((playerId) => [
        sessionIdFor(playerId),
        {
          id: sessionIdFor(playerId),
          viewer: { kind: 'player' as const, playerId },
          active: true,
          nextClientSequence: 1,
          recentOutcomes: [],
        },
      ])
    ),
  };
};

/**
 * Solo replay disclosure hands a player every prize and the opposing hand. That
 * is only safe while a solo room can hold one human, and the durable
 * `playerSeatLimit` is the whole of that guarantee — permission is deliberately
 * never inferred from how many sessions happen to be connected.
 *
 * The ceiling was implemented without a test: disabling the check in
 * `collectAuthoritySnapshotProblems` left the entire suite green, so nothing
 * would have caught a regression that lets a second player claim a seat in a
 * solo room and receive the first player's hand through replay.
 */
describe('durable player-seat ceiling', () => {
  it('accepts a solo room with its single seat claimed', () => {
    expect(
      collectAuthoritySnapshotProblems(
        snapshotWith({
          mode: 'solo',
          playerSeatLimit: 1,
          claimedPlayerIds: [p1],
        })
      )
    ).toEqual([]);
  });

  it('rejects a second claimed seat in a solo room', () => {
    const problems = collectAuthoritySnapshotProblems(
      snapshotWith({
        mode: 'solo',
        playerSeatLimit: 1,
        claimedPlayerIds: [p1, p2],
      })
    );
    expect(problems).toContain(
      'admission exceeds its durable player-seat limit'
    );
  });

  it('still allows both seats in a multiplayer room', () => {
    expect(
      collectAuthoritySnapshotProblems(
        snapshotWith({
          mode: 'multiplayer',
          playerSeatLimit: 2,
          claimedPlayerIds: [p1, p2],
        })
      )
    ).toEqual([]);
  });

  it('binds the ceiling to the room mode in both directions', () => {
    expect(
      collectAuthoritySnapshotProblems(
        snapshotWith({
          mode: 'solo',
          playerSeatLimit: 2,
          claimedPlayerIds: [p1],
        })
      ).length
    ).toBeGreaterThan(0);
    expect(
      collectAuthoritySnapshotProblems(
        snapshotWith({
          mode: 'multiplayer',
          playerSeatLimit: 1,
          claimedPlayerIds: [p1],
        })
      ).length
    ).toBeGreaterThan(0);
  });

  // The snapshot invariant above catches a mismatched ceiling, but the
  // transition check is the first line of defence and was equally untested:
  // nothing referenced its problem string either.
  it('rejects a transition that changes the durable seat ceiling', () => {
    const current = snapshotWith({
      mode: 'solo',
      playerSeatLimit: 1,
      claimedPlayerIds: [p1],
    });
    const candidate: RoomAuthoritySnapshot = {
      ...current,
      authorityVersion: current.authorityVersion + 1,
      admission: { ...current.admission, playerSeatLimit: 2 },
    };
    const transaction: PersistedAuthorityTransaction = {
      expectedAuthorityVersion: current.authorityVersion,
      expectedRevision: current.state.revision,
      sessionId: `session-${p1}`,
      outcome: {
        commandId: 'command-one',
        clientSequence: 1,
        accepted: false,
        revision: current.state.revision,
        code: 'precondition_failed',
      },
      snapshot: candidate,
    };
    expect(() =>
      assertAuthorityTransactionTransition(current, transaction)
    ).toThrow(/player-seat limit|admission state/);
  });
});
