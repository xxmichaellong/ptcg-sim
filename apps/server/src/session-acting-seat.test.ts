import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import { actingPlayerIdForSession } from './session-presentation-identity.js';

const blue = asPlayerId('seat-blue');
const red = asPlayerId('seat-red');

const snapshot = (input: {
  readonly mode: 'solo' | 'multiplayer';
  readonly coaching?: boolean;
}): RoomAuthoritySnapshot => {
  const base = createEmptyMatch(asMatchId('seat-room'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const state = input.coaching
    ? {
        ...base,
        players: Object.fromEntries(
          Object.entries(base.players).map(([id, player]) => [
            id,
            { ...player, coachingConsent: true },
          ])
        ) as typeof base.players,
      }
    : base;
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 1,
    mode: input.mode,
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {
      blue: {
        id: 'blue',
        viewer: { kind: 'player', playerId: blue },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      watcher: {
        id: 'watcher',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

describe('the seat an ephemeral declaration speaks for', () => {
  it('follows v1 flip rules and otherwise keeps the sender own seat', () => {
    const ordinary = snapshot({ mode: 'multiplayer' });
    // No request at all is the sender's seat.
    expect(actingPlayerIdForSession(ordinary, 'blue', undefined)).toBe(blue);
    // An ordinary room has no flipped acting seat to borrow.
    expect(actingPlayerIdForSession(ordinary, 'blue', red)).toBe(blue);

    // v1 flips in Solo, and in a room where both players enabled board flip.
    expect(
      actingPlayerIdForSession(snapshot({ mode: 'solo' }), 'blue', red)
    ).toBe(red);
    expect(
      actingPlayerIdForSession(
        snapshot({ mode: 'multiplayer', coaching: true }),
        'blue',
        red
      )
    ).toBe(red);

    // Never an arbitrary name, and never a seat for a spectator or a session
    // that is not in the room.
    expect(
      actingPlayerIdForSession(snapshot({ mode: 'solo' }), 'blue', 'nobody')
    ).toBe(blue);
    expect(
      actingPlayerIdForSession(snapshot({ mode: 'solo' }), 'watcher', red)
    ).toBeUndefined();
    expect(
      actingPlayerIdForSession(snapshot({ mode: 'solo' }), 'missing', red)
    ).toBeUndefined();
  });
});
