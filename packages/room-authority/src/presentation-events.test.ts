import {
  asCardDefinitionId,
  asCardInstanceId,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  playerZoneId,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { presentationEventsForBatch } from './presentation-events.js';

const ownerId = asPlayerId('player-one');
const actorId = asPlayerId('player-two');
const cardId = asCardInstanceId('canonical-card-secret');
const definitionId = asCardDefinitionId('secret-definition-id');
const deckId = playerZoneId(ownerId, 'deck');

const stateWithSecret = (
  name: string,
  publiclyRevealed: boolean
): MatchState => {
  const empty = createEmptyMatch(asMatchId('presentation-test'), [
    {
      playerId: ownerId,
      displayName: 'Blue',
      cardBackUrl: '/blue-cardback.png',
    },
    {
      playerId: actorId,
      displayName: 'Red',
      cardBackUrl: '/red-cardback.png',
    },
  ]);
  return {
    ...empty,
    revision: 7,
    definitions: {
      [definitionId]: {
        id: definitionId,
        name,
        category: 'Pokémon',
        imageUrl: '/secret-image.png',
      },
    },
    cards: {
      [cardId]: {
        id: cardId,
        definitionId,
        ownerId,
        originalCategory: 'Pokémon',
        currentCategory: 'Pokémon',
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
        visibilityGeneration: 0,
      },
    },
    deckLists: { ...empty.deckLists, [ownerId]: [cardId] },
    zones: {
      ...empty.zones,
      [deckId]: { ...empty.zones[deckId]!, cardIds: [cardId] },
    },
    visibility: {
      ...empty.visibility,
      publicCardIds: publiclyRevealed ? [cardId] : [],
    },
  };
};

const publicRevealBatch = (revealed: boolean): EventBatch => ({
  revision: 7,
  events: [
    {
      type: 'PublicRevealSet',
      actorPlayerId: actorId,
      playerId: ownerId,
      scope: 'card',
      cardIds: [cardId],
      expectedSourceId: deckId,
      revealed,
      face: 'up',
    },
  ],
});

const inspectionBatch = (type: 'opened' | 'closed'): EventBatch => ({
  revision: 7,
  events:
    type === 'opened'
      ? [
          {
            type: 'InspectionGrantOpened',
            scope: 'card',
            inspectionId: 'inspection-secret',
            sourcePlayerId: ownerId,
            sourceId: deckId,
            expectedSourceCardIds: [cardId],
            cardIds: [cardId],
            viewerIds: [actorId],
          },
        ]
      : [
          {
            type: 'InspectionGrantClosed',
            scope: 'card',
            inspectionId: 'inspection-secret',
            sourcePlayerId: ownerId,
            sourceId: deckId,
            expectedCardIds: [cardId],
            expectedViewerIds: [actorId],
            viewerId: actorId,
          },
        ],
});

describe('presentation event privacy', () => {
  it('includes only the public name needed for single-card reveal parity', () => {
    const events = presentationEventsForBatch(
      publicRevealBatch(true),
      stateWithSecret('Public Pikachu', true)
    );

    expect(events).toEqual([
      {
        type: 'PublicCardsRevealed',
        revision: 7,
        actorPlayerId: actorId,
        playerId: ownerId,
        scope: 'card',
        source: 'deck',
        cardCount: 1,
        cardName: 'Public Pikachu',
      },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(cardId);
    expect(serialized).not.toContain(definitionId);
    expect(serialized).not.toContain('/secret-image.png');
  });

  it('keeps hide and private-inspection facts independent of hidden identity', () => {
    const alpha = stateWithSecret('Hidden Alpha', false);
    const beta = stateWithSecret('Hidden Beta', false);
    const batches = [
      publicRevealBatch(false),
      inspectionBatch('opened'),
      inspectionBatch('closed'),
    ];

    for (const batch of batches) {
      const alphaEvents = presentationEventsForBatch(batch, alpha);
      const betaEvents = presentationEventsForBatch(batch, beta);
      expect(alphaEvents).toEqual(betaEvents);
      const serialized = JSON.stringify(alphaEvents);
      expect(serialized).not.toContain('Hidden Alpha');
      expect(serialized).not.toContain(cardId);
      expect(serialized).not.toContain(definitionId);
      expect(serialized).not.toContain('/secret-image.png');
    }
  });

  it('fails closed if a single-card reveal is not spectator-visible', () => {
    expect(() =>
      presentationEventsForBatch(
        publicRevealBatch(true),
        stateWithSecret('Still hidden', false)
      )
    ).toThrow('not known to the spectator projection');
  });
});
