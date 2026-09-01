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

import type { ProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('visibility-authority-blue');
const p2 = asPlayerId('visibility-authority-red');

const context: CommandContext = {
  nextCardId: (_definitionId, index) =>
    asCardInstanceId(`visibility-authority-card-${index}`),
  nextStackId: () => asStackId('visibility-authority-stack'),
  nextInspectionId: () => asInspectionId('visibility-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('visibility-authority-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const session = (playerId: typeof p1): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

const fixture = (): {
  readonly state: MatchState;
  readonly prizeId: ReturnType<typeof playerZoneId>;
  readonly cardIds: readonly ReturnType<typeof asCardInstanceId>[];
  readonly identities: ProjectionIdentityState;
  readonly ownerAliases: readonly string[];
  readonly opponentAliases: readonly string[];
} => {
  let state = createEmptyMatch(asMatchId('visibility-authority-match'), [
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
            id: asCardDefinitionId('visibility-authority-definition'),
            name: 'Visibility card',
            category: 'Pokémon',
            imageUrl: '/visibility.png',
          },
          count: 14,
        },
      ],
    },
    context
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  const setup = executeCommand(
    loaded.state,
    { type: 'SetupPlayer', playerId: p1 },
    context
  );
  if (!setup.accepted) throw new Error(setup.message);
  state = setup.state;
  const prizeId = playerZoneId(p1, 'prizes');
  const cardIds = state.zones[prizeId]!.cardIds;
  const ownerAliases = cardIds.map((_, index) => `owner-prize-${index}`);
  const opponentAliases = cardIds.map((_, index) => `opponent-prize-${index}`);
  const identities: ProjectionIdentityState = {
    cardAliases: cardIds.flatMap((cardId, index) => [
      {
        alias: ownerAliases[index]!,
        viewerKey: `player:${p1}`,
        cardId,
        visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
        known: false,
      },
      {
        alias: opponentAliases[index]!,
        viewerKey: `player:${p2}`,
        cardId,
        visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
        known: false,
      },
    ]),
    definitionAliases: [],
  };
  return {
    state,
    prizeId,
    cardIds,
    identities,
    ownerAliases,
    opponentAliases,
  };
};

describe('public visibility authority resolution', () => {
  it('resolves an owner selective reveal against its exact source', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'SetPublicReveal',
          cardId: prepared.ownerAliases[0]!,
          expectedSourceId: prepared.prizeId,
          revealed: true,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId: prepared.cardIds[0],
        expectedSourceId: prepared.prizeId,
        revealed: true,
      },
    });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'SetPublicReveal',
          cardId: prepared.ownerAliases[0]!,
          expectedSourceId: playerZoneId(p1, 'hand'),
          revealed: true,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('forbids selective reveal of an unknown opponent card', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        {
          type: 'SetPublicReveal',
          cardId: prepared.opponentAliases[0]!,
          expectedSourceId: prepared.prizeId,
          revealed: true,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('allows exact whole-prize interaction only under room policy', () => {
    const prepared = fixture();
    const wire = {
      type: 'SetZonePublicReveal',
      targetPlayerId: p1,
      zoneId: prepared.prizeId,
      expectedCardIds: prepared.opponentAliases,
      revealed: true,
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prepared.prizeId,
        expectedCardIds: prepared.cardIds,
        revealed: true,
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

  it('rejects stale revisions, aliases, order, and spectators', () => {
    const prepared = fixture();
    const wire = {
      type: 'SetZonePublicReveal',
      targetPlayerId: p1,
      zoneId: prepared.prizeId,
      expectedCardIds: prepared.ownerAliases,
      revealed: true,
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        wire,
        DEFAULT_AUTHORITY_POLICY,
        prepared.state.revision - 1
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          ...wire,
          expectedCardIds: [...prepared.ownerAliases].reverse(),
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { ...wire, expectedCardIds: ['missing-card'] },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        {
          id: 'spectator',
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
