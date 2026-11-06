import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('coin-authority-one');
const p2 = asPlayerId('coin-authority-two');
const state = createEmptyMatch(asMatchId('coin-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const playerSession: AuthoritySession = {
  id: 'coin-player-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};
const spectatorSession: AuthoritySession = {
  ...playerSession,
  id: 'coin-spectator-session',
  viewer: { kind: 'spectator' },
};
const identities = { cardAliases: [], definitionAliases: [] };
const coin = 'design:1.gold.rays.ink.ball-poke';

describe('coin authority resolution', () => {
  it('allows a multiplayer player to set their own coin', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        { type: 'SetCoin', coin },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: { type: 'SetCoin', playerId: p1, coin },
    });
  });

  it('rejects multiplayer cross-seat changes regardless of public interaction policy', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        { type: 'SetCoin', targetPlayerId: p2, coin },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('allows the solo controller to change either side', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        { type: 'SetCoin', targetPlayerId: p2, coin },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo' }
      )
    ).toEqual({
      accepted: true,
      command: { type: 'SetCoin', playerId: p2, coin },
    });
  });

  it('rejects spectators, stale revisions, and missing targets', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        spectatorSession,
        { type: 'SetCoin', coin },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        { ...state, revision: 1 },
        identities,
        playerSession,
        { type: 'SetCoin', coin },
        DEFAULT_AUTHORITY_POLICY,
        0
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        {
          type: 'SetCoin',
          targetPlayerId: 'missing-player',
          coin,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });
});
