import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('lifecycle-authority-one');
const p2 = asPlayerId('lifecycle-authority-two');
const state = createEmptyMatch(asMatchId('lifecycle-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const session: AuthoritySession = {
  id: 'lifecycle-authority-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};
const identities = { cardAliases: [], definitionAliases: [] };

describe('lifecycle authority resolution', () => {
  it.each(['SetupPlayer', 'ResetPlayer'] as const)(
    'preserves actor-only wire compatibility for %s',
    (type) => {
      expect(
        resolveWireCommand(
          state,
          identities,
          session,
          { type },
          DEFAULT_AUTHORITY_POLICY
        )
      ).toEqual({ accepted: true, command: { type, playerId: p1 } });
    }
  );

  it.each(['SetupPlayer', 'ResetPlayer'] as const)(
    'resolves explicit opponent target for %s under room policy',
    (type) => {
      const wire = { type, targetPlayerId: p2 } as const;
      expect(
        resolveWireCommand(
          state,
          identities,
          session,
          wire,
          DEFAULT_AUTHORITY_POLICY
        )
      ).toEqual({ accepted: true, command: { type, playerId: p2 } });
      expect(
        resolveWireCommand(state, identities, session, wire, {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        })
      ).toEqual({ accepted: false, code: 'unauthorized' });
    }
  );

  it('rejects stale whole-table snapshots and unknown targets', () => {
    expect(
      resolveWireCommand(
        state,
        identities,
        session,
        { type: 'SetupPlayer' },
        DEFAULT_AUTHORITY_POLICY,
        state.revision - 1
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        identities,
        session,
        { type: 'ResetPlayer', targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('resolves deck replacement through the same explicit target policy', () => {
    const wire = {
      type: 'LoadDeck',
      targetPlayerId: p2,
      entries: [],
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
      command: { type: 'LoadDeck', playerId: p2, entries: [] },
    });
    expect(
      resolveWireCommand(state, identities, session, wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
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
  });
});
