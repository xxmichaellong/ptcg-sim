import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
  type PlayerId,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_VIEWPORT } from './defaults.js';
import { resolveBoardDropTarget } from './drag.js';
import { CARD_ASPECT_RATIO, layoutPlayerZone } from './geometry.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  findBoardLayoutRegion,
  layoutLegacyActiveQ0Markers,
  layoutLegacyBenchQ0Markers,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacyPlayRow,
  layoutLegacyPlaySlotCards,
  layoutLegacySingleEnergyTrainerToolAttachmentStack,
  layoutLegacySingleEnergyAttachmentStack,
  layoutLegacySingleTrainerToolAttachmentStack,
  layoutLegacyTwoEnergyAttachmentStack,
  type BoardLayoutState,
} from './layout.js';
import {
  createBoardScene,
  createBoardSceneForViewport,
  diffBoardScenes,
  hitTestBoardScene,
} from './scene.js';
import type { Rect } from './model.js';
import { createRendererSpikeView } from './spike-fixture.js';

const p1 = asPlayerId('p1');

/** Bounds matcher that ignores last-bit float noise between equivalent formulas. */
const nearRect = (rect: Rect) => ({
  x: expect.closeTo(rect.x, 6),
  y: expect.closeTo(rect.y, 6),
  width: expect.closeTo(rect.width, 6),
  height: expect.closeTo(rect.height, 6),
});
const p2 = asPlayerId('p2');
const knownCardId = asViewCardId('view-card-known');
const hiddenCardId = asViewCardId('view-card-hidden');
const definitionId = asViewDefinitionId('view-definition-known');
const energyDefinitionId = asViewDefinitionId('view-definition-energy');
const trainerDefinitionId = asViewDefinitionId('view-definition-trainer');

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
    [energyDefinitionId]: {
      id: energyDefinitionId,
      name: 'Visible Energy',
      category: 'Energy',
      imageUrl: 'https://cards.invalid/full-energy.png',
      imageUrlSmall: 'https://cards.invalid/board-energy.png',
    },
    [trainerDefinitionId]: {
      id: trainerDefinitionId,
      name: 'Visible Trainer',
      category: 'Trainer',
      imageUrl: 'https://cards.invalid/full-trainer.png',
      imageUrlSmall: 'https://cards.invalid/board-trainer.png',
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
          publiclyRevealed: false,
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
          publiclyRevealed: false,
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
  privateInspections: [],
  turn: { number: 2, currentPlayerId: p1 },
});

const createOrdinaryEvolutionView = (): MatchViewState => {
  const base = createView();
  const card = (id: string, ownerId: typeof p1 | typeof p2) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: true,
  });
  const stack = (
    id: string,
    boardPlayerId: typeof p1 | typeof p2,
    slot: 'active' | 'bench'
  ) => ({
    id,
    boardPlayerId,
    slot,
    evolutionCards: [
      card(`${id}:base`, boardPlayerId),
      card(`${id}:middle`, boardPlayerId),
      card(`${id}:top`, boardPlayerId),
    ],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  return {
    ...base,
    boards: {
      [p1]: {
        activeStackId: 'stack:p1:active',
        benchStackIds: ['stack:p1:bench'],
      },
      [p2]: {
        activeStackId: 'stack:p2:active',
        benchStackIds: ['stack:p2:bench'],
      },
    },
    stacks: {
      'stack:p1:active': stack('stack:p1:active', p1, 'active'),
      'stack:p1:bench': stack('stack:p1:bench', p1, 'bench'),
      'stack:p2:active': stack('stack:p2:active', p2, 'active'),
      'stack:p2:bench': stack('stack:p2:bench', p2, 'bench'),
    },
  };
};

const createEnergyAttachmentView = (attachmentCount: 1 | 2): MatchViewState => {
  const view = createView();
  const card = (
    id: string,
    ownerId: typeof p1 | typeof p2,
    category: 'Pokémon' | 'Energy'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: category === 'Pokémon' ? definitionId : energyDefinitionId,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId, 'Pokémon')],
    attachmentCards: Array.from({ length: attachmentCount }, (_, index) =>
      card(
        attachmentCount === 1 ? `${id}:energy` : `${id}:energy-${index + 1}`,
        boardPlayerId,
        'Energy'
      )
    ),
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const fixtureName = attachmentCount === 1 ? 'single-energy' : 'two-energy';
  const local = stack(`stack:p1:${fixtureName}`, p1);
  const opponent = stack(`stack:p2:${fixtureName}`, p2);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

const createSingleEnergyAttachmentView = (): MatchViewState =>
  createEnergyAttachmentView(1);

const createTwoEnergyAttachmentView = (): MatchViewState =>
  createEnergyAttachmentView(2);

const createSingleTrainerToolAttachmentView = (): MatchViewState => {
  const view = createView();
  const card = (
    id: string,
    ownerId: typeof p1 | typeof p2,
    category: 'Pokémon' | 'Trainer'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: category === 'Pokémon' ? definitionId : trainerDefinitionId,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId, 'Pokémon')],
    attachmentCards: [card(`${id}:tool`, boardPlayerId, 'Trainer')],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const local = stack('stack:p1:single-trainer-tool', p1);
  const opponent = stack('stack:p2:single-trainer-tool', p2);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

const createSingleEnergyTrainerToolAttachmentView = (): MatchViewState => {
  const view = createView();
  const card = (
    id: string,
    ownerId: typeof p1 | typeof p2,
    category: 'Pokémon' | 'Energy' | 'Trainer'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId:
      category === 'Pokémon'
        ? definitionId
        : category === 'Energy'
          ? energyDefinitionId
          : trainerDefinitionId,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId, 'Pokémon')],
    attachmentCards: [
      card(`${id}:energy`, boardPlayerId, 'Energy'),
      card(`${id}:tool`, boardPlayerId, 'Trainer'),
    ],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const local = stack('stack:p1:single-energy-trainer-tool', p1);
  const opponent = stack('stack:p2:single-energy-trainer-tool', p2);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

interface ActiveMarkerFixtureState {
  readonly damage: number | null;
  readonly specialCondition: string | null;
  readonly abilityUsed: boolean;
}

const allActiveMarkers: ActiveMarkerFixtureState = {
  damage: 130,
  specialCondition: 'P',
  abilityUsed: true,
};

const noActiveMarkers: ActiveMarkerFixtureState = {
  damage: null,
  specialCondition: null,
  abilityUsed: false,
};

const createPristineActiveMarkerView = (
  localMarkers: ActiveMarkerFixtureState = allActiveMarkers,
  opponentMarkers: ActiveMarkerFixtureState = allActiveMarkers
): MatchViewState => {
  const view = createView();
  const card = (id: string, ownerId: typeof p1 | typeof p2) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (
    id: string,
    boardPlayerId: typeof p1 | typeof p2,
    markers: ActiveMarkerFixtureState
  ) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId)],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    ...markers,
  });
  const local = stack('stack:p1:active-markers', p1, localMarkers);
  const opponent = stack('stack:p2:active-markers', p2, opponentMarkers);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

interface BenchMarkerFixtureState {
  readonly damage: number | null;
  readonly abilityUsed: boolean;
}

const allBenchMarkers: BenchMarkerFixtureState = {
  damage: 130,
  abilityUsed: true,
};

const createCanonicalBenchMarkerView = (
  localMarkers: BenchMarkerFixtureState = allBenchMarkers,
  opponentMarkers: BenchMarkerFixtureState = allBenchMarkers
): MatchViewState => {
  const view = createView();
  const card = (id: string, ownerId: typeof p1 | typeof p2) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const activeControl = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId)],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const markedBench = (
    id: string,
    boardPlayerId: typeof p1 | typeof p2,
    markers: BenchMarkerFixtureState
  ) => ({
    id,
    boardPlayerId,
    slot: 'bench' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId)],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    specialCondition: null,
    ...markers,
  });
  const localActive = activeControl('stack:p1:bench-marker-control', p1);
  const localBench = markedBench('stack:p1:bench-markers', p1, localMarkers);
  const opponentActive = activeControl('stack:p2:bench-marker-control', p2);
  const opponentBench = markedBench(
    'stack:p2:bench-markers',
    p2,
    opponentMarkers
  );
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: {
        activeStackId: localActive.id,
        benchStackIds: [localBench.id],
      },
      [p2]: {
        activeStackId: opponentActive.id,
        benchStackIds: [opponentBench.id],
      },
    },
    stacks: {
      [localActive.id]: localActive,
      [localBench.id]: localBench,
      [opponentActive.id]: opponentActive,
      [opponentBench.id]: opponentBench,
    },
  };
};

const options = {
  viewport: DEFAULT_BOARD_VIEWPORT,
  bottomPlayerId: p1,
  splitRatio: 0.5,
  geometryVersion: 1 as const,
};

