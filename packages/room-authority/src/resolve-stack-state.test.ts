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
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { emptyProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('marker-owner');
const p2 = asPlayerId('marker-opponent');

const commandContext: CommandContext = {
  nextCardId: () => asCardInstanceId('marker-card'),
  nextStackId: () => asStackId('marker-stack'),
  nextInspectionId: () => asInspectionId('marker-inspection'),
  nextWorkAreaId: () => asWorkAreaId('marker-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const playerSession = (playerId: typeof p1): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

const stateWithStack = (): MatchState => {
  let state = createEmptyMatch(asMatchId('marker-authority-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = executeCommand(
    state,
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('marker-definition'),
            name: 'Marker Pokémon',
            category: 'Pokémon',
            imageUrl: '/marker.png',
          },
          count: 1,
        },
      ],
    },
    commandContext
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  state = loaded.state;
  const moved = executeCommand(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  if (!moved.accepted) throw new Error(moved.message);
  return moved.state;
};

describe('stack-state authority resolution', () => {
  it('derives control from the session and applies the opponent-interaction policy', () => {
    const state = stateWithStack();
    const stackId = state.boards[p1]!.activeStackId!;
    const identities = emptyProjectionIdentityState();
    const wire = { type: 'SetDamage', stackId, damage: 50 } as const;
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession(p1),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toMatchObject({
      accepted: true,
      command: { type: 'SetDamage', stackId, damage: 50 },
    });
    expect(
      resolveWireCommand(
        state,
        identities,
        playerSession(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      ).accepted
    ).toBe(true);
    expect(
      resolveWireCommand(state, identities, playerSession(p2), wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        state,
        identities,
        {
          id: 'spectator-session',
          viewer: { kind: 'spectator' },
          active: true,
          nextClientSequence: 1,
          recentOutcomes: [],
        },
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
