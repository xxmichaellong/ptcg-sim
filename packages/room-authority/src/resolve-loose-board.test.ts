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
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('loose-owner');
const p2 = asPlayerId('loose-opponent');

const context: CommandContext = {
  nextCardId: () => asCardInstanceId('loose-authority-card'),
  nextStackId: () => asStackId('loose-authority-stack'),
  nextInspectionId: () => asInspectionId('loose-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('loose-authority-work-area'),
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

const fixture = () => {
  let state = createEmptyMatch(asMatchId('loose-authority-match'), [
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
            id: asCardDefinitionId('loose-authority-definition'),
            name: 'Loose board card',
            category: 'Trainer',
            imageUrl: '/loose-authority.png',
          },
          count: 1,
        },
      ],
    },
    context
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  state = loaded.state;
  const cardId = state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
  const moved = executeCommand(
    state,
    {
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      destinationZoneId: playerZoneId(p1, 'board'),
    },
    context
  );
  if (!moved.accepted) throw new Error(moved.message);
  const ownerAlias = 'loose-owner-card-alias-001';
  const opponentAlias = 'loose-opponent-alias-0001';
  const identities: ProjectionIdentityState = {
    cardAliases: [
      {
        alias: ownerAlias,
        viewerKey: `player:${p1}`,
        cardId,
        visibilityGeneration: moved.state.cards[cardId]!.visibilityGeneration,
        known: true,
      },
      {
        alias: opponentAlias,
        viewerKey: `player:${p2}`,
        cardId,
        visibilityGeneration: moved.state.cards[cardId]!.visibilityGeneration,
        known: true,
      },
    ],
    definitionAliases: [],
  };
  return { state: moved.state, cardId, ownerAlias, opponentAlias, identities };
};

describe('loose-board authority resolution', () => {
  it('resolves exact aliases and policy-gates opponent board actions', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'ResolveLooseBoardCards',
          targetPlayerId: p1,
          expectedBoardCardIds: [prepared.ownerAlias],
          destination: 'hand',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'ResolveLooseBoardCards',
        playerId: p1,
        expectedBoardCardIds: [prepared.cardId],
        destination: 'hand',
      },
    });
    const opponentCommand = {
      type: 'ResolveLooseBoardCards',
      targetPlayerId: p1,
      expectedBoardCardIds: [prepared.opponentAlias],
      destination: 'discard',
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        opponentCommand,
        DEFAULT_AUTHORITY_POLICY
      ).accepted
    ).toBe(true);
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        opponentCommand,
        {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('rejects stale target players, aliases, and board order', () => {
    const prepared = fixture();
    const base = {
      type: 'ResolveLooseBoardCards',
      targetPlayerId: p1,
      expectedBoardCardIds: [prepared.ownerAlias],
      destination: 'discard',
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { ...base, targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { ...base, expectedBoardCardIds: ['missing-card-alias'] },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          ...base,
          expectedBoardCardIds: [prepared.ownerAlias, prepared.ownerAlias],
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('rejects generic zone commands aimed at the loose board', () => {
    const prepared = fixture();
    const boardId = playerZoneId(p1, 'board');
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'MoveZoneContents',
          sourceZoneId: boardId,
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'precondition_failed' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { type: 'ShuffleZoneIntoDeck', sourceZoneId: boardId },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'precondition_failed' });
  });
});