const characterizedEvolutionLayoutState = {
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
  playerIds: [p1, p2],
  bottomPlayerId: p1,
  shellMode: 'sidebar',
  vertical: {
    lowerFrame: { bottomRatio: 0, heightRatio: 0.5 },
    upperFrame: { bottomRatio: 0.5, heightRatio: 0.5 },
    lowerHandle: { bottomRatio: 0.505, heightRatio: 0.025 },
    upperHandle: { bottomRatio: 0.53, heightRatio: 0.025 },
    sharedPlacement: 'cssDefault',
  },
} as const satisfies BoardLayoutState;

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

  it('projects a legacy count label for every counted zone in the view', () => {
    const scene = createBoardSceneForViewport(createView(), options);
    // Only the zones the view carries get a count; the base view has p1's
    // hand (one card) and p2's deck (one concealed card).
    expect(scene.counts.map((node) => [node.id, node.count])).toEqual([
      ['count:zone:p1:hand', 1],
      ['count:zone:p2:deck', 1],
    ]);
    const hand = scene.counts.find((node) => node.zoneId === 'zone:p1:hand')!;
    expect(hand).toMatchObject({
      playerId: p1,
      side: 'local',
      kind: 'hand',
      horizontalAlign: 'right',
      verticalAlign: 'bottom',
      color: 'rgba(90, 110, 188, 0.864)',
      label: '1 cards',
    });
    // Same numbers the layout module pins against the v1 runtime: the hand
    // count hangs from the frame's right edge (2%) just above the hand (30%).
    expect(hand.anchor.x).toBeCloseTo(1208 * 0.98);
    expect(hand.anchor.y).toBeCloseTo(765);
    expect(hand.fontSizePx).toBe(18);
    const deck = scene.counts.find((node) => node.zoneId === 'zone:p2:deck')!;
    expect(deck).toMatchObject({
      playerId: p2,
      side: 'opponent',
      kind: 'deck',
      horizontalAlign: 'left',
      verticalAlign: 'top',
      color: '#000',
    });
    // Count nodes carry the card count itself, not a card, so a concealed
    // deck still reports how many cards it hides.
    expect(deck.count).toBe(1);
    expect(deck.anchor.x).toBeCloseTo(1208 * 0.02);
    expect(deck.anchor.y).toBeCloseTo(450 * 0.91);
  });

  it('lays the hand out the way v1 does: 3vh shorter than the row, resting on 2vh, centred', () => {
    // Recorded from the real v1 runtime at 1440x900 with seven cards in the
    // local hand: images 118.484px tall at y=772.516, first at x=229.016,
    // stepping 90.625px (85.219px image + .25vw either side). v1's width
    // follows the image's natural aspect; v2 uses the standard card ratio.
    const sevenCards = (ownerId: PlayerId, zoneId: string) =>
      Array.from({ length: 7 }, (_, index) => ({
        kind: 'concealed' as const,
        id: asViewCardId(`${zoneId}:${index}`),
        ownerId,
        cardBackUrl: '/back.png',
        publiclyRevealed: false,
      }));
    const view: MatchViewState = {
      ...createView(),
      zones: {
        'zone:p1:hand': {
          id: 'zone:p1:hand',
          kind: 'hand',
          ownerId: p1,
          cards: sevenCards(p1, 'zone:p1:hand'),
        },
        'zone:p2:hand': {
          id: 'zone:p2:hand',
          kind: 'hand',
          ownerId: p2,
          cards: sevenCards(p2, 'zone:p2:hand'),
        },
      },
    };
    // The scene viewport is the play area: 75.5% of the 1440px window.
    const frameWidth = 1440 * 0.755;
    const playArea = { width: frameWidth, height: 900, devicePixelRatio: 1 };
    const scene = createBoardSceneForViewport(view, {
      ...options,
      viewport: playArea,
    });
    const height = 118.5;
    const width = height * CARD_ASPECT_RATIO;
    const step = width + 2 * 0.0025 * frameWidth;
    const local = scene.cards.filter(
      (card) => card.parentId === 'zone:p1:hand'
    );
    expect(local).toHaveLength(7);
    for (const [index, card] of local.entries()) {
      expect(card.bounds.height).toBeCloseTo(height);
      expect(card.bounds.width).toBeCloseTo(width);
      expect(card.bounds.y).toBeCloseTo(772.5);
      expect(card.bounds.x).toBeCloseTo(
        (frameWidth - step * 7) / 2 + 0.0025 * frameWidth + step * index
      );
    }
    // The opponent row is the same authored row after the frame half-turn:
    // the 2vh rest becomes a top margin and the first card sits at the right.
    const opponent = scene.cards.filter(
      (card) => card.parentId === 'zone:p2:hand'
    );
    expect(opponent).toHaveLength(7);
    for (const [index, card] of opponent.entries()) {
      expect(card.bounds.height).toBeCloseTo(height);
      expect(card.bounds.y).toBeCloseTo(9);
      expect(card.bounds.x).toBeCloseTo(
        frameWidth - local[index]!.bounds.x - width
      );
    }

    // A hand wider than the row keeps every card full size and scrolls, as
    // v1's `#hand { overflow-x: auto }` does: the row starts at the frame's
    // left, the zone reports the row width, and the renderer's offset shifts
    // the cards (clamped to the row's end).
    const wideView = {
      ...view,
      zones: {
        'zone:p1:hand': {
          id: 'zone:p1:hand',
          kind: 'hand' as const,
          ownerId: p1,
          cards: Array.from({ length: 30 }, (_, index) => ({
            kind: 'concealed' as const,
            id: asViewCardId(`wide:${index}`),
            ownerId: p1,
            cardBackUrl: '/back.png',
            publiclyRevealed: false,
          })),
        },
      },
    };
    const wide = createBoardSceneForViewport(wideView, {
      ...options,
      viewport: playArea,
    });
    const wideCards = wide.cards.filter(
      (card) => card.parentId === 'zone:p1:hand'
    );
    expect(wideCards[0]!.bounds.x).toBeCloseTo(0.0025 * frameWidth);
    expect(wideCards[1]!.bounds.x - wideCards[0]!.bounds.x).toBeCloseTo(step);
    const last = wideCards.at(-1)!;
    expect(last.bounds.width).toBeCloseTo(width);
    expect(last.bounds.x + last.bounds.width).toBeGreaterThan(frameWidth);
    const wideZone = wide.zones.find((zone) => zone.id === 'zone:p1:hand')!;
    expect(wideZone.scroll).toEqual({
      contentWidth: expect.closeTo(step * 30, 6),
      offsetPx: 0,
    });
    expect(scene.zones.find((zone) => zone.id === 'zone:p1:hand')!.scroll).toBe(
      undefined
    );

    const scrolled = createBoardScene(
      wideView,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
        playerIds: [p1, p2],
        bottomPlayerId: p1,
        shellMode: 'sidebar',
        vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
        handScrollPx: { [p1]: 250 },
      })
    );
    const scrolledCards = scrolled.cards.filter(
      (card) => card.parentId === 'zone:p1:hand'
    );
    expect(scrolledCards[0]!.bounds.x).toBeCloseTo(0.0025 * frameWidth - 250);
    expect(
      scrolled.zones.find((zone) => zone.id === 'zone:p1:hand')!.scroll
    ).toMatchObject({ offsetPx: 250 });
    const overscrolled = createBoardScene(
      wideView,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
        playerIds: [p1, p2],
        bottomPlayerId: p1,
        shellMode: 'sidebar',
        vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
        handScrollPx: { [p1]: 100_000 },
      })
    );
    const overscrolledZone = overscrolled.zones.find(
      (zone) => zone.id === 'zone:p1:hand'
    )!;
    expect(overscrolledZone.scroll!.offsetPx).toBeCloseTo(
      step * 30 - overscrolledZone.contentBounds.width
    );
  });

  it('paints a known deck as its owner card back on the table but as faces in the viewer', () => {
    const base = createView();
    const deckCards = Array.from({ length: 3 }, (_, index) => ({
      kind: 'known' as const,
      id: asViewCardId(`own-deck:${index}`),
      definitionId,
      ownerId: p1,
      category: 'Pokémon' as const,
      face: 'up' as const,
      orientationQuarterTurns: 0 as const,
      abilityUsed: false,
      publiclyRevealed: false,
    }));
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        'zone:p1:deck': {
          id: 'zone:p1:deck',
          kind: 'deck',
          ownerId: p1,
          cards: deckCards,
        },
      },
    };
    const scene = createBoardSceneForViewport(view, options);
    const deck = scene.cards.filter((card) => card.parentId === 'zone:p1:deck');
    expect(deck).toHaveLength(3);
    const cover = deck.find((card) => card.renderKey === 'cover:zone:p1:deck')!;
    // The owner can read the deck, so every node carries the face for the
    // zone viewer, while the table shows v1's card-back cover.
    expect(cover.imageUrl).toBe('https://cards.invalid/board-visible.png');
    expect(cover.tableImageUrl).toBe('/blue-back.png');
    for (const card of deck) {
      expect(card.imageUrl).toBe('https://cards.invalid/board-visible.png');
    }
    expect(deck.filter((card) => card.tableImageUrl !== undefined)).toEqual([
      cover,
    ]);
    // A concealed opponent deck still paints backs everywhere.
    const opponentCover = scene.cards.find(
      (card) => card.renderKey === 'cover:zone:p2:deck'
    )!;
    expect(opponentCover.imageUrl).toBe('/red-back.png');
    expect(opponentCover.tableImageUrl).toBe('/red-back.png');
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
          side: 'shared',
          presentation: 'generic',
        }),
        expect.objectContaining({
          id: `${attachment.id}:abilityUsed`,
          parentCardId: attachment.id,
          side: 'local',
          presentation: 'generic',
        }),
      ])
    );
  });

  it('keeps the characterized path at a fractional device pixel ratio', () => {
    // The model does no devicePixelRatio arithmetic, and
    // tests/browser/legacy-cssom-rounding.spec.ts measures the client-width
    // rounding against real legacy at integer and fractional scales, so scale
    // must not decide whether legacy geometry is used.
    const view = createPristineActiveMarkerView();
    const scenes = [1, 1.25, 1.5, 2].map((devicePixelRatio) =>
      createBoardScene(
        view,
        createBoardLayoutSnapshot({
          ...characterizedEvolutionLayoutState,
          viewport: { width: 1600, height: 900, devicePixelRatio },
        })
      )
    );
    for (const scene of scenes) {
      expect(
        scene.markers.some((marker) => marker.presentation === 'legacyActiveQ0')
      ).toBe(true);
    }
    const atOne = scenes[0];
    for (const scene of scenes.slice(1)) {
      expect(scene.cards.map((card) => card.bounds)).toEqual(
        atOne?.cards.map((card) => card.bounds)
      );
    }
  });

  it('flex-shrinks an overflowing play slot the way the legacy browser row does', () => {
    // A tall, narrow window makes the authored active card wider than its
    // region. The row cannot shrink a lone card below its image, so the
    // browser centres the overflow; the scene follows the same rule instead
    // of switching to a different geometry.
    const portrait = {
      ...characterizedEvolutionLayoutState,
      viewport: { width: 600, height: 1600, devicePixelRatio: 1 },
    } as const satisfies BoardLayoutState;
    const layout = createBoardLayoutSnapshot(portrait);
    expect(
      layoutLegacyPlaySlotCards(
        findBoardLayoutRegion(layout, 'local', 'active'),
        [63 / 88]
      )
    ).toBeNull();

    const view = createPristineActiveMarkerView();
    const scene = createBoardScene(view, layout);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const region = findBoardLayoutRegion(layout, side, 'active');
      const stack = view.stacks[`stack:${playerId}:active-markers`]!;
      const node = scene.cards.find(
        (candidate) => candidate.id === stack.evolutionCards[0]!.id
      );
      expect(node, `${side} active card must still render`).toBeDefined();
      const cardWidth = region.physicalDeclaredBounds.height * (63 / 88);
      expect(cardWidth).toBeGreaterThan(region.physicalDeclaredBounds.width);
      expect(node?.bounds.width).toBeCloseTo(cardWidth);
      expect(node?.bounds.x).toBeCloseTo(
        region.physicalDeclaredBounds.x +
          (region.physicalDeclaredBounds.width - cardWidth) / 2
      );
      expect(node?.zIndex).toBe(300);
      expect(
        scene.markers
          .filter((marker) => marker.parentCardId === node?.id)
          .map((marker) => marker.presentation)
      ).toEqual(['legacyActiveQ0', 'legacyActiveQ0', 'legacyActiveQ0']);
    }
  });

  it('uses exact play-slot card and pristine-q0 marker geometry on both sides', () => {
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const markerCases = [
      { damage: 130, specialCondition: null, abilityUsed: false },
      { damage: null, specialCondition: 'P', abilityUsed: false },
      { damage: null, specialCondition: null, abilityUsed: true },
      allActiveMarkers,
    ] as const satisfies readonly ActiveMarkerFixtureState[];

    for (const markerState of markerCases) {
      const view = createPristineActiveMarkerView(markerState, markerState);
      const scene = createBoardScene(view, layout);
      for (const [playerId, side] of [
        [p1, 'local'],
        [p2, 'opponent'],
      ] as const) {
        const stackId = `stack:${playerId}:active-markers`;
        const stack = view.stacks[stackId]!;
        const cardId = stack.evolutionCards[0]!.id;
        const expectedCardBounds = layoutLegacyPlaySlotCards(
          findBoardLayoutRegion(layout, side, 'active'),
          [63 / 88]
        )[0]!;
        const expectedMarkers = layoutLegacyActiveQ0Markers(
          expectedCardBounds,
          side
        );
        expect(scene.cards.find((card) => card.id === cardId)).toMatchObject({
          parentId: stackId,
          side,
          role: 'stackEvolution',
          bounds: nearRect(expectedCardBounds),
          zIndex: 300,
          rotationQuarterTurns: side === 'local' ? 0 : 2,
        });

        const values = {
          damage:
            markerState.damage === null ? null : String(markerState.damage),
          specialCondition: markerState.specialCondition,
          abilityUsed: markerState.abilityUsed ? 'used' : null,
        } as const;
        expect(
          scene.markers
            .filter((marker) => marker.parentCardId === cardId)
            .map((marker) => marker.kind)
        ).toEqual(
          (['damage', 'specialCondition', 'abilityUsed'] as const).filter(
            (kind) => values[kind] !== null
          )
        );
        for (const kind of [
          'damage',
          'specialCondition',
          'abilityUsed',
        ] as const) {
          const marker = scene.markers.find(
            (candidate) => candidate.id === `${cardId}:${kind}`
          );
          const value = values[kind];
          if (value === null) {
            expect(marker).toBeUndefined();
          } else {
            expect(marker).toEqual({
              id: `${cardId}:${kind}`,
              parentCardId: cardId,
              side,
              kind,
              presentation: 'legacyActiveQ0',
              value,
              bounds: nearRect(expectedMarkers[kind].bounds),
              zIndex: 300 + expectedMarkers[kind].sourceZIndex,
              label: `${kind}: ${value}`,
            });
          }
        }
      }
    }

    const recipientSafeView = createPristineActiveMarkerView();
    const recipientSafeEquivalent: MatchViewState = {
      ...recipientSafeView,
      viewer: { kind: 'spectator' },
      revision: recipientSafeView.revision + 1,
      definitions: {},
      stacks: Object.fromEntries(
        Object.entries(recipientSafeView.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    const geometry = (view: MatchViewState) => {
      const scene = createBoardScene(view, layout);
      return {
        cards: scene.cards.map(
          ({ id, bounds, zIndex, rotationQuarterTurns }) => ({
            id,
            bounds,
            zIndex,
            rotationQuarterTurns,
          })
        ),
        markers: scene.markers,
      };
    };
    expect(geometry(recipientSafeEquivalent)).toEqual(
      geometry(recipientSafeView)
    );
  });

  it('uses exact sole-bench q0 marker geometry with one clean active control', () => {
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const markerCases = [
      { damage: null, abilityUsed: false },
      { damage: 130, abilityUsed: false },
      { damage: null, abilityUsed: true },
      allBenchMarkers,
    ] as const satisfies readonly BenchMarkerFixtureState[];

    for (const markerState of markerCases) {
      const view = createCanonicalBenchMarkerView(markerState, markerState);
      const scene = createBoardScene(view, layout);
      for (const [playerId, side] of [
        [p1, 'local'],
        [p2, 'opponent'],
      ] as const) {
        const stackId = `stack:${playerId}:bench-markers`;
        const stack = view.stacks[stackId]!;
        const cardId = stack.evolutionCards[0]!.id;
        const expectedCardBounds = layoutLegacyPlaySlotCards(
          findBoardLayoutRegion(layout, side, 'bench'),
          [63 / 88]
        )[0]!;
        const expectedMarkers = layoutLegacyBenchQ0Markers(
          expectedCardBounds,
          side
        );
        const card = scene.cards.find((candidate) => candidate.id === cardId);
        expect(card).toMatchObject({
          parentId: stackId,
          side,
          role: 'stackEvolution',
          bounds: expectedCardBounds,
          zIndex: 300,
          rotationQuarterTurns: side === 'local' ? 0 : 2,
          interactive: true,
        });

        const expectedValues = {
          damage:
            markerState.damage === null ? null : String(markerState.damage),
          abilityUsed: markerState.abilityUsed ? 'used' : null,
        } as const;
        const stackMarkers = scene.markers.filter(
          (marker) => marker.parentCardId === cardId
        );
        expect(stackMarkers.map((marker) => marker.kind)).toEqual(
          (['damage', 'abilityUsed'] as const).filter(
            (kind) => expectedValues[kind] !== null
          )
        );
        expect(
          scene.markers.find(
            (marker) =>
              marker.parentCardId === cardId &&
              marker.kind === 'specialCondition'
          )
        ).toBeUndefined();
        for (const kind of ['damage', 'abilityUsed'] as const) {
          const value = expectedValues[kind];
          const marker = scene.markers.find(
            (candidate) => candidate.id === `${cardId}:${kind}`
          );
          if (value === null) {
            expect(marker).toBeUndefined();
            continue;
          }
          expect(marker).toEqual({
            id: `${cardId}:${kind}`,
            parentCardId: cardId,
            side,
            kind,
            presentation: 'legacyBenchQ0',
            value,
            bounds: expectedMarkers[kind].bounds,
            zIndex: 300 + expectedMarkers[kind].sourceZIndex,
            label: `${kind}: ${value}`,
          });
          expect(
            hitTestBoardScene(
              scene,
              marker!.bounds.x + marker!.bounds.width / 2,
              marker!.bounds.y + marker!.bounds.height / 2
            )
          ).toEqual({ kind: 'card', id: cardId });
        }
      }
    }

    const recipientSafeView = createCanonicalBenchMarkerView();
    const recipientSafeEquivalent: MatchViewState = {
      ...recipientSafeView,
      viewer: { kind: 'spectator' },
      revision: recipientSafeView.revision + 1,
      definitions: {},
      stacks: Object.fromEntries(
        Object.entries(recipientSafeView.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    const geometry = (view: MatchViewState) => {
      const scene = createBoardScene(view, layout);
      return {
        cards: scene.cards.map(
          ({ id, parentId, bounds, zIndex, rotationQuarterTurns }) => ({
            id,
            parentId,
            bounds,
            zIndex,
            rotationQuarterTurns,
          })
        ),
        markers: scene.markers,
      };
    };
    expect(geometry(recipientSafeEquivalent)).toEqual(
      geometry(recipientSafeView)
    );
  });

  it('keeps sole-bench card and marker identities stable through q0 marker transitions', () => {
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = (markers: BenchMarkerFixtureState) =>
      createBoardScene(
        createCanonicalBenchMarkerView(markers, {
          damage: null,
          abilityUsed: false,
        }),
        layout
      );
    const none = scene({ damage: null, abilityUsed: false });
    const damage = scene({ damage: 130, abilityUsed: false });
    const updatedDamage = scene({ damage: 140, abilityUsed: false });
    const both = scene({ damage: 140, abilityUsed: true });
    const ability = scene({ damage: null, abilityUsed: true });
    const returnedNone = scene({ damage: null, abilityUsed: false });
    const cardId = asViewCardId('stack:p1:bench-markers:base');
    const damageId = `${cardId}:damage`;
    const abilityId = `${cardId}:abilityUsed`;

    const cardSnapshot = (candidate: ReturnType<typeof scene>) =>
      candidate.cards.find((card) => card.id === cardId);
    expect(cardSnapshot(none)).toEqual(cardSnapshot(damage));
    expect(cardSnapshot(damage)).toEqual(cardSnapshot(updatedDamage));
    expect(cardSnapshot(updatedDamage)).toEqual(cardSnapshot(both));
    expect(cardSnapshot(both)).toEqual(cardSnapshot(ability));
    expect(cardSnapshot(ability)).toEqual(cardSnapshot(returnedNone));

    expect(diffBoardScenes(none, damage)).toMatchObject({
      addedCardIds: [],
      removedCardIds: [],
      updatedCardIds: [],
      addedMarkerIds: [damageId],
      removedMarkerIds: [],
      updatedMarkerIds: [],
      unchangedMarkerIds: [],
    });
    expect(diffBoardScenes(damage, updatedDamage)).toMatchObject({
      addedMarkerIds: [],
      removedMarkerIds: [],
      updatedMarkerIds: [damageId],
      unchangedMarkerIds: [],
    });
    expect(diffBoardScenes(updatedDamage, both)).toMatchObject({
      addedMarkerIds: [abilityId],
      removedMarkerIds: [],
      updatedMarkerIds: [],
      unchangedMarkerIds: [damageId],
    });
    expect(
      both.markers
        .filter((marker) => marker.parentCardId === cardId)
        .map((marker) => marker.id)
    ).toEqual([damageId, abilityId]);
    expect(diffBoardScenes(both, ability)).toMatchObject({
      addedMarkerIds: [],
      removedMarkerIds: [damageId],
      updatedMarkerIds: [],
      unchangedMarkerIds: [abilityId],
    });
    expect(diffBoardScenes(ability, returnedNone)).toMatchObject({
      addedMarkerIds: [],
      removedMarkerIds: [abilityId],
      updatedMarkerIds: [],
      unchangedMarkerIds: [],
    });
  });

  it('keeps surviving marker identities stable across active-bench reconstruction', () => {
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const activeView = createPristineActiveMarkerView(
      allActiveMarkers,
      noActiveMarkers
    );
    const markedStackId = 'stack:p1:active-markers';
    const markedStack = activeView.stacks[markedStackId]!;
    const markedCardId = markedStack.evolutionCards[0]!.id;
    const controlStackId = 'stack:p1:marker-transfer-control';
    const controlCardId = asViewCardId(`${controlStackId}:base`);
    const controlStack = {
      id: controlStackId,
      boardPlayerId: p1,
      slot: 'active' as const,
      evolutionCards: [
        {
          ...markedStack.evolutionCards[0]!,
          id: controlCardId,
        },
      ],
      attachmentCards: [],
      rotationQuarterTurns: 0 as const,
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    };
    const benchView: MatchViewState = {
      ...activeView,
      revision: activeView.revision + 1,
      boards: {
        ...activeView.boards,
        [p1]: {
          activeStackId: controlStackId,
          benchStackIds: [markedStackId],
        },
      },
      stacks: {
        ...activeView.stacks,
        [markedStackId]: {
          ...markedStack,
          slot: 'bench',
          specialCondition: null,
        },
        [controlStackId]: controlStack,
      },
    };
    const returnedActiveView: MatchViewState = {
      ...benchView,
      revision: benchView.revision + 1,
      boards: {
        ...benchView.boards,
        [p1]: { activeStackId: markedStackId, benchStackIds: [] },
      },
      stacks: {
        ...Object.fromEntries(
          Object.entries(benchView.stacks).filter(
            ([stackId]) => stackId !== controlStackId
          )
        ),
        [markedStackId]: {
          ...benchView.stacks[markedStackId]!,
          slot: 'active',
        },
      },
    };

    const active = createBoardScene(activeView, layout);
    const bench = createBoardScene(benchView, layout);
    const returnedActive = createBoardScene(returnedActiveView, layout);
    const damageId = `${markedCardId}:damage`;
    const conditionId = `${markedCardId}:specialCondition`;
    const abilityId = `${markedCardId}:abilityUsed`;
    const markersFor = (scene: ReturnType<typeof createBoardScene>) =>
      scene.markers.filter((marker) => marker.parentCardId === markedCardId);

    expect(
      markersFor(active).map(({ id, presentation }) => [id, presentation])
    ).toEqual([
      [damageId, 'legacyActiveQ0'],
      [conditionId, 'legacyActiveQ0'],
      [abilityId, 'legacyActiveQ0'],
    ]);
    expect(
      markersFor(bench).map(({ id, presentation }) => [id, presentation])
    ).toEqual([
      [damageId, 'legacyBenchQ0'],
      [abilityId, 'legacyBenchQ0'],
    ]);
    expect(
      markersFor(returnedActive).map(({ id, presentation }) => [
        id,
        presentation,
      ])
    ).toEqual([
      [damageId, 'legacyActiveQ0'],
      [abilityId, 'legacyActiveQ0'],
    ]);

    expect(diffBoardScenes(active, bench)).toMatchObject({
      addedCardIds: [controlCardId],
      removedCardIds: [],
      updatedCardIds: [markedCardId],
      addedMarkerIds: [],
      removedMarkerIds: [conditionId],
      updatedMarkerIds: [damageId, abilityId],
      unchangedMarkerIds: [],
    });
    expect(diffBoardScenes(bench, returnedActive)).toMatchObject({
      addedCardIds: [],
      removedCardIds: [controlCardId],
      updatedCardIds: [markedCardId],
      addedMarkerIds: [],
      removedMarkerIds: [],
      updatedMarkerIds: [damageId, abilityId],
      unchangedMarkerIds: [],
    });
  });

  it('retains the incoming ability marker identity while replacing host markers on evolution', () => {
    const base = createView();
    const stackId = 'stack:p1:evolution-marker-transfer';
    const baseCard = {
      kind: 'known' as const,
      id: asViewCardId('view-card:evolution-marker-base'),
      definitionId,
      ownerId: p1,
      category: 'Pokémon' as const,
      face: 'up' as const,
      orientationQuarterTurns: 0 as const,
      abilityUsed: false,
      publiclyRevealed: false,
    };
    const incomingCard = {
      ...baseCard,
      id: asViewCardId('view-card:evolution-marker-incoming'),
      abilityUsed: true,
    };
    const stack = {
      id: stackId,
      boardPlayerId: p1,
      slot: 'active' as const,
      evolutionCards: [baseCard],
      attachmentCards: [],
      rotationQuarterTurns: 0 as const,
      damage: 60,
      specialCondition: 'Pa',
      abilityUsed: true,
    };
    const beforeView: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        'zone:p1:hand': { ...base.zones['zone:p1:hand']!, cards: [] },
        'zone:shared:stadium': {
          ...base.zones['zone:shared:stadium']!,
          cards: [incomingCard],
        },
      },
      boards: {
        ...base.boards,
        [p1]: { activeStackId: stackId, benchStackIds: [] },
      },
      stacks: { [stackId]: stack },
    };
    const afterView: MatchViewState = {
      ...beforeView,
      revision: beforeView.revision + 1,
      zones: {
        ...beforeView.zones,
        'zone:shared:stadium': {
          ...beforeView.zones['zone:shared:stadium']!,
          cards: [],
        },
      },
      stacks: {
        [stackId]: {
          ...stack,
          evolutionCards: [baseCard, { ...incomingCard, abilityUsed: false }],
          specialCondition: null,
          abilityUsed: true,
        },
      },
    };
    const before = createBoardSceneForViewport(beforeView, options);
    const after = createBoardSceneForViewport(afterView, options);
    const incomingAbilityId = `${incomingCard.id}:abilityUsed`;
    const oldDamageId = `${baseCard.id}:damage`;
    const oldConditionId = `${baseCard.id}:specialCondition`;
    const oldAbilityId = `${baseCard.id}:abilityUsed`;
    const transferredDamageId = `${incomingCard.id}:damage`;

    expect(
      before.markers.find((marker) => marker.id === incomingAbilityId)
    ).toMatchObject({
      parentCardId: incomingCard.id,
      kind: 'abilityUsed',
      presentation: 'generic',
    });
    // Once in play, the retained marker paints as the stack's legacy tab.
    expect(
      after.markers.find((marker) => marker.id === incomingAbilityId)
    ).toMatchObject({
      parentCardId: incomingCard.id,
      kind: 'abilityUsed',
      presentation: 'legacyActiveQ0',
    });
    expect(
      after.markers.find((marker) => marker.id === transferredDamageId)
    ).toMatchObject({
      parentCardId: incomingCard.id,
      kind: 'damage',
      value: '60',
    });
    expect(diffBoardScenes(before, after)).toMatchObject({
      addedMarkerIds: [transferredDamageId],
      removedMarkerIds: [oldDamageId, oldConditionId, oldAbilityId],
      updatedMarkerIds: [incomingAbilityId],
      unchangedMarkerIds: [],
    });

    const malformedAfter = createBoardSceneForViewport(
      {
        ...afterView,
        stacks: {
          [stackId]: {
            ...afterView.stacks[stackId]!,
            evolutionCards: [baseCard, { ...incomingCard, abilityUsed: true }],
          },
        },
      },
      options
    );
    expect(
      malformedAfter.markers.filter((marker) => marker.id === incomingAbilityId)
    ).toHaveLength(1);
  });

  it('totally orders characterized equal-z markers across prefix-shaped opaque aliases', () => {
    const base = createPristineActiveMarkerView();
    const originalLocal = base.stacks['stack:p1:active-markers']!;
    const originalOpponent = base.stacks['stack:p2:active-markers']!;
    const localStack = {
      ...originalLocal,
      id: 'b',
      evolutionCards: [
        {
          ...originalLocal.evolutionCards[0]!,
          id: asViewCardId('marker-parent-b'),
        },
      ],
    };
    const opponentStack = {
      ...originalOpponent,
      id: 'b:c',
      evolutionCards: [
        {
          ...originalOpponent.evolutionCards[0]!,
          id: asViewCardId('marker-parent-b:c'),
        },
      ],
    };
    const localBoard = { activeStackId: localStack.id, benchStackIds: [] };
    const opponentBoard = {
      activeStackId: opponentStack.id,
      benchStackIds: [],
    };
    const forward: MatchViewState = {
      ...base,
      boards: { [p1]: localBoard, [p2]: opponentBoard },
      stacks: {
        [localStack.id]: localStack,
        [opponentStack.id]: opponentStack,
      },
    };
    const reversed: MatchViewState = {
      ...forward,
      boards: { [p2]: opponentBoard, [p1]: localBoard },
      stacks: {
        [opponentStack.id]: opponentStack,
        [localStack.id]: localStack,
      },
    };
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const markerIds = (view: MatchViewState) => {
      const markers = createBoardScene(view, layout).markers;
      expect(
        markers.every((marker) => marker.presentation === 'legacyActiveQ0')
      ).toBe(true);
      return markers.map((marker) => marker.id);
    };
    const expected = [
      'marker-parent-b:damage',
      'marker-parent-b:specialCondition',
      'marker-parent-b:abilityUsed',
      'marker-parent-b:c:damage',
      'marker-parent-b:c:specialCondition',
      'marker-parent-b:c:abilityUsed',
    ];
    expect(markerIds(forward)).toEqual(expected);
    expect(markerIds(reversed)).toEqual(expected);
  });

  it('diffs stable marker identities and every renderer-visible marker field', () => {
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const none = createBoardScene(
      createPristineActiveMarkerView(noActiveMarkers, noActiveMarkers),
      layout
    );
    const damage = createBoardScene(
      createPristineActiveMarkerView(
        { damage: 130, specialCondition: null, abilityUsed: false },
        noActiveMarkers
      ),
      layout
    );
    const damageAndCondition = createBoardScene(
      createPristineActiveMarkerView(
        { damage: 140, specialCondition: 'P', abilityUsed: false },
        noActiveMarkers
      ),
      layout
    );
    const updatedDamage = createBoardScene(
      createPristineActiveMarkerView(
        { damage: 140, specialCondition: null, abilityUsed: false },
        noActiveMarkers
      ),
      layout
    );
    const activeCardId = asViewCardId('stack:p1:active-markers:base');
    const damageId = `${activeCardId}:damage`;
    const conditionId = `${activeCardId}:specialCondition`;

    expect(diffBoardScenes(none, damage)).toMatchObject({
      addedCardIds: [],
      removedCardIds: [],
      updatedCardIds: [],
      addedMarkerIds: [damageId],
      removedMarkerIds: [],
      updatedMarkerIds: [],
      unchangedMarkerIds: [],
    });
    expect(diffBoardScenes(damage, damageAndCondition)).toMatchObject({
      addedMarkerIds: [conditionId],
      removedMarkerIds: [],
      updatedMarkerIds: [damageId],
      unchangedMarkerIds: [],
    });
    expect(diffBoardScenes(damageAndCondition, updatedDamage)).toMatchObject({
      addedMarkerIds: [],
      removedMarkerIds: [conditionId],
      updatedMarkerIds: [],
      unchangedMarkerIds: [damageId],
    });

    const baselineMarker = damage.markers[0]!;
    const alternateParent = damage.cards.find(
      (card) => card.id !== baselineMarker.parentCardId
    )!.id;
    const mutations = [
      { parentCardId: alternateParent },
      { side: 'opponent' as const },
      { kind: 'specialCondition' as const },
      { presentation: 'generic' as const },
      { value: '140' },
      { bounds: { ...baselineMarker.bounds, x: baselineMarker.bounds.x + 1 } },
      { zIndex: baselineMarker.zIndex + 1 },
      { label: 'changed marker label' },
    ] as const;
    for (const mutation of mutations) {
      const changed = {
        ...damage,
        markers: damage.markers.map((marker) =>
          marker.id === baselineMarker.id ? { ...marker, ...mutation } : marker
        ),
      };
      expect(diffBoardScenes(damage, changed)).toMatchObject({
        addedMarkerIds: [],
        removedMarkerIds: [],
        updatedMarkerIds: [baselineMarker.id],
        unchangedMarkerIds: [],
      });
    }
  });

  it('uses the characterized stable ordinary-evolution layout without definition leakage', () => {
    const view = createOrdinaryEvolutionView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      for (const slot of ['active', 'bench'] as const) {
        const stackId = `stack:${playerId}:${slot}`;
        const stack = view.stacks[stackId]!;
        const expected = layoutLegacyOrdinaryEvolutionStack(
          findBoardLayoutRegion(layout, side, slot),
          63 / 88,
          3
        );
        const nodes = stack.evolutionCards.map((card) => {
          const node = scene.cards.find(
            (candidate) => candidate.id === card.id
          );
          if (!node)
            throw new Error(`Missing ordinary evolution node ${card.id}`);
          return node;
        });
        expect(nodes.map((node) => node.bounds)).toEqual(
          expected.cards.map((card) => card.bounds)
        );
        expect(nodes.map((node) => node.zIndex)).toEqual([298, 299, 300]);
        expect(nodes.map((node) => node.rotationQuarterTurns)).toEqual(
          side === 'local' ? [0, 0, 0] : [2, 2, 2]
        );

        const [base, middle, top] = nodes;
        if (!base || !middle || !top) {
          throw new Error(`Incomplete ordinary evolution stack ${stackId}`);
        }
        const x = top.bounds.x + top.bounds.width / 2;
        const commonY =
          Math.max(base.bounds.y, middle.bounds.y, top.bounds.y) +
          Math.min(
            base.bounds.height,
            middle.bounds.height,
            top.bounds.height
          ) /
            2;
        expect(hitTestBoardScene(scene, x, commonY)).toEqual({
          kind: 'card',
          id: top.id,
        });
        const middleStripY =
          side === 'local'
            ? (middle.bounds.y + top.bounds.y) / 2
            : (middle.bounds.y +
                middle.bounds.height +
                top.bounds.y +
                top.bounds.height) /
              2;
        expect(hitTestBoardScene(scene, x, middleStripY)).toEqual({
          kind: 'card',
          id: middle.id,
        });
        const baseStripY =
          side === 'local'
            ? (base.bounds.y + middle.bounds.y) / 2
            : (base.bounds.y +
                base.bounds.height +
                middle.bounds.y +
                middle.bounds.height) /
              2;
        expect(hitTestBoardScene(scene, x, baseStripY)).toEqual({
          kind: 'card',
          id: base.id,
        });
      }
    }
    expect(scene.markers).toEqual([]);

    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: {
        ...view.definitions,
        [definitionId]: {
          ...view.definitions[definitionId]!,
          imageUrl: 'https://cards.invalid/different-secret-dimensions.png',
          imageUrlSmall: 'https://cards.invalid/different-board-dimensions.png',
        },
      },
    };
    const changedScene = createBoardScene(changedDefinitions, layout);
    for (const stack of Object.values(view.stacks)) {
      for (const card of stack.evolutionCards) {
        expect(
          changedScene.cards.find((candidate) => candidate.id === card.id)
            ?.bounds
        ).toEqual(
          scene.cards.find((candidate) => candidate.id === card.id)?.bounds
        );
      }
    }
  });

  it('uses stable one-Energy active geometry without definition-size leakage', () => {
    const view = createSingleEnergyAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    expect(scene.cards).toHaveLength(4);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack = view.stacks[`stack:${playerId}:single-energy`]!;
      const expected = layoutLegacySingleEnergyAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const base = scene.cards.find(
        (card) => card.id === stack.evolutionCards[0]?.id
      );
      const energy = scene.cards.find(
        (card) => card.id === stack.attachmentCards[0]?.id
      );
      if (!base || !energy) {
        throw new Error(`Incomplete one-Energy stack for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.role)
      ).toEqual(['stackAttachment', 'stackEvolution']);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(energy).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.energy.bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      const commonX =
        (Math.max(base.bounds.x, energy.bounds.x) +
          Math.min(
            base.bounds.x + base.bounds.width,
            energy.bounds.x + energy.bounds.width
          )) /
        2;
      const commonY = base.bounds.y + base.bounds.height / 2;
      expect(hitTestBoardScene(scene, commonX, commonY)).toEqual({
        kind: 'card',
        id: base.id,
      });
      const energyOnlyX =
        side === 'local'
          ? (base.bounds.x +
              base.bounds.width +
              energy.bounds.x +
              energy.bounds.width) /
            2
          : (energy.bounds.x + base.bounds.x) / 2;
      expect(hitTestBoardScene(scene, energyOnlyX, commonY)).toEqual({
        kind: 'card',
        id: energy.id,
      });
    }

    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            name: `Changed ${id}`,
            category: 'Trainer',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
    };
    const changedScene = createBoardScene(changedDefinitions, layout);
    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(({ id, bounds, role, zIndex }) => ({
        id,
        bounds,
        role,
        zIndex,
      }));
    expect(geometryProjection(changedScene)).toEqual(geometryProjection(scene));
    const irrelevantVisibilityFields: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(irrelevantVisibilityFields, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('uses stable two-Energy active geometry in back-to-front scene order', () => {
    const view = createTwoEnergyAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    const externalSourceId = asViewCardId('external-two-energy-drag-source');
    expect(scene.cards).toHaveLength(6);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack = view.stacks[`stack:${playerId}:two-energy`]!;
      const expected = layoutLegacyTwoEnergyAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const baseState = stack.evolutionCards[0];
      const firstEnergyState = stack.attachmentCards[0];
      const secondEnergyState = stack.attachmentCards[1];
      if (!baseState || !firstEnergyState || !secondEnergyState) {
        throw new Error(`Incomplete two-Energy state for ${playerId}`);
      }
      expect(stack.attachmentCards.map((card) => card.id)).toEqual([
        firstEnergyState.id,
        secondEnergyState.id,
      ]);
      const base = scene.cards.find((card) => card.id === baseState.id);
      const firstEnergy = scene.cards.find(
        (card) => card.id === firstEnergyState.id
      );
      const secondEnergy = scene.cards.find(
        (card) => card.id === secondEnergyState.id
      );
      if (!base || !firstEnergy || !secondEnergy) {
        throw new Error(`Incomplete two-Energy scene for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.id)
      ).toEqual([secondEnergy.id, firstEnergy.id, base.id]);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(firstEnergy).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.energies[0].bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(secondEnergy).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.energies[1].bounds,
        zIndex: 298,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });

      const centerY = base.bounds.y + base.bounds.height / 2;
      const commonX =
        (Math.max(base.bounds.x, firstEnergy.bounds.x, secondEnergy.bounds.x) +
          Math.min(
            base.bounds.x + base.bounds.width,
            firstEnergy.bounds.x + firstEnergy.bounds.width,
            secondEnergy.bounds.x + secondEnergy.bounds.width
          )) /
        2;
      expect(hitTestBoardScene(scene, commonX, centerY)).toEqual({
        kind: 'card',
        id: base.id,
      });
      expect(
        resolveBoardDropTarget(scene, externalSourceId, commonX, centerY)
      ).toBe(stack.id);
      const attachmentOverlapX =
        side === 'local'
          ? (base.bounds.x +
              base.bounds.width +
              firstEnergy.bounds.x +
              firstEnergy.bounds.width) /
            2
          : (firstEnergy.bounds.x + base.bounds.x) / 2;
      expect(hitTestBoardScene(scene, attachmentOverlapX, centerY)).toEqual({
        kind: 'card',
        id: firstEnergy.id,
      });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          attachmentOverlapX,
          centerY
        )
      ).toBe(stack.id);
      const outermostEnergyX =
        side === 'local'
          ? (firstEnergy.bounds.x +
              firstEnergy.bounds.width +
              secondEnergy.bounds.x +
              secondEnergy.bounds.width) /
            2
          : (secondEnergy.bounds.x + firstEnergy.bounds.x) / 2;
      expect(hitTestBoardScene(scene, outermostEnergyX, centerY)).toEqual({
        kind: 'card',
        id: secondEnergy.id,
      });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          outermostEnergyX,
          centerY
        )
      ).toBe(stack.id);
      const baseOnlyX =
        side === 'local'
          ? (base.bounds.x + firstEnergy.bounds.x) / 2
          : (firstEnergy.bounds.x +
              firstEnergy.bounds.width +
              base.bounds.x +
              base.bounds.width) /
            2;
      expect(hitTestBoardScene(scene, baseOnlyX, centerY)).toEqual({
        kind: 'card',
        id: base.id,
      });
      expect(
        resolveBoardDropTarget(scene, externalSourceId, baseOnlyX, centerY)
      ).toBe(stack.id);

      const activeRegion = findBoardLayoutRegion(layout, side, 'active');
      const emptyX = activeRegion.physicalContentBoxBounds.x + 1;
      const emptyY =
        activeRegion.physicalContentBoxBounds.y +
        activeRegion.physicalContentBoxBounds.height / 2;
      expect(hitTestBoardScene(scene, emptyX, emptyY)).toEqual({
        kind: 'zone',
        id: `slot:${playerId}:active`,
      });
      expect(
        resolveBoardDropTarget(scene, externalSourceId, emptyX, emptyY)
      ).toBe(`slot:${playerId}:active`);
    }

    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(
        ({ id, bounds, role, zIndex, rotationQuarterTurns }) => ({
          id,
          bounds,
          role,
          zIndex,
          rotationQuarterTurns,
        })
      );
    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            name: `Changed ${id}`,
            category: 'Trainer',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(changedDefinitions, layout))
    ).toEqual(geometryProjection(scene));
    const irrelevantVisibilityFields: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(irrelevantVisibilityFields, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('reflows two-Energy identity and departure transitions through the exact narrower paths', () => {
    const view = createTwoEnergyAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const stackId = 'stack:p1:two-energy';
    const original = view.stacks[stackId]!;
    const baseState = original.evolutionCards[0];
    const firstEnergyState = original.attachmentCards[0];
    const secondEnergyState = original.attachmentCards[1];
    if (!baseState || !firstEnergyState || !secondEnergyState) {
      throw new Error('Incomplete local two-Energy transition fixture');
    }
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const expectedTwoEnergy = layoutLegacyTwoEnergyAttachmentStack(
      active,
      63 / 88
    );
    const expectedOneEnergy = layoutLegacySingleEnergyAttachmentStack(
      active,
      63 / 88
    );
    const withAttachments = (
      attachmentCards: MatchViewState['stacks'][string]['attachmentCards']
    ): MatchViewState => ({
      ...view,
      stacks: {
        ...view.stacks,
        [stackId]: { ...original, attachmentCards },
      },
    });
    const findCard = (
      scene: ReturnType<typeof createBoardScene>,
      id: typeof baseState.id
    ) => scene.cards.find((card) => card.id === id);

    const swappedScene = createBoardScene(
      withAttachments([secondEnergyState, firstEnergyState]),
      layout
    );
    expect(findCard(swappedScene, secondEnergyState.id)).toMatchObject({
      bounds: expectedTwoEnergy.energies[0].bounds,
      zIndex: 299,
    });
    expect(findCard(swappedScene, firstEnergyState.id)).toMatchObject({
      bounds: expectedTwoEnergy.energies[1].bounds,
      zIndex: 298,
    });
    expect(
      swappedScene.cards
        .filter((card) => card.parentId === stackId)
        .map((card) => card.id)
    ).toEqual([firstEnergyState.id, secondEnergyState.id, baseState.id]);

    for (const [survivor, removed] of [
      [secondEnergyState, firstEnergyState],
      [firstEnergyState, secondEnergyState],
    ] as const) {
      const oneEnergyScene = createBoardScene(
        withAttachments([survivor]),
        layout
      );
      expect(findCard(oneEnergyScene, baseState.id)).toMatchObject({
        bounds: expectedOneEnergy.base.bounds,
        zIndex: 300,
      });
      expect(findCard(oneEnergyScene, survivor.id)).toMatchObject({
        bounds: expectedOneEnergy.energy.bounds,
        zIndex: 299,
      });
      expect(findCard(oneEnergyScene, removed.id)).toBeUndefined();
      expect(
        oneEnergyScene.cards
          .filter((card) => card.parentId === stackId)
          .map((card) => card.id)
      ).toEqual([survivor.id, baseState.id]);
    }

    const emptyScene = createBoardScene(withAttachments([]), layout);
    const plain = layoutLegacyPlaySlotCards(active, [63 / 88])![0]!;
    expect(findCard(emptyScene, baseState.id)).toMatchObject({
      bounds: nearRect(plain),
      zIndex: 300,
    });
    expect(findCard(emptyScene, firstEnergyState.id)).toBeUndefined();
    expect(findCard(emptyScene, secondEnergyState.id)).toBeUndefined();

    // v1 attaches a face-down Energy exactly like a face-up one.
    const faceDownSurvivor = { ...firstEnergyState, face: 'down' as const };
    const faceDownScene = createBoardScene(
      withAttachments([faceDownSurvivor]),
      layout
    );
    expect(findCard(faceDownScene, baseState.id)).toMatchObject({
      bounds: expectedOneEnergy.base.bounds,
      zIndex: 300,
    });
    expect(findCard(faceDownScene, faceDownSurvivor.id)).toMatchObject({
      bounds: expectedOneEnergy.energy.bounds,
      zIndex: 299,
    });
  });

  it('uses canonical one-Energy/Trainer-as-Tool active geometry, order, and rotated hits', () => {
    const view = createSingleEnergyTrainerToolAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    const externalSourceId = asViewCardId('external-mixed-drag-source');
    expect(scene.cards).toHaveLength(6);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack =
        view.stacks[`stack:${playerId}:single-energy-trainer-tool`]!;
      const expected = layoutLegacySingleEnergyTrainerToolAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const base = scene.cards.find(
        (card) => card.id === stack.evolutionCards[0]?.id
      );
      const energy = scene.cards.find(
        (card) => card.id === stack.attachmentCards[0]?.id
      );
      const tool = scene.cards.find(
        (card) => card.id === stack.attachmentCards[1]?.id
      );
      if (!base || !energy || !tool) {
        throw new Error(`Incomplete mixed attachment stack for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.id)
      ).toEqual([tool.id, energy.id, base.id]);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(energy).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.energy.bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(tool).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.tool.bounds,
        zIndex: 298,
        rotationQuarterTurns: side === 'local' ? 1 : 3,
        interactive: true,
      });

      const paintedToolBounds = {
        x: tool.bounds.x + (tool.bounds.width - tool.bounds.height) / 2,
        y: tool.bounds.y + (tool.bounds.height - tool.bounds.width) / 2,
        width: tool.bounds.height,
        height: tool.bounds.width,
      };
      const commonPoint = {
        x:
          (Math.max(base.bounds.x, energy.bounds.x, paintedToolBounds.x) +
            Math.min(
              base.bounds.x + base.bounds.width,
              energy.bounds.x + energy.bounds.width,
              paintedToolBounds.x + paintedToolBounds.width
            )) /
          2,
        y:
          (Math.max(base.bounds.y, energy.bounds.y, paintedToolBounds.y) +
            Math.min(
              base.bounds.y + base.bounds.height,
              energy.bounds.y + energy.bounds.height,
              paintedToolBounds.y + paintedToolBounds.height
            )) /
          2,
      };
      expect(hitTestBoardScene(scene, commonPoint.x, commonPoint.y)).toEqual({
        kind: 'card',
        id: base.id,
      });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          commonPoint.x,
          commonPoint.y
        )
      ).toBe(stack.id);

      const energyToolPoint = {
        x:
          side === 'local'
            ? (base.bounds.x +
                base.bounds.width +
                Math.min(
                  energy.bounds.x + energy.bounds.width,
                  paintedToolBounds.x + paintedToolBounds.width
                )) /
              2
            : (Math.max(energy.bounds.x, paintedToolBounds.x) + base.bounds.x) /
              2,
        y: commonPoint.y,
      };
      expect(
        hitTestBoardScene(scene, energyToolPoint.x, energyToolPoint.y)
      ).toEqual({ kind: 'card', id: energy.id });

      const toolOnlyPoint = {
        x:
          side === 'local'
            ? (energy.bounds.x +
                energy.bounds.width +
                paintedToolBounds.x +
                paintedToolBounds.width) /
              2
            : (paintedToolBounds.x + energy.bounds.x) / 2,
        y: commonPoint.y,
      };
      expect(
        hitTestBoardScene(scene, toolOnlyPoint.x, toolOnlyPoint.y)
      ).toEqual({ kind: 'card', id: tool.id });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          toolOnlyPoint.x,
          toolOnlyPoint.y
        )
      ).toBe(stack.id);

      const baseOnlyX =
        side === 'local'
          ? (base.bounds.x + Math.min(energy.bounds.x, paintedToolBounds.x)) / 2
          : (Math.max(
              energy.bounds.x + energy.bounds.width,
              paintedToolBounds.x + paintedToolBounds.width
            ) +
              base.bounds.x +
              base.bounds.width) /
            2;
      expect(hitTestBoardScene(scene, baseOnlyX, commonPoint.y)).toEqual({
        kind: 'card',
        id: base.id,
      });
    }

    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(
        ({ id, bounds, role, zIndex, rotationQuarterTurns }) => ({
          id,
          bounds,
          role,
          zIndex,
          rotationQuarterTurns,
        })
      );
    const recipientSafeEquivalent: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            category: definition.category === 'Trainer' ? 'Energy' : 'Trainer',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(recipientSafeEquivalent, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('uses the canonical mixed geometry through sole-bench movement and return', () => {
    const baseView = createSingleEnergyTrainerToolAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const mixedId = `stack:${playerId}:single-energy-trainer-tool`;
      const controlId = `stack:${playerId}:mixed-control`;
      const mixed = baseView.stacks[mixedId]!;
      const controlCard = {
        kind: 'known' as const,
        id: asViewCardId(`${controlId}:base`),
        definitionId,
        ownerId: playerId,
        category: 'Pokémon' as const,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
        publiclyRevealed: false,
      };
      const control = {
        id: controlId,
        boardPlayerId: playerId,
        slot: 'bench' as const,
        evolutionCards: [controlCard],
        attachmentCards: [],
        rotationQuarterTurns: 0 as const,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
      const withPlacement = (
        mixedSlot: 'active' | 'bench'
      ): MatchViewState => ({
        ...baseView,
        boards: {
          ...baseView.boards,
          [playerId]:
            mixedSlot === 'active'
              ? { activeStackId: mixedId, benchStackIds: [controlId] }
              : { activeStackId: controlId, benchStackIds: [mixedId] },
        },
        stacks: {
          ...baseView.stacks,
          [mixedId]: { ...mixed, slot: mixedSlot },
          [controlId]: {
            ...control,
            slot: mixedSlot === 'active' ? 'bench' : 'active',
          },
        },
      });
      let benchScene: ReturnType<typeof createBoardScene> | null = null;
      let returnedScene: ReturnType<typeof createBoardScene> | null = null;
      for (const mixedSlot of ['bench', 'active'] as const) {
        const view = withPlacement(mixedSlot);
        const scene = createBoardScene(view, layout);
        if (mixedSlot === 'bench') benchScene = scene;
        else returnedScene = scene;
        const expected = layoutLegacySingleEnergyTrainerToolAttachmentStack(
          findBoardLayoutRegion(layout, side, mixedSlot),
          63 / 88
        );
        const stack = view.stacks[mixedId]!;
        const base = scene.cards.find(
          (card) => card.id === stack.evolutionCards[0]?.id
        );
        const energy = scene.cards.find(
          (card) => card.id === stack.attachmentCards[0]?.id
        );
        const tool = scene.cards.find(
          (card) => card.id === stack.attachmentCards[1]?.id
        );
        if (!base || !energy || !tool) {
          throw new Error(`${side} ${mixedSlot} movement scene is incomplete`);
        }
        expect(base).toMatchObject({
          bounds: expected.base.bounds,
          zIndex: 300,
        });
        expect(energy).toMatchObject({
          bounds: expected.energy.bounds,
          zIndex: 299,
        });
        expect(tool).toMatchObject({
          bounds: expected.tool.bounds,
          zIndex: 298,
          rotationQuarterTurns: side === 'local' ? 1 : 3,
        });
        expect(
          scene.cards
            .filter((card) => card.parentId === mixedId)
            .map((card) => card.id)
        ).toEqual([tool.id, energy.id, base.id]);
        const commonX =
          (Math.max(base.bounds.x, energy.bounds.x) +
            Math.min(
              base.bounds.x + base.bounds.width,
              energy.bounds.x + energy.bounds.width
            )) /
          2;
        expect(
          hitTestBoardScene(
            scene,
            commonX,
            base.bounds.y + base.bounds.height / 2
          )
        ).toEqual({ kind: 'card', id: base.id });
      }
      if (!benchScene || !returnedScene) {
        throw new Error(`${side} movement scenes were not retained`);
      }
      const movementDiff = diffBoardScenes(benchScene, returnedScene);
      expect(movementDiff.addedCardIds).toEqual([]);
      expect(movementDiff.removedCardIds).toEqual([]);
      expect([...movementDiff.updatedCardIds].sort()).toEqual(
        [...mixed.evolutionCards, ...mixed.attachmentCards, controlCard]
          .map((card) => card.id)
          .sort()
      );
      expect(movementDiff.unchangedCardIds).toHaveLength(3);
    }
  });

  it('uses stable one-Trainer-as-Tool active geometry and rotated input footprints', () => {
    const view = createSingleTrainerToolAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    const externalSourceId = asViewCardId('external-drag-source');
    expect(scene.cards).toHaveLength(4);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack = view.stacks[`stack:${playerId}:single-trainer-tool`]!;
      const expected = layoutLegacySingleTrainerToolAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const base = scene.cards.find(
        (card) => card.id === stack.evolutionCards[0]?.id
      );
      const tool = scene.cards.find(
        (card) => card.id === stack.attachmentCards[0]?.id
      );
      if (!base || !tool) {
        throw new Error(`Incomplete one-Trainer-as-Tool stack for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.role)
      ).toEqual(['stackAttachment', 'stackEvolution']);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(tool).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.tool.bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 1 : 3,
        interactive: true,
      });

      const paintedToolBounds = {
        x: tool.bounds.x + (tool.bounds.width - tool.bounds.height) / 2,
        y: tool.bounds.y + (tool.bounds.height - tool.bounds.width) / 2,
        width: tool.bounds.height,
        height: tool.bounds.width,
      };
      const commonX =
        (Math.max(base.bounds.x, paintedToolBounds.x) +
          Math.min(
            base.bounds.x + base.bounds.width,
            paintedToolBounds.x + paintedToolBounds.width
          )) /
        2;
      const commonY =
        (Math.max(base.bounds.y, paintedToolBounds.y) +
          Math.min(
            base.bounds.y + base.bounds.height,
            paintedToolBounds.y + paintedToolBounds.height
          )) /
        2;
      expect(hitTestBoardScene(scene, commonX, commonY)).toEqual({
        kind: 'card',
        id: base.id,
      });

      const toolOnlyX =
        side === 'local'
          ? (base.bounds.x +
              base.bounds.width +
              paintedToolBounds.x +
              paintedToolBounds.width) /
            2
          : (paintedToolBounds.x + base.bounds.x) / 2;
      expect(hitTestBoardScene(scene, toolOnlyX, commonY)).toEqual({
        kind: 'card',
        id: tool.id,
      });
      expect(
        resolveBoardDropTarget(scene, externalSourceId, toolOnlyX, commonY)
      ).toBe(stack.id);

      const baseOnlyY = (base.bounds.y + paintedToolBounds.y) / 2;
      expect(hitTestBoardScene(scene, commonX, baseOnlyY)).toEqual({
        kind: 'card',
        id: base.id,
      });

      const authoredOnlyX =
        side === 'local'
          ? (Math.max(base.bounds.x + base.bounds.width, tool.bounds.x) +
              tool.bounds.x +
              tool.bounds.width) /
            2
          : (tool.bounds.x +
              Math.min(base.bounds.x, tool.bounds.x + tool.bounds.width)) /
            2;
      const authoredOnlyY =
        (paintedToolBounds.y +
          paintedToolBounds.height +
          tool.bounds.y +
          tool.bounds.height) /
        2;
      expect(hitTestBoardScene(scene, authoredOnlyX, authoredOnlyY)).toEqual({
        kind: 'zone',
        id: `slot:${playerId}:active`,
      });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          authoredOnlyX,
          authoredOnlyY
        )
      ).toBe(`slot:${playerId}:active`);
    }

    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(
        ({ id, bounds, role, zIndex, rotationQuarterTurns }) => ({
          id,
          bounds,
          role,
          zIndex,
          rotationQuarterTurns,
        })
      );
    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            name: `Changed ${id}`,
            category: 'Energy',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(changedDefinitions, layout))
    ).toEqual(geometryProjection(scene));
    const irrelevantVisibilityFields: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(irrelevantVisibilityFields, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('lays every bench stack out with the general legacy play-row geometry', () => {
    // Shapes the narrow oracles never covered: a crowded bench mixing a plain
    // basic, a stack carrying two Energy and a Tool, and a quarter-turned host
    // with an Energy; markers sit on the host's painted (rotated) box and a
    // Tool paints a quarter turn while Energy never follows the host.
    const view = createView();
    const card = (
      id: string,
      category: 'Pokémon' | 'Energy' | 'Trainer',
      abilityUsed = false
    ) => ({
      kind: 'known' as const,
      id: asViewCardId(id),
      definitionId:
        category === 'Pokémon'
          ? definitionId
          : category === 'Energy'
            ? energyDefinitionId
            : trainerDefinitionId,
      ownerId: p1,
      category,
      face: 'up' as const,
      orientationQuarterTurns: 0 as const,
      abilityUsed,
      publiclyRevealed: false,
    });
    const stacks = {
      'stack:p1:active': {
        id: 'stack:p1:active',
        boardPlayerId: p1,
        slot: 'active' as const,
        evolutionCards: [card('active:base', 'Pokémon')],
        attachmentCards: [],
        rotationQuarterTurns: 0 as const,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      },
      'stack:p1:plain': {
        id: 'stack:p1:plain',
        boardPlayerId: p1,
        slot: 'bench' as const,
        evolutionCards: [card('plain:base', 'Pokémon')],
        attachmentCards: [],
        rotationQuarterTurns: 0 as const,
        damage: 20,
        specialCondition: null,
        abilityUsed: false,
      },
      'stack:p1:loaded': {
        id: 'stack:p1:loaded',
        boardPlayerId: p1,
        slot: 'bench' as const,
        evolutionCards: [card('loaded:base', 'Pokémon')],
        attachmentCards: [
          card('loaded:tool', 'Trainer'),
          card('loaded:energy-1', 'Energy'),
          card('loaded:energy-2', 'Energy'),
        ],
        rotationQuarterTurns: 0 as const,
        damage: null,
        specialCondition: null,
        abilityUsed: true,
      },
      'stack:p1:turned': {
        id: 'stack:p1:turned',
        boardPlayerId: p1,
        slot: 'bench' as const,
        evolutionCards: [card('turned:base', 'Pokémon')],
        attachmentCards: [card('turned:energy', 'Energy')],
        rotationQuarterTurns: 1 as const,
        damage: 50,
        specialCondition: null,
        abilityUsed: false,
      },
    };
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(
      {
        ...view,
        zones: Object.fromEntries(
          Object.entries(view.zones).map(([id, zone]) => [
            id,
            { ...zone, cards: [] },
          ])
        ),
        boards: {
          [p1]: {
            activeStackId: 'stack:p1:active',
            benchStackIds: [
              'stack:p1:plain',
              'stack:p1:loaded',
              'stack:p1:turned',
            ],
          },
          [p2]: { activeStackId: null, benchStackIds: [] },
        },
        stacks,
      },
      layout
    );
    const bench = findBoardLayoutRegion(layout, 'local', 'bench');
    const expected = layoutLegacyPlayRow(bench, CARD_ASPECT_RATIO, [
      { evolutionCount: 1, attachments: [], rotationQuarterTurns: 0 },
      {
        evolutionCount: 1,
        attachments: ['tool', 'energy', 'energy'],
        rotationQuarterTurns: 0,
      },
      { evolutionCount: 1, attachments: ['energy'], rotationQuarterTurns: 1 },
    ]);
    const find = (id: string) =>
      scene.cards.find((candidate) => candidate.id === asViewCardId(id));

    expect(find('plain:base')).toMatchObject({
      bounds: expected[0]!.evolutionCards[0]!.bounds,
      zIndex: 300,
      rotationQuarterTurns: 0,
    });
    // Tool attached first still paints behind both Energy, a quarter turn on.
    expect(find('loaded:tool')).toMatchObject({
      bounds: expected[1]!.attachmentCards[0]!.bounds,
      zIndex: 297,
      rotationQuarterTurns: 1,
    });
    expect(find('loaded:energy-1')).toMatchObject({
      bounds: expected[1]!.attachmentCards[1]!.bounds,
      zIndex: 299,
      rotationQuarterTurns: 0,
    });
    expect(find('loaded:energy-2')?.zIndex).toBe(298);
    expect(find('loaded:energy-2')?.bounds.x).toBeGreaterThan(
      find('loaded:energy-1')!.bounds.x
    );
    // The turned host rotates; its Energy stays upright at the same offset.
    expect(find('turned:base')).toMatchObject({
      bounds: expected[2]!.evolutionCards[0]!.bounds,
      rotationQuarterTurns: 1,
    });
    expect(find('turned:energy')).toMatchObject({
      bounds: expected[2]!.attachmentCards[0]!.bounds,
      rotationQuarterTurns: 0,
    });
    // Containers keep v1's order and margins left to right.
    expect(
      [find('plain:base'), find('loaded:base'), find('turned:base')].map(
        (node) => node!.bounds.x
      )
    ).toEqual(expected.map((stack) => stack.evolutionCards[0]!.bounds.x));

    const marker = (id: string) =>
      scene.markers.find((candidate) => candidate.id === id);
    const plainBounds = find('plain:base')!.bounds;
    expect(marker(`${asViewCardId('plain:base')}:damage`)).toMatchObject({
      presentation: 'legacyBenchQ0',
      bounds: nearRect(
        layoutLegacyActiveQ0Markers(plainBounds, 'local').damage.bounds
      ),
    });
    expect(marker(`${asViewCardId('loaded:base')}:abilityUsed`)).toMatchObject({
      presentation: 'legacyBenchQ0',
      bounds: nearRect(
        layoutLegacyActiveQ0Markers(find('loaded:base')!.bounds, 'local')
          .abilityUsed.bounds
      ),
    });
    // A quarter-turned host's counter sits on its painted (rotated) box.
    const turned = find('turned:base')!.bounds;
    const painted = {
      x: turned.x + turned.width / 2 - turned.height / 2,
      y: turned.y + turned.height / 2 - turned.width / 2,
      width: turned.height,
      height: turned.width,
    };
    expect(marker(`${asViewCardId('turned:base')}:damage`)).toMatchObject({
      presentation: 'legacyBenchQ0',
      bounds: nearRect(
        layoutLegacyActiveQ0Markers(painted, 'local').damage.bounds
      ),
    });
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
      expect(nodes[topIndex]).toMatchObject({
        interactive: true,
        renderKey: `cover:${zone.id}`,
        primaryAction: { kind: 'openZone', zoneId: zone.id },
      });
      expect(nodes[topIndex]!.zIndex).toBe(
        Math.max(...nodes.map((node) => node!.zIndex))
      );
      expect(
        scene.cards.filter(
          (node) => node.parentId === zone.id && !node.interactive
        )
      ).toHaveLength(zone.cards.length - 1);
      expect(nodes.filter((node) => node?.renderKey === null)).toHaveLength(
        zone.cards.length - 1
      );
      expect(
        nodes.filter((node) => node?.primaryAction !== undefined)
      ).toHaveLength(1);
    }
    const stadium = view.zones['zone:shared:stadium']!;
    expect(stadium.kind).toBe('stadium');
    expect(
      scene.cards.find((card) => card.parentId === stadium.id)?.primaryAction
    ).toBeUndefined();
    expect(
      scene.cards.find((card) => card.parentId === stadium.id)?.renderKey
    ).toMatch(/^card:/u);
    expect(scene.cards.filter((card) => card.renderKey !== null)).toHaveLength(
      49
    );
    const renderKeys = scene.cards.flatMap((card) =>
      card.renderKey === null ? [] : [card.renderKey]
    );
    expect(new Set(renderKeys).size).toBe(renderKeys.length);
    const nextDiscardCards = [
      ...blueDiscard.cards.slice(1),
      blueDiscard.cards[0]!,
    ];
    const nextScene = createBoardSceneForViewport(
      {
        ...view,
        revision: view.revision + 1,
        zones: {
          ...view.zones,
          [blueDiscard.id]: {
            ...blueDiscard,
            cards: nextDiscardCards,
          },
        },
      },
      { ...options, bottomPlayerId: view.playerOrder[0]! }
    );
    expect(
      nextScene.cards.find((card) => card.id === nextDiscardCards.at(-1)!.id)
    ).toMatchObject({
      renderKey: `cover:${blueDiscard.id}`,
      primaryAction: { kind: 'openZone', zoneId: blueDiscard.id },
    });
    expect(
      nextScene.cards.find((card) => card.id === blueDiscard.cards.at(-1)!.id)
        ?.renderKey
    ).toBeNull();
    expect(
      new Set(
        nextScene.cards.flatMap((card) =>
          card.renderKey === null ? [] : [card.renderKey]
        )
      )
    ).toEqual(new Set(renderKeys));
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

    const actionable = {
      ...first,
      cards: first.cards.map((card) =>
        card.id === knownCardId
          ? {
              ...card,
              primaryAction: {
                kind: 'openZone' as const,
                zoneId: card.parentId,
              },
            }
          : card
      ),
    };
    expect(diffBoardScenes(first, actionable)).toMatchObject({
      updatedCardIds: [knownCardId],
      unchangedCardIds: [hiddenCardId],
    });
    const rekeyed = {
      ...actionable,
      cards: actionable.cards.map((card) =>
        card.id === knownCardId
          ? { ...card, renderKey: `replacement:${String(card.id)}` }
          : card
      ),
    };
    expect(diffBoardScenes(actionable, rekeyed)).toMatchObject({
      updatedCardIds: [knownCardId],
      unchangedCardIds: [hiddenCardId],
    });

    const known = first.cards.find((card) => card.id === knownCardId)!;
    expect(
      hitTestBoardScene(
        first,
        known.bounds.x + known.bounds.width / 2,
        known.bounds.y + known.bounds.height / 2
      )
    ).toEqual({ kind: 'card', id: knownCardId });
  });

  it('hit-tests a quarter-turned card by its painted footprint', () => {
    const base = createBoardSceneForViewport(createView(), options);
    const known = base.cards.find((card) => card.id === knownCardId)!;
    const scene = {
      ...base,
      zones: [],
      cards: [
        {
          ...known,
          bounds: { x: 100, y: 200, width: 60, height: 100 },
          rotationQuarterTurns: 1 as const,
        },
      ],
    };

    expect(hitTestBoardScene(scene, 81, 250)).toEqual({
      kind: 'card',
      id: knownCardId,
    });
    expect(hitTestBoardScene(scene, 130, 219)).toBeNull();
  });

  it('hit-tests the later-painted card when z-indexes are equal', () => {
    const base = createBoardSceneForViewport(createView(), options);
    const known = base.cards.find((card) => card.id === knownCardId)!;
    const laterId = asViewCardId('later-painted-card');
    const scene = {
      ...base,
      zones: [],
      cards: [known, { ...known, id: laterId }],
    };

    expect(
      hitTestBoardScene(
        scene,
        known.bounds.x + known.bounds.width / 2,
        known.bounds.y + known.bounds.height / 2
      )
    ).toEqual({ kind: 'card', id: laterId });
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
