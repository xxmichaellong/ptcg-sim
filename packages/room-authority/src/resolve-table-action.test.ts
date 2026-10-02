import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('table-authority-one');
const p2 = asPlayerId('table-authority-two');
const state = createEmptyMatch(asMatchId('table-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);
const session: AuthoritySession = {
  id: 'table-authority-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

describe('table-action authority resolution', () => {
  it.each([
    ['StartTurn', 'StartTurn'],
    ['DeclareAttack', 'DeclareAttack'],
    ['PassTurn', 'PassTurn'],
  ] as const)(
    'resolves %s to a target-aware canonical command',
    (wireType, type) => {
      expect(
        resolveWireCommand(
          state,
          { cardAliases: [], definitionAliases: [] },
          session,
          { type: wireType, targetPlayerId: p2 },
          DEFAULT_AUTHORITY_POLICY
        )
      ).toEqual({ accepted: true, command: { type, playerId: p2 } });
    }
  );

  it('policy-gates opponent actions and rejects unknown targets', () => {
    expect(
      resolveWireCommand(
        state,
        { cardAliases: [], definitionAliases: [] },
        session,
        { type: 'DeclareAttack', targetPlayerId: p2 },
        {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        state,
        { cardAliases: [], definitionAliases: [] },
        session,
        { type: 'PassTurn', targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('requires the complete table snapshot to be current', () => {
    expect(
      resolveWireCommand(
        state,
        { cardAliases: [], definitionAliases: [] },
        session,
        { type: 'StartTurn', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision - 1
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });
});
