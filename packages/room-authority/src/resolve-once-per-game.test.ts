import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { emptyProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('once-owner');
const p2 = asPlayerId('once-opponent');

const state = createEmptyMatch(asMatchId('once-authority-match'), [
  { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
  { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
]);

const session = (playerId: typeof p1): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

describe('once-per-game authority resolution', () => {
  it('derives the target from public player identity and applies opponent policy', () => {
    const identities = emptyProjectionIdentityState();
    const opponentCommand = {
      type: 'SetOncePerGameMarker',
      targetPlayerId: p2,
      marker: 'gx',
      used: true,
    } as const;
    expect(
      resolveWireCommand(
        state,
        identities,
        session(p1),
        opponentCommand,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'SetOncePerGameMarker',
        playerId: p2,
        marker: 'gx',
        used: true,
      },
    });
    expect(
      resolveWireCommand(state, identities, session(p1), opponentCommand, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        state,
        identities,
        session(p1),
        { ...opponentCommand, targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        identities,
        session(p1),
        { ...opponentCommand, targetPlayerId: p1 },
        {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        }
      ).accepted
    ).toBe(true);
  });
});
