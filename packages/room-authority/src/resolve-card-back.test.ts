import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('card-back-authority-one');
const p2 = asPlayerId('card-back-authority-two');
const state = createEmptyMatch(asMatchId('card-back-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const playerSession: AuthoritySession = {
  id: 'card-back-player-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};
const spectatorSession: AuthoritySession = {
  ...playerSession,
  id: 'card-back-spectator-session',
  viewer: { kind: 'spectator' },
};
const identities = { cardAliases: [], definitionAliases: [] };
const cardBackUrl = 'https://player-images.example/custom-back.png?version=2';

describe('card-back authority resolution', () => {
  it('allows a multiplayer player to set their own arbitrary URL exactly', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        { type: 'SetCardBack', cardBackUrl },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: { type: 'SetCardBack', playerId: p1, cardBackUrl },
    });
  });

  it('rejects multiplayer cross-seat changes regardless of public interaction policy', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession,
        { type: 'SetCardBack', targetPlayerId: p2, cardBackUrl },
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
        { type: 'SetCardBack', targetPlayerId: p2, cardBackUrl },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo' }
      )
    ).toEqual({
      accepted: true,
      command: { type: 'SetCardBack', playerId: p2, cardBackUrl },
    });
  });

  it('rejects spectators, stale revisions, and missing targets', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        spectatorSession,
        { type: 'SetCardBack', cardBackUrl },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        { ...state, revision: 1 },
        identities,
        playerSession,
        { type: 'SetCardBack', cardBackUrl },
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
          type: 'SetCardBack',
          targetPlayerId: 'missing-player',
          cardBackUrl,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });
});
