import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  playerZoneId,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';
import type { WireGameCommand } from '@ptcgsim/protocol';

const p1 = asPlayerId('zone-ownership-one');
const p2 = asPlayerId('zone-ownership-two');
const state = createEmptyMatch(asMatchId('zone-ownership-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const session: AuthoritySession = {
  id: 'zone-ownership-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const resolve = (command: WireGameCommand) =>
  resolveWireCommand(
    state,
    { cardAliases: [], definitionAliases: [] },
    session,
    command,
    DEFAULT_AUTHORITY_POLICY
  );

const own = (kind: 'deck' | 'hand' | 'discard') => playerZoneId(p1, kind);
const theirs = (kind: 'deck' | 'hand' | 'discard') => playerZoneId(p2, kind);

/**
 * Bulk zone commands name their zones directly, so the only thing keeping a
 * player out of the opponent's deck, hand or discard is an `ownerId !== actorId`
 * check inside the resolver.
 *
 * Those checks existed but were untested: removing any one of them left the
 * whole authority suite green, so nothing would have caught a refactor that
 * let a player shuffle an opponent's deck or move their hand into it. The
 * server is the only line of defence here, because these are wire commands and
 * a client can send them regardless of what the UI offers.
 */
describe('zone ownership authority', () => {
  const foreignCases: readonly (readonly [string, WireGameCommand])[] = [
    ['ShuffleZone', { type: 'ShuffleZone', zoneId: theirs('deck') }],
    [
      'MoveZoneContents from a foreign source',
      {
        type: 'MoveZoneContents',
        sourceZoneId: theirs('hand'),
        destinationZoneId: own('discard'),
      },
    ],
    [
      'MoveZoneContents into a foreign destination',
      {
        type: 'MoveZoneContents',
        sourceZoneId: own('hand'),
        destinationZoneId: theirs('discard'),
      },
    ],
    [
      'ShuffleZoneIntoDeck',
      {
        type: 'ShuffleZoneIntoDeck',
        playerId: p1,
        sourceZoneId: theirs('hand'),
      },
    ],
    [
      'ShuffleZoneToDeckBottom',
      {
        type: 'ShuffleZoneToDeckBottom',
        playerId: p1,
        sourceZoneId: theirs('hand'),
      },
    ],
  ];

  it.each(foreignCases)('refuses %s', (_label, command) => {
    expect(resolve(command)).toEqual({
      accepted: false,
      code: 'unauthorized',
    });
  });

  const ownCases: readonly (readonly [string, WireGameCommand])[] = [
    ['ShuffleZone', { type: 'ShuffleZone', zoneId: own('deck') }],
    [
      'MoveZoneContents',
      {
        type: 'MoveZoneContents',
        sourceZoneId: own('hand'),
        destinationZoneId: own('discard'),
      },
    ],
    [
      'ShuffleZoneIntoDeck',
      { type: 'ShuffleZoneIntoDeck', playerId: p1, sourceZoneId: own('hand') },
    ],
    [
      'ShuffleZoneToDeckBottom',
      {
        type: 'ShuffleZoneToDeckBottom',
        playerId: p1,
        sourceZoneId: own('hand'),
      },
    ],
  ];

  // The refusals above would also pass if the resolver rejected everything, so
  // pin that the same commands are accepted against the actor's own zones.
  it.each(ownCases)(
    'accepts %s against the actor own zone',
    (_label, command) => {
      expect(resolve(command)).toMatchObject({ accepted: true });
    }
  );
});
