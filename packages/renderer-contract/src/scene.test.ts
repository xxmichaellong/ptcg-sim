import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_VIEWPORT } from './defaults.js';
import { layoutPlayerZone } from './geometry.js';
import {
  createBoardSceneForViewport,
  diffBoardScenes,
  hitTestBoardScene,
} from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const knownCardId = asViewCardId('view-card-known');
const hiddenCardId = asViewCardId('view-card-hidden');
const definitionId = asViewDefinitionId('view-definition-known');

const createView = (): MatchViewState => ({
  matchId: 'match-renderer-contract',
  revision: 7,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: p1 },
  playerOrder: [p1, p2],
  players: {
    [p1]: {
      id: p1,
      displayName: 'Blue',
      cardBackUrl: '/blue-back.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    [p2]: {
      id: p2,
      displayName: 'Red',
      cardBackUrl: '/red-back.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {
    [definitionId]: {
      id: definitionId,
      name: 'Visible Pokémon',
      category: 'Pokémon',
      imageUrl: 'https://cards.invalid/full-secret.png',
      imageUrlSmall: 'https://cards.invalid/board-visible.png',
    },
  },
  zones: {
    'zone:p1:hand': {
      id: 'zone:p1:hand',
      kind: 'hand',
      ownerId: p1,
      cards: [
        {
          kind: 'known',
          id: knownCardId,
          definitionId,
          ownerId: p1,
          category: 'Pokémon',
          face: 'up',
          orientationQuarterTurns: 0,
          abilityUsed: false,
        },
      ],
    },
    'zone:p2:deck': {
      id: 'zone:p2:deck',
      kind: 'deck',
      ownerId: p2,
      cards: [
        {
          kind: 'concealed',
          id: hiddenCardId,
          ownerId: p2,
          cardBackUrl: '/red-back.png',
        },
      ],
    },
    'zone:shared:stadium': {
      id: 'zone:shared:stadium',
      kind: 'stadium',
      ownerId: null,
      cards: [],
    },
  },
  boards: {
    [p1]: { activeStackId: null, benchStackIds: [] },
    [p2]: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    [p1]: { inspection: null, attachmentResolution: null },
    [p2]: { inspection: null, attachmentResolution: null },
  },
  turn: { number: 2, currentPlayerId: p1 },
});

const options = {
  viewport: DEFAULT_BOARD_VIEWPORT,
  bottomPlayerId: p1,
  splitRatio: 0.5,
  geometryVersion: 1 as const,
};

