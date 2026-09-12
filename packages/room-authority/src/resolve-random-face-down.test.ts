import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('random-authority-blue');
const p2 = asPlayerId('random-authority-red');
const state = createEmptyMatch(asMatchId('random-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const identities = { cardAliases: [], definitionAliases: [] };
const session: AuthoritySession = {
  id: 'random-authority-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

describe('random face-down authority resolution', () => {
  it('resolves a self target without accepting a card selector', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        session,
        { type: 'PlayRandomCardFaceDown', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
      },
    });
  });

  it('uses the public opponent-interaction policy for an opponent target', () => {
    const wire = {
      type: 'PlayRandomCardFaceDown',
      targetPlayerId: p2,
    } as const;
    expect(
      resolveWireCommand(
        state,
        identities,
        session,
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p2,
      },
    });
    expect(
      resolveWireCommand(state, identities, session, wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('rejects stale revisions, missing targets, and spectators', () => {
    const wire = {
      type: 'PlayRandomCardFaceDown',
      targetPlayerId: p1,
    } as const;
    expect(
      resolveWireCommand(
        { ...state, revision: 1 },
        identities,
        session,
        wire,
        DEFAULT_AUTHORITY_POLICY,
        0
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        identities,
        session,
        { ...wire, targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        identities,
        { ...session, viewer: { kind: 'spectator' } },
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
