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

const p1 = asPlayerId('arrival-authority-blue');
const p2 = asPlayerId('arrival-authority-red');

let cardSequence = 0;
const context: CommandContext = {
  nextCardId: () =>
    asCardInstanceId(`arrival-authority-card-${++cardSequence}`),
  nextStackId: () => asStackId('arrival-authority-stack'),
  nextInspectionId: () => asInspectionId('arrival-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('arrival-authority-work'),
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

const run = (
  state: MatchState,
  command: Parameters<typeof executeCommand>[1]
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

/** Blue holds a hand and has an open deck-viewer popup; Red has neither. */
const fixture = () => {
  let state = createEmptyMatch(asMatchId('arrival-authority-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const playerId of [p1, p2]) {
    state = run(state, {
      type: 'LoadDeck',
      playerId,
      entries: [
        {
          definition: {
            id: asCardDefinitionId(`arrival-definition-${playerId}`),
            name: 'Arrival card',
            category: 'Pokémon',
            imageUrl: '/arrival.png',
          },
          count: 12,
        },
      ],
    });
    state = run(state, { type: 'DrawCards', playerId, count: 3 });
  }
  state = run(state, {
    type: 'ExtractDeckCardsForInspection',
    playerId: p1,
    viewerIds: [p1],
    count: 2,
    edge: 'top',
  });
  const handCardId = state.zones[playerZoneId(p1, 'hand')]!.cardIds[0]!;
  const opponentCardId = state.zones[playerZoneId(p2, 'hand')]!.cardIds[0]!;
  const alias = (cardId: string, viewerId: string, known: boolean) => ({
    alias: `alias-${viewerId}-${cardId}`,
    viewerKey: `player:${viewerId}`,
    cardId: asCardInstanceId(cardId),
    visibilityGeneration:
      state.cards[asCardInstanceId(cardId)]!.visibilityGeneration,
    known,
  });
  const identities: ProjectionIdentityState = {
    cardAliases: [
      alias(handCardId, p1, true),
      alias(opponentCardId, p1, false),
      alias(opponentCardId, p2, true),
    ],
    definitionAliases: [],
  };
  return {
    state,
    identities,
    handCardId,
    opponentCardId,
    workAreaId: state.workAreas[p1]!.inspection!.id,
  };
};

describe('work-area arrival authority resolution', () => {
  it('accepts a drop into the actor own open popup', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'MoveCardToWorkArea',
          cardId: `alias-${p1}-${prepared.handCardId}`,
          expectedWorkAreaId: prepared.workAreaId,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'MoveCardToWorkArea',
        cardId: prepared.handCardId,
        expectedWorkAreaId: prepared.workAreaId,
      },
    });
  });

  it('refuses a closed work area and another seat popup', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'MoveCardToWorkArea',
          cardId: `alias-${p1}-${prepared.handCardId}`,
          expectedWorkAreaId: 'arrival-authority-closed',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    // Red has no popup of their own, so Blue's popup id is not theirs to fill.
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        {
          type: 'MoveCardToWorkArea',
          cardId: `alias-${p2}-${prepared.opponentCardId}`,
          expectedWorkAreaId: prepared.workAreaId,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('applies the concealed-card control policy to the dragged card', () => {
    const prepared = fixture();
    // Blue cannot move a card they cannot read, whatever the popup.
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'MoveCardToWorkArea',
          cardId: `alias-${p1}-${prepared.opponentCardId}`,
          expectedWorkAreaId: prepared.workAreaId,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