describe('renderer-neutral board scene', () => {
  it('transcribes legacy player-half geometry without depending on CSS layout', () => {
    expect(layoutPlayerZone('hand', 'local', options)).toEqual({
      x: 0,
      y: 765,
      width: 1208,
      height: 135,
    });
    const opponentDeck = layoutPlayerZone('deck', 'opponent', options);
    expect(opponentDeck.x).toBeCloseTo(12.08);
    expect(opponentDeck).toMatchObject({
      y: 297,
      width: 96.64,
      height: 112.5,
    });
    const opponentBoard = layoutPlayerZone('board', 'opponent', options);
    expect(opponentBoard.x).toBeCloseTo(797.28);
    expect(opponentBoard.y).toBeCloseTo(274.5);
    expect(opponentBoard).toMatchObject({
      width: 265.76,
      height: 135,
    });
  });

  it('uses board-tier face images only for visible cards and backs for concealed cards', () => {
    const scene = createBoardSceneForViewport(createView(), options);
    const known = scene.cards.find((card) => card.id === knownCardId);
    const hidden = scene.cards.find((card) => card.id === hiddenCardId);
    expect(known).toMatchObject({
      imageUrl: 'https://cards.invalid/board-visible.png',
      concealed: false,
      label: 'Visible Pokémon',
    });
    expect(hidden).toMatchObject({
      imageUrl: '/red-back.png',
      concealed: true,
      label: 'Face-down card',
      rotationQuarterTurns: 2,
    });
    expect(JSON.stringify(hidden)).not.toContain('full-secret');
  });

  it('composes BREAK offsets with group rotation and projects per-card ability markers', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const stadiumCard = stadium.cards[0]!;
    const stack = base.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    const attachment = stack.attachmentCards[0]!;
    if (
      stadiumCard.kind !== 'known' ||
      top.kind !== 'known' ||
      attachment.kind !== 'known'
    ) {
      throw new Error('Spike annotation cards must be known');
    }
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [stadium.id]: {
          ...stadium,
          cards: [
            {
              ...stadiumCard,
              orientationQuarterTurns: 1,
              abilityUsed: true,
            },
          ],
        },
      },
      stacks: {
        ...base.stacks,
        [stack.id]: {
          ...stack,
          rotationQuarterTurns: 1,
          evolutionCards: [
            ...stack.evolutionCards.slice(0, -1),
            { ...top, orientationQuarterTurns: 1 },
          ],
          attachmentCards: [
            { ...attachment, abilityUsed: true },
            ...stack.attachmentCards.slice(1),
          ],
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      ...options,
      bottomPlayerId: view.playerOrder[0]!,
    });
    expect(
      scene.cards.find((card) => card.id === stadiumCard.id)
        ?.rotationQuarterTurns
    ).toBe(1);
    expect(
      scene.cards.find((card) => card.id === top.id)?.rotationQuarterTurns
    ).toBe(2);
    expect(scene.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${stadiumCard.id}:abilityUsed`,
          parentCardId: stadiumCard.id,
        }),
        expect.objectContaining({
          id: `${attachment.id}:abilityUsed`,
          parentCardId: attachment.id,
        }),
      ])
    );
  });

  it('builds the shared 61-card spike and keeps index zero visually atop cover piles', () => {
    const view = createRendererSpikeView();
    const scene = createBoardSceneForViewport(view, {
      ...options,
      bottomPlayerId: view.playerOrder[0]!,
    });
    expect(scene.cards).toHaveLength(61);
    const blueDeck = view.zones['zone:spike-blue:deck']!;
    const first = scene.cards.find(
      (card) => card.id === blueDeck.cards[0]!.id
    )!;
    const second = scene.cards.find(
      (card) => card.id === blueDeck.cards[1]!.id
    )!;
    expect(first.zIndex).toBeGreaterThan(second.zIndex);
    expect(
      scene.zones.some((zone) => zone.id === 'slot:spike-blue:bench')
    ).toBe(true);
  });

  it('rejects a projection that places one view card in multiple render locations', () => {
    const view = createView();
    const duplicated: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        'zone:p1:discard': {
          id: 'zone:p1:discard',
          kind: 'discard',
          ownerId: p1,
          cards: view.zones['zone:p1:hand']!.cards,
        },
      },
    };
    expect(() => createBoardSceneForViewport(duplicated, options)).toThrow(
      'Projected card appears more than once'
    );
  });

  it('rejects player-owned stadiums and shared player zones', () => {
    const view = createView();
    const stadium = view.zones['zone:shared:stadium']!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...view,
          zones: {
            ...view.zones,
            [stadium.id]: { ...stadium, ownerId: p1 },
          },
        },
        options
      )
    ).toThrow('Stadium zone must be shared');

    const hand = view.zones['zone:p1:hand']!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...view,
          zones: {
            ...view.zones,
            [hand.id]: { ...hand, ownerId: null },
          },
        },
        options
      )
    ).toThrow('hand zone must belong to a player');
  });

  it('diffs by stable view identity and hit-tests the topmost card before its zone', () => {
    const first = createBoardSceneForViewport(createView(), options);
    const moved = createBoardSceneForViewport(createView(), {
      ...options,
      viewport: { ...options.viewport, width: 1000 },
    });
    const diff = diffBoardScenes(first, moved);
    expect(diff.addedCardIds).toEqual([]);
    expect(diff.removedCardIds).toEqual([]);
    expect(new Set(diff.updatedCardIds)).toEqual(
      new Set([hiddenCardId, knownCardId])
    );

    const known = first.cards.find((card) => card.id === knownCardId)!;
    expect(
      hitTestBoardScene(
        first,
        known.bounds.x + known.bounds.width / 2,
        known.bounds.y + known.bounds.height / 2
      )
    ).toEqual({ kind: 'card', id: knownCardId });
  });

  it('fails closed for invalid viewports and unsafe split ratios', () => {
    expect(() =>
      createBoardSceneForViewport(createView(), {
        ...options,
        viewport: { width: 0, height: 900, devicePixelRatio: 1 },
      })
    ).toThrow('positive');
    expect(() =>
      createBoardSceneForViewport(createView(), {
        ...options,
        splitRatio: 0.99,
      })
    ).toThrow('between 0.2 and 0.8');
  });
});
