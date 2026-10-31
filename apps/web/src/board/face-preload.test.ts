import {
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
  type ViewCard,
} from '@ptcgsim/game-core';
import {
  DEFAULT_BOARD_PRESENTATION,
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { facesAboutToTurn } from './face-preload.js';

const base = createRendererSpikeView();
const blue = base.playerOrder[0]!;
const deckId = `zone:${blue}:deck`;

/** The view with the blue deck made of cards its owner knows. */
const knownDeck = (): MatchViewState => {
  const definitions = { ...base.definitions };
  const cards = base.zones[deckId]!.cards.map((card, index): ViewCard => {
    const definitionId = asViewDefinitionId(`deck-${String(index)}`);
    definitions[definitionId] = {
      id: definitionId,
      name: `Deck card ${String(index)}`,
      category: 'Trainer',
      imageUrl: `https://cards.example/deck-${String(index)}.png`,
    };
    return {
      kind: 'known',
      id: card.id,
      definitionId,
      ownerId: card.ownerId,
      category: 'Trainer',
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      publiclyRevealed: false,
    };
  });
  return {
    ...base,
    definitions,
    zones: { ...base.zones, [deckId]: { ...base.zones[deckId]!, cards } },
  };
};
const sceneOf = (view: MatchViewState) =>
  createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: blue,
    splitRatio: 0.5,
    geometryVersion: 1,
  });

describe('facesAboutToTurn', () => {
  it("loads the face of the deck's top card its owner knows, and no other", () => {
    const view = knownDeck();
    const scene = sceneOf(view);
    const cover = scene.cards.find(
      (card) => card.renderKey === `cover:${deckId}`
    )!;
    expect(cover.tableImageUrl).not.toBe(cover.imageUrl);
    expect(facesAboutToTurn(view, scene, DEFAULT_BOARD_PRESENTATION)).toEqual([
      cover.imageUrl,
    ]);
  });

  it('loads nothing for a deck its viewer cannot see into', () => {
    const scene = sceneOf(base);
    expect(facesAboutToTurn(base, scene, DEFAULT_BOARD_PRESENTATION)).toEqual(
      []
    );
  });

  it('loads the face of a known face-down card being carried', () => {
    const definitionId = asViewDefinitionId('carried');
    const carried: ViewCard = {
      kind: 'known',
      id: asViewCardId('carried-card'),
      definitionId,
      ownerId: blue,
      category: 'Trainer',
      face: 'down',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      publiclyRevealed: false,
    };
    const boardId = `zone:${blue}:board`;
    const view: MatchViewState = {
      ...base,
      definitions: {
        ...base.definitions,
        [definitionId]: {
          id: definitionId,
          name: 'Carried',
          category: 'Trainer',
          imageUrl: 'https://cards.example/carried.png',
          imageUrlSmall: 'https://cards.example/carried-small.png',
        },
      },
      zones: {
        ...base.zones,
        [boardId]: {
          ...base.zones[boardId]!,
          cards: [...base.zones[boardId]!.cards, carried],
        },
      },
    };
    const scene = sceneOf(view);
    expect(facesAboutToTurn(view, scene, DEFAULT_BOARD_PRESENTATION)).toEqual(
      []
    );
    expect(
      facesAboutToTurn(view, scene, {
        drag: { cardId: carried.id, x: 0, y: 0, targetId: null },
      })
    ).toEqual(['https://cards.example/carried-small.png']);
  });
});
