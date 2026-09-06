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
  stadiumZoneId,
  type CommandContext,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('stadium-authority-owner');
const p2 = asPlayerId('stadium-authority-opponent');

const context: CommandContext = {
  nextCardId: (definitionId, copyIndex) =>
    asCardInstanceId(`${definitionId}:card-${copyIndex}`),
  nextStackId: () => asStackId('stadium-authority-stack'),
  nextInspectionId: () => asInspectionId('stadium-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('stadium-authority-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const session = (playerId: typeof p1 | typeof p2): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

const fixture = (selectedZone: 'hand' | 'discard' = 'hand') => {
  let state = createEmptyMatch(asMatchId('stadium-authority-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const [playerId, suffix] of [
    [p1, 'owner'],
    [p2, 'opponent'],
  ] as const) {
    const loaded = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId,
        entries: [
          {
            definition: {
              id: asCardDefinitionId(`stadium-authority-${suffix}`),
              name: `${suffix} stadium`,
              category: 'Trainer',
              imageUrl: `/stadium-authority-${suffix}.png`,
            },
            count: 1,
          },
        ],
      },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
  }
  const selectedCardId = state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
  const incumbentCardId = state.zones[playerZoneId(p2, 'deck')]!.cardIds[0]!;
  const selectedZoneId = playerZoneId(p1, selectedZone);
  for (const command of [
    {
      type: 'MoveCard',
      cardId: selectedCardId,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      destinationZoneId: selectedZoneId,
    },
    {
      type: 'MoveCard',
      cardId: incumbentCardId,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      destinationZoneId: stadiumZoneId(),
    },
  ] as const) {
    const moved = executeCommand(state, command, context);
    if (!moved.accepted) throw new Error(moved.message);
    state = moved.state;
  }

  const ownerSelectedAlias = 'stadium-owner-selected-alias';
  const ownerIncumbentAlias = 'stadium-owner-incumbent-alias';
  const opponentSelectedAlias = 'stadium-opponent-selected-alias';
  const opponentIncumbentAlias = 'stadium-opponent-incumbent-alias';
  const identities: ProjectionIdentityState = {
    cardAliases: [
      [ownerSelectedAlias, p1, selectedCardId],
      [ownerIncumbentAlias, p1, incumbentCardId],
      [opponentSelectedAlias, p2, selectedCardId],
      [opponentIncumbentAlias, p2, incumbentCardId],
    ].map(([alias, viewerId, cardId]) => ({
      alias: String(alias),
      viewerKey: `player:${viewerId}`,
      cardId: asCardInstanceId(String(cardId)),
      visibilityGeneration: state.cards[String(cardId)]!.visibilityGeneration,
      known: true,
    })),
    definitionAliases: [],
  };
  return {
    state,
    selectedZoneId,
    selectedCardId,
    incumbentCardId,
    ownerSelectedAlias,
    ownerIncumbentAlias,
    opponentSelectedAlias,
    opponentIncumbentAlias,
    identities,
  };
};

describe('stadium movement authority resolution', () => {
  it('resolves both card aliases and derives source ownership from authority state', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'MoveCardToStadium',
          cardId: prepared.ownerSelectedAlias,
          expectedSourceId: playerZoneId(p1, 'hand'),
          expectedStadiumCardId: prepared.ownerIncumbentAlias,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId: prepared.selectedCardId,
        expectedSourceId: playerZoneId(p1, 'hand'),
        expectedStadiumCardId: prepared.incumbentCardId,
      },
    });
  });

  it('rejects stale source and incumbent aliases before domain execution', () => {
    const prepared = fixture();
    const base = {
      type: 'MoveCardToStadium',
      cardId: prepared.ownerSelectedAlias,
      expectedSourceId: playerZoneId(p1, 'hand'),
      expectedStadiumCardId: prepared.ownerIncumbentAlias,
    } as const;
    for (const command of [
      { ...base, expectedSourceId: playerZoneId(p1, 'discard') },
      { ...base, expectedStadiumCardId: null },
      { ...base, expectedStadiumCardId: 'missing-stadium-alias' },
    ]) {
      expect(
        resolveWireCommand(
          prepared.state,
          prepared.identities,
          session(p1),
          command,
          DEFAULT_AUTHORITY_POLICY
        )
      ).toEqual({ accepted: false, code: 'stale_reference' });
    }
  });

  it('applies the public opponent-interaction policy to the selected card only', () => {
    const prepared = fixture('discard');
    const wire = {
      type: 'MoveCardToStadium',
      cardId: prepared.opponentSelectedAlias,
      expectedSourceId: prepared.selectedZoneId,
      expectedStadiumCardId: prepared.opponentIncumbentAlias,
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toMatchObject({
      accepted: true,
      command: {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId: prepared.selectedCardId,
      },
    });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        wire,
        {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
