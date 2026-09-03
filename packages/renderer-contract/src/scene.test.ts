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
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
} from './layout.js';
import {
  createBoardScene,
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

  it('builds the shared 61-card spike with legacy pile-top paint and input priority', () => {
    const base = createRendererSpikeView();
    const baseDiscard = base.zones['zone:spike-blue:discard']!;
    const coveredCard = baseDiscard.cards[0]!;
    const coverCard = baseDiscard.cards.at(-1)!;
    if (coveredCard.kind !== 'known' || coverCard.kind !== 'known') {
      throw new Error('Spike discard fixture must be known');
    }
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [baseDiscard.id]: {
          ...baseDiscard,
          cards: [
            { ...coveredCard, abilityUsed: true },
            ...baseDiscard.cards.slice(1, -1),
            { ...coverCard, abilityUsed: true },
          ],
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      ...options,
      bottomPlayerId: view.playerOrder[0]!,
    });
    expect(scene.cards).toHaveLength(61);
    const blueDeck = view.zones['zone:spike-blue:deck']!;
    const blueDiscard = view.zones['zone:spike-blue:discard']!;
    const blueLostZone = view.zones['zone:spike-blue:lostZone']!;
    for (const [zone, topIndex] of [
      [blueDeck, 0],
      [blueDiscard, blueDiscard.cards.length - 1],
      [blueLostZone, blueLostZone.cards.length - 1],
    ] as const) {
      const nodes = zone.cards.map((card) =>
        scene.cards.find((candidate) => candidate.id === card.id)
      );
      expect(nodes.every((node) => node !== undefined)).toBe(true);
      expect(nodes.filter((node) => node?.interactive)).toHaveLength(1);
      expect(nodes[topIndex]).toMatchObject({ interactive: true });
      expect(nodes[topIndex]!.zIndex).toBe(
        Math.max(...nodes.map((node) => node!.zIndex))
      );
      expect(
        scene.cards.filter(
          (node) => node.parentId === zone.id && !node.interactive
        )
      ).toHaveLength(zone.cards.length - 1);
    }
    expect(
      scene.markers.some((marker) =>
        scene.cards.some(
          (card) => card.id === marker.parentCardId && !card.interactive
        )
      )
    ).toBe(false);
    expect(
      scene.markers.some(
        (marker) =>
          marker.parentCardId === coveredCard.id ||
          marker.parentCardId === coverCard.id
      )
    ).toBe(false);
    expect(
      scene.zones.some((zone) => zone.id === 'slot:spike-blue:bench')
    ).toBe(true);
  });

  it('uses canonical contained geometry for covers without definition-size leakage', () => {
    const concealedScene = createBoardSceneForViewport(createView(), options);
    const concealed = concealedScene.cards.find(
      (card) => card.id === hiddenCardId
    )!;
    const expectedWidth = concealed.bounds.height * (63 / 88);
    expect(concealed.bounds.width).toBeCloseTo(expectedWidth);
    const parent = concealedScene.zones.find(
      (zone) => zone.id === concealed.parentId
    )!;
    expect(concealed.bounds.x).toBeCloseTo(
      parent.contentBounds.x +
        (parent.contentBounds.width - concealed.bounds.width) / 2
    );
    expect(concealed.bounds.y + concealed.bounds.height).toBeCloseTo(
      parent.contentBounds.y + parent.contentBounds.height
    );

    const visibleDeckCardId = asViewCardId('view-card-visible-deck');
    const base = createView();
    const deck = base.zones['zone:p2:deck']!;
    const visibleScene = createBoardSceneForViewport(
      {
        ...base,
        zones: {
          ...base.zones,
          [deck.id]: {
            ...deck,
            cards: [
              {
                kind: 'known',
                id: visibleDeckCardId,
                definitionId,
                ownerId: p2,
                category: 'Pokémon',
                face: 'up',
                orientationQuarterTurns: 0,
                abilityUsed: false,
                publiclyRevealed: true,
              },
            ],
          },
        },
      },
      options
    );
    expect(
      visibleScene.cards.find((card) => card.id === visibleDeckCardId)?.bounds
    ).toEqual(concealed.bounds);
  });

  it('resolves width-limited cover alignment after asymmetric frame rotation', () => {
    const base = createView();
    const opponentDeck = base.zones['zone:p2:deck']!;
    const localDeckCardId = asViewCardId('view-card-local-deck');
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        'zone:p1:deck': {
          id: 'zone:p1:deck',
          kind: 'deck',
          ownerId: p1,
          cards: [
            {
              kind: 'concealed',
              id: localDeckCardId,
              ownerId: p1,
              cardBackUrl: '/blue-back.png',
              publiclyRevealed: false,
            },
          ],
        },
      },
    };
    const scene = createBoardScene(
      view,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
        playerIds: [p1, p2],
        bottomPlayerId: p1,
        shellMode: 'sidebar',
        vertical: {
          lowerFrame: { bottomRatio: 0, heightRatio: 0.7 },
          upperFrame: { bottomRatio: 0.3, heightRatio: 0.7 },
          lowerHandle: { bottomRatio: 0.5, heightRatio: 0.025 },
          upperHandle: { bottomRatio: 0.525, heightRatio: 0.025 },
          sharedPlacement: 'cssDefault',
        },
      })
    );
    const local = scene.cards.find((card) => card.id === localDeckCardId)!;
    const opponent = scene.cards.find(
      (card) => card.id === opponentDeck.cards[0]!.id
    )!;
    const localZone = scene.zones.find((zone) => zone.id === local.parentId)!;
    const opponentZone = scene.zones.find(
      (zone) => zone.id === opponent.parentId
    )!;
    expect(local.bounds.height).toBeLessThan(localZone.contentBounds.height);
    expect(opponent.bounds.height).toBeLessThan(
      opponentZone.contentBounds.height
    );
    expect(local.bounds.y).toBeCloseTo(localZone.contentBounds.y);
    expect(opponent.bounds.y + opponent.bounds.height).toBeCloseTo(
      opponentZone.contentBounds.y + opponentZone.contentBounds.height
    );
    expect(local.rotationQuarterTurns).toBe(0);
    expect(opponent.rotationQuarterTurns).toBe(2);
  });

  it('keeps the stadium readable to its owner and composes explicit rotation', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const stadiumCard = stadium.cards[0]!;
    if (stadiumCard.kind !== 'known') {
      throw new Error('Spike stadium fixture must be known');
    }
    const bottomPlayerId = base.playerOrder[0]!;
    const topPlayerId = base.playerOrder[1]!;
    const ownedByTop: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [stadium.id]: {
          ...stadium,
          cards: [
            {
              ...stadiumCard,
              ownerId: topPlayerId,
              orientationQuarterTurns: 1,
            },
          ],
        },
      },
    };
    const topOwnerScene = createBoardSceneForViewport(ownedByTop, {
      ...options,
      bottomPlayerId,
    });
    const topOwner = topOwnerScene.cards.find(
      (card) => card.id === stadiumCard.id
    )!;
    const stadiumZone = topOwnerScene.zones.find(
      (zone) => zone.id === stadium.id
    )!;
    expect(topOwner.rotationQuarterTurns).toBe(3);
    expect(topOwner.bounds.y + topOwner.bounds.height).toBeCloseTo(
      stadiumZone.contentBounds.y + stadiumZone.contentBounds.height
    );

    const flipped = createBoardSceneForViewport(ownedByTop, {
      ...options,
      bottomPlayerId: topPlayerId,
    });
    const bottomOwner = flipped.cards.find(
      (card) => card.id === stadiumCard.id
    )!;
    expect(bottomOwner.rotationQuarterTurns).toBe(1);
    expect(bottomOwner.bounds.y).toBeCloseTo(
      flipped.zones.find((zone) => zone.id === stadium.id)!.contentBounds.y
    );
  });

  it('rejects a malformed projection with multiple stadium cards', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const first = stadium.cards[0]!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...base,
          zones: {
            ...base.zones,
            [stadium.id]: {
              ...stadium,
              cards: [
                first,
                { ...first, id: asViewCardId('second-stadium-card') },
              ],
            },
          },
        },
        { ...options, bottomPlayerId: base.playerOrder[0]! }
      )
    ).toThrow('at most one card');
  });

  it('rejects a projected card owner outside the two-player board', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const first = stadium.cards[0]!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...base,
          zones: {
            ...base.zones,
            [stadium.id]: {
              ...stadium,
              cards: [
                {
                  ...first,
                  ownerId: asPlayerId('not-a-projected-player'),
                },
              ],
            },
          },
        },
        { ...options, bottomPlayerId: base.playerOrder[0]! }
      )
    ).toThrow('owner is not a board player');
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
