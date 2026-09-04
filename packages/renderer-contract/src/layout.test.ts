import { asPlayerId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { CARD_ASPECT_RATIO } from './geometry.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  findBoardLayoutRegion,
  flipBoardLayoutState,
  LEGACY_BOARD_AFFORDANCES_V1,
  layoutLegacyActiveQ0Markers,
  layoutLegacyBenchQ0Markers,
  layoutLegacyContainedCard,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacyPlaySlotCards,
  layoutLegacyPlayStackHitRegions,
  layoutLegacySingleEnergyTrainerToolAttachmentStack,
  layoutLegacySingleEnergyAttachmentStack,
  layoutLegacySingleTrainerToolAttachmentStack,
  layoutLegacyTwoEnergyAttachmentStack,
  legacyPileTopIndex,
  legacyResizeHandlesCollide,
  type BoardLayoutState,
} from './layout.js';
import type { Rect } from './model.js';

const blue = asPlayerId('blue');
const red = asPlayerId('red');

const expectRectClose = (actual: Rect, expected: Rect): void => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.width).toBeCloseTo(expected.width);
  expect(actual.height).toBeCloseTo(expected.height);
};

const state = (
  overrides: Partial<BoardLayoutState> = {}
): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  playerIds: [blue, red],
  bottomPlayerId: blue,
  shellMode: 'sidebar',
  vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  ...overrides,
});

describe('renderer-neutral legacy board layout', () => {
  it('keeps outer, physical-frame and player-local coordinate spaces explicit', () => {
    const layout = createBoardLayoutSnapshot(state());
    expect(layout.playAreaBounds).toEqual({
      x: 0,
      y: 0,
      width: 966.4,
      height: 720,
    });
    expectRectClose(layout.shellGapBounds!, {
      x: 966.4,
      y: 0,
      width: 6.4,
      height: 720,
    });
    expect(layout.sidebarBounds).toEqual({
      x: 972.8,
      y: 36,
      width: 307.2,
      height: 684,
    });
    expect(layout.tabsBounds).toEqual({
      x: 972.8,
      y: 0,
      width: 307.2,
      height: 36,
    });
    expect(
      layout.players.map(
        ({
          playerId,
          side,
          physicalSide,
          rotationQuarterTurns,
          frameBounds,
        }) => ({
          playerId,
          side,
          physicalSide,
          rotationQuarterTurns,
          frameBounds,
        })
      )
    ).toEqual([
      {
        playerId: blue,
        side: 'local',
        physicalSide: 'lower',
        rotationQuarterTurns: 0,
        frameBounds: { x: 0, y: 360, width: 966.4, height: 360 },
      },
      {
        playerId: red,
        side: 'opponent',
        physicalSide: 'upper',
        rotationQuarterTurns: 2,
        frameBounds: { x: 0, y: 0, width: 966.4, height: 360 },
      },
    ]);

    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(hand.playerLocalNormalizedBounds).toEqual({
      x: 0,
      y: 0.7,
      width: 1,
      height: 0.3,
    });
    expect(hand.physicalDeclaredBounds).toEqual({
      x: 0,
      y: 612,
      width: 966.4,
      height: 108,
    });
    expect(hand.physicalBorderBoxBounds).toEqual(hand.physicalDeclaredBounds);
    expect(hand.physicalContentBoxBounds).toEqual({
      x: 0,
      y: 615,
      width: 966.4,
      height: 105,
    });
    expect(hand.physicalBorderPx).toEqual({
      top: 3,
      right: 0,
      bottom: 0,
      left: 0,
    });

    const opponentHand = findBoardLayoutRegion(layout, 'opponent', 'hand');
    expect(opponentHand.physicalBorderPx).toEqual({
      top: 0,
      right: 0,
      bottom: 3,
      left: 0,
    });
    expect(opponentHand.physicalBorderBoxBounds).toEqual({
      x: 0,
      y: 0,
      width: 966.4,
      height: 108,
    });
    expect(opponentHand.physicalContentBoxBounds).toEqual({
      x: 0,
      y: 0,
      width: 966.4,
      height: 105,
    });
  });

  it('retains content-box padding instead of hiding it in percentage geometry', () => {
    const layout = createBoardLayoutSnapshot(state());
    const prizes = findBoardLayoutRegion(layout, 'local', 'prizes');
    expect(prizes.physicalDeclaredBounds).toEqual({
      x: 9.664,
      y: 435.6,
      width: 57.983999999999995,
      height: 154.8,
    });
    expect(prizes.paddingPx).toEqual({
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    });
    expect(prizes.physicalBorderBoxBounds).toEqual({
      x: 9.664,
      y: 425.6,
      width: 67.984,
      height: 164.8,
    });
    expect(prizes.physicalContentBoxBounds).toEqual({
      x: 14.664,
      y: 430.6,
      width: 57.983999999999995,
      height: 154.8,
    });

    const localBoard = findBoardLayoutRegion(layout, 'local', 'board');
    const opponentBoard = findBoardLayoutRegion(layout, 'opponent', 'board');
    expect(localBoard.playerLocalNormalizedBounds.width).toBe(0.24);
    expect(opponentBoard.playerLocalNormalizedBounds).toMatchObject({
      x: 0.12,
      width: 0.22,
    });
    expect(localBoard.physicalBorderBoxBounds.width).toBeCloseTo(241.936);
    expectRectClose(opponentBoard.physicalBorderBoxBounds, {
      x: 637.824,
      y: 219.6,
      width: 222.608,
      height: 118,
    });
  });

  it('keeps cover-container drops separate from child-image input', () => {
    const layout = createBoardLayoutSnapshot(state());
    for (const kind of ['deck', 'discard', 'lostZone'] as const) {
      const cover = findBoardLayoutRegion(layout, 'local', kind);
      expect(cover.surface).toBe('cover');
      expect(cover.affordances).toEqual(LEGACY_BOARD_AFFORDANCES_V1.zone);
      expect(cover.childCardAffordances).toEqual(
        LEGACY_BOARD_AFFORDANCES_V1.coverCard
      );
    }
  });

  it('contains cover/stadium cards, centers inline and honors physical block alignment', () => {
    const bounds = { x: 10, y: 20, width: 120, height: 100 };
    expectRectClose(layoutLegacyContainedCard(bounds, 0.5, 'start'), {
      x: 45,
      y: 20,
      width: 50,
      height: 100,
    });
    expectRectClose(layoutLegacyContainedCard(bounds, 1, 'start'), {
      x: 20,
      y: 20,
      width: 100,
      height: 100,
    });
    expectRectClose(layoutLegacyContainedCard(bounds, 2, 'start'), {
      x: 10,
      y: 20,
      width: 120,
      height: 60,
    });
    expectRectClose(layoutLegacyContainedCard(bounds, 2, 'end'), {
      x: 10,
      y: 60,
      width: 120,
      height: 60,
    });
  });

  it('selects the source-defined cover card for each pile kind', () => {
    expect(legacyPileTopIndex('deck', 0)).toBeNull();
    expect(legacyPileTopIndex('deck', 4)).toBe(0);
    expect(legacyPileTopIndex('discard', 4)).toBe(3);
    expect(legacyPileTopIndex('lostZone', 4)).toBe(3);
    expect(legacyPileTopIndex('stadium', 1)).toBe(0);
    expect(() => legacyPileTopIndex('stadium', 2)).toThrow('at most one');
    expect(() => legacyPileTopIndex('deck', -1)).toThrow(
      'non-negative integer'
    );
    expect(() => legacyPileTopIndex('deck', 1.5)).toThrow(
      'non-negative integer'
    );
  });

  it('fails closed for invalid contained-card inputs', () => {
    expect(() =>
      layoutLegacyContainedCard(
        { x: 0, y: 0, width: 0, height: 100 },
        CARD_ASPECT_RATIO,
        'start'
      )
    ).toThrow('finite positive dimensions');
    expect(() =>
      layoutLegacyContainedCard(
        { x: Number.NaN, y: 0, width: 100, height: 100 },
        CARD_ASPECT_RATIO,
        'start'
      )
    ).toThrow('finite positive dimensions');
    expect(() =>
      layoutLegacyContainedCard(
        { x: 0, y: 0, width: 100, height: 100 },
        Number.POSITIVE_INFINITY,
        'start'
      )
    ).toThrow('aspect ratio');
    expect(() =>
      layoutLegacyContainedCard(
        { x: 0, y: 0, width: 100, height: 100 },
        CARD_ASPECT_RATIO,
        'middle' as 'start'
      )
    ).toThrow('block alignment');
  });

  it('uses outer viewport units for stadium, controls and resize handles', () => {
    const layout = createBoardLayoutSnapshot(state());
    expect(layout.shared.stadium.physicalDeclaredBounds).toEqual({
      x: 140.8,
      y: 302.40000000000003,
      width: 76.8,
      height: 115.2,
    });
    expect(layout.shared.stadium.affordances).toEqual(['dropCard']);
    expect(layout.shared.stadium.childCardAffordances).toEqual(
      LEGACY_BOARD_AFFORDANCES_V1.ordinaryCard
    );
    expect(layout.shared.boardControlsAnchor.x).toBeCloseTo(665.6);
    expect(layout.shared.boardControlsAnchor.y).toBeCloseTo(338.4);
    expect(layout.shared.boardControlsAnchor.height).toBeCloseTo(43.2);
    expect(
      layout.resizeHandles.map(({ bounds: _bounds, ...handle }) => handle)
    ).toEqual([
      {
        id: 'lower',
        controlsPhysicalSide: 'lower',
        authoredBottomRatio: 0.505,
        cursor: 'row-resize',
        affordances: ['resizeBoard'],
      },
      {
        id: 'upper',
        controlsPhysicalSide: 'upper',
        authoredBottomRatio: 0.53,
        cursor: 'row-resize',
        affordances: ['resizeBoard'],
      },
    ]);
    expectRectClose(layout.resizeHandles[0].bounds, {
      x: -7.04,
      y: 347.4,
      width: 16.64,
      height: 18,
    });
    expectRectClose(layout.resizeHandles[1].bounds, {
      x: -7.04,
      y: 329.4,
      width: 16.64,
      height: 18,
    });
  });

  it('maps flip to player/frame ownership and is an involution', () => {
    const initial = state();
    const flipped = flipBoardLayoutState(initial);
    const layout = createBoardLayoutSnapshot(flipped);
    expect(layout.bottomPlayerId).toBe(red);
    expect(layout.players[0]).toMatchObject({
      playerId: red,
      side: 'local',
      physicalSide: 'lower',
      rotationQuarterTurns: 0,
    });
    expect(layout.players[1]).toMatchObject({
      playerId: blue,
      side: 'opponent',
      physicalSide: 'upper',
      rotationQuarterTurns: 2,
    });
    const lowerBoard = findBoardLayoutRegion(layout, 'local', 'board');
    expect(lowerBoard).toMatchObject({
      playerId: red,
      physicalSide: 'lower',
      playerLocalNormalizedBounds: { x: 0.66, width: 0.24 },
    });
    const upperBoard = findBoardLayoutRegion(layout, 'opponent', 'board');
    expect(upperBoard).toMatchObject({
      playerId: blue,
      physicalSide: 'upper',
      playerLocalNormalizedBounds: { x: 0.12, width: 0.22 },
    });
    expect(lowerBoard.physicalDeclaredBounds.y).toBeGreaterThan(
      upperBoard.physicalDeclaredBounds.y
    );
    expect(flipBoardLayoutState(flipped)).toEqual(initial);
  });

  it('supports independent asymmetric frames and handle-midpoint shared placement', () => {
    const layout = createBoardLayoutSnapshot(
      state({
        viewport: { width: 1600, height: 900, devicePixelRatio: 2 },
        vertical: {
          lowerFrame: { bottomRatio: 0, heightRatio: 0.4 },
          upperFrame: { bottomRatio: 0.65, heightRatio: 0.35 },
          lowerHandle: { bottomRatio: 0.39, heightRatio: 0.025 },
          upperHandle: { bottomRatio: 0.66, heightRatio: 0.025 },
          sharedPlacement: 'handleMidpoint',
        },
      })
    );
    expect(layout.players[0].frameBounds).toEqual({
      x: 0,
      y: 540,
      width: 1208,
      height: 360,
    });
    expect(layout.players[1].frameBounds).toEqual({
      x: 0,
      y: 0,
      width: 1208,
      height: 315,
    });
    expectRectClose(layout.resizeHandles[0].bounds, {
      x: -8.8,
      y: 537.75,
      width: 20.8,
      height: 22.5,
    });
    expectRectClose(layout.resizeHandles[1].bounds, {
      x: -8.8,
      y: 294.75,
      width: 20.8,
      height: 22.5,
    });
    expect(layout.shared.stadium.physicalDeclaredBounds.y).toBeCloseTo(355.5);
    expect(layout.shared.boardControlsAnchor.y).toBeCloseTo(400.5);
  });

  it('models source clamps, extreme handle growth and capped shared placement', () => {
    const vertical = {
      lowerFrame: { bottomRatio: 0, heightRatio: 1.01 },
      upperFrame: { bottomRatio: 1.015, heightRatio: 0.01 },
      lowerHandle: { bottomRatio: 1, heightRatio: 0.025 as const },
      upperHandle: { bottomRatio: 1.025, heightRatio: 0.1 as const },
      sharedPlacement: 'handleMidpoint' as const,
    };
    const layout = createBoardLayoutSnapshot(state({ vertical }));
    expectRectClose(layout.resizeHandles[1].bounds, {
      x: -7.04,
      y: -54,
      width: 16.64,
      height: 72,
    });
    expect(layout.shared.stadium.physicalDeclaredBounds.y).toBeCloseTo(0);
    expect(layout.shared.boardControlsAnchor.y).toBeCloseTo(28.8);

    const oppositeExtreme = {
      lowerFrame: { bottomRatio: 0, heightRatio: 0.01 },
      upperFrame: { bottomRatio: -0.01, heightRatio: 1.01 },
      lowerHandle: { bottomRatio: -0.025, heightRatio: 0.1 as const },
      upperHandle: { bottomRatio: 0, heightRatio: 0.025 as const },
      sharedPlacement: 'handleMidpoint' as const,
    };
    expect(() =>
      createBoardLayoutSnapshot(state({ vertical: oppositeExtreme }))
    ).not.toThrow();
    expect(legacyResizeHandlesCollide(oppositeExtreme, 720)).toBe(true);
    expect(
      legacyResizeHandlesCollide(DEFAULT_BOARD_VERTICAL_LAYOUT_V1, 720)
    ).toBe(false);
  });

  it('pins legacy collision truncation at subpixel and fractional-height boundaries', () => {
    const at900 = (
      lowerBottomPixels: number,
      upperBottomPixels: number,
      lowerHeightRatio: 0.025 | 0.1 = 0.025
    ) =>
      legacyResizeHandlesCollide(
        {
          lowerHandle: {
            bottomRatio: lowerBottomPixels / 900,
            heightRatio: lowerHeightRatio,
          },
          upperHandle: {
            bottomRatio: upperBottomPixels / 900,
            heightRatio: 0.025,
          },
        },
        900
      );

    // 2.5% of 900 is 22.5px; the characterized model rounds offsetHeight to 23.
    expect(at900(450, 472.999)).toBe(true);
    expect(at900(450, 473)).toBe(false);
    expect(at900(450, 473.999)).toBe(false);
    // Both computed CSS bottoms truncate before the strict comparison.
    expect(at900(450.9, 473.1)).toBe(false);
    // parseInt("-0.9px") truncates toward zero rather than flooring to -1.
    expect(at900(-0.9, 71.9, 0.1)).toBe(true);
  });

  it('expands to fullscreen without changing outer-unit shared geometry', () => {
    const normal = createBoardLayoutSnapshot(state());
    const fullscreen = createBoardLayoutSnapshot(
      state({ shellMode: 'fullscreen' })
    );
    expect(fullscreen.playAreaBounds.width).toBe(1280);
    expect(fullscreen.shellGapBounds).toBeNull();
    expect(fullscreen.sidebarBounds).toBeNull();
    expect(fullscreen.tabsBounds).toBeNull();
    expect(fullscreen.shared.stadium).toEqual(normal.shared.stadium);
    expect(fullscreen.shared.boardControlsAnchor.x).toBe(857.6);
    expect(
      findBoardLayoutRegion(fullscreen, 'local', 'bench').physicalDeclaredBounds
        .width
    ).toBeCloseTo(1011.2);
  });

  it('reverses opponent flex order and stack offsets under frame rotation', () => {
    const layout = createBoardLayoutSnapshot(state());
    const localBench = findBoardLayoutRegion(layout, 'local', 'bench');
    const opponentBench = findBoardLayoutRegion(layout, 'opponent', 'bench');
    const ratios = [CARD_ASPECT_RATIO, CARD_ASPECT_RATIO];
    const localCards = layoutLegacyPlaySlotCards(localBench, ratios);
    const opponentCards = layoutLegacyPlaySlotCards(opponentBench, ratios);
    expect(localCards[0]!.x).toBeLessThan(localCards[1]!.x);
    expect(opponentCards[0]!.x).toBeGreaterThan(opponentCards[1]!.x);

    const localStack = layoutLegacyPlayStackHitRegions(
      localCards[0]!,
      'local',
      2,
      1
    );
    expect(localStack[1]!.bounds.y).toBeLessThan(localStack[0]!.bounds.y);
    expect(localStack[2]!.bounds.x).toBeGreaterThan(localStack[0]!.bounds.x);
    const opponentStack = layoutLegacyPlayStackHitRegions(
      opponentCards[0]!,
      'opponent',
      2,
      1
    );
    expect(opponentStack[1]!.bounds.y).toBeGreaterThan(
      opponentStack[0]!.bounds.y
    );
    expect(opponentStack[2]!.bounds.x).toBeLessThan(opponentStack[0]!.bounds.x);
  });

  it('applies the legacy one-percent child margin only to bench rows', () => {
    const layout = createBoardLayoutSnapshot(state());
    const ratio = CARD_ASPECT_RATIO;
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const bench = findBoardLayoutRegion(layout, 'local', 'bench');
    const [activeCard] = layoutLegacyPlaySlotCards(active, [ratio]);
    const [benchCard] = layoutLegacyPlaySlotCards(bench, [ratio]);
    const activeCenteredX =
      active.physicalDeclaredBounds.x +
      (active.physicalDeclaredBounds.width - activeCard!.width) / 2;
    expect(activeCard!.x).toBeCloseTo(activeCenteredX);

    const benchMargin = bench.physicalDeclaredBounds.width * 0.01;
    const benchCenteredOuterX =
      bench.physicalDeclaredBounds.x +
      (bench.physicalDeclaredBounds.width - benchCard!.width - benchMargin) / 2;
    expect(benchCard!.x).toBeCloseTo(benchCenteredOuterX);

    const activeEdgeRatio =
      active.physicalDeclaredBounds.width /
      active.physicalDeclaredBounds.height;
    expect(() =>
      layoutLegacyPlaySlotCards(active, [activeEdgeRatio])
    ).not.toThrow();
    const benchEdgeRatio =
      bench.physicalDeclaredBounds.width / bench.physicalDeclaredBounds.height;
    expect(() => layoutLegacyPlaySlotCards(bench, [benchEdgeRatio])).toThrow(
      'flex shrink'
    );
  });

  it('pins pristine-q0 active marker geometry on both physical sides', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    const localCard = layoutLegacyPlaySlotCards(
      findBoardLayoutRegion(layout, 'local', 'active'),
      [CARD_ASPECT_RATIO]
    )[0]!;
    const opponentCard = layoutLegacyPlaySlotCards(
      findBoardLayoutRegion(layout, 'opponent', 'active'),
      [CARD_ASPECT_RATIO]
    )[0]!;
    expectRectClose(localCard, {
      x: 558.8977272727273,
      y: 481.5,
      width: 90.20454545454545,
      height: 126,
    });
    expectRectClose(opponentCard, {
      x: 558.8977272727273,
      y: 292.5,
      width: 90.20454545454545,
      height: 126,
    });

    const local = layoutLegacyActiveQ0Markers(localCard, 'local');
    expectRectClose(local.damage.bounds, {
      x: 619.0340909090909,
      y: 513,
      width: 30.068181818181817,
      height: 30.068181818181817,
    });
    expectRectClose(local.specialCondition.bounds, {
      x: 558.8977272727273,
      y: 513,
      width: 30.068181818181817,
      height: 30.068181818181817,
    });
    expectRectClose(local.abilityUsed.bounds, {
      x: 558.8977272727273,
      y: 544.5,
      width: 90.20454545454545,
      height: 18.04090909090909,
    });

    const opponent = layoutLegacyActiveQ0Markers(opponentCard, 'opponent');
    expectRectClose(opponent.damage.bounds, {
      x: 558.8977272727273,
      y: 356.9318181818182,
      width: 30.068181818181817,
      height: 30.068181818181817,
    });
    expectRectClose(opponent.specialCondition.bounds, {
      x: 619.0340909090909,
      y: 356.9318181818182,
      width: 30.068181818181817,
      height: 30.068181818181817,
    });
    expectRectClose(opponent.abilityUsed.bounds, {
      x: 558.8977272727273,
      y: 337.4590909090909,
      width: 90.20454545454545,
      height: 18.04090909090909,
    });
    expect(
      [...Object.values(local), ...Object.values(opponent)].map(
        (marker) => marker.sourceZIndex
      )
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('keeps pristine-q0 marker layout pure and rejects invalid inputs', () => {
    const cardBounds = Object.freeze({
      x: -20,
      y: 10,
      width: 60,
      height: 90,
    });
    const before = { ...cardBounds };
    expect(layoutLegacyActiveQ0Markers(cardBounds, 'local')).toEqual({
      damage: {
        bounds: { x: 20, y: 32.5, width: 20, height: 20 },
        sourceZIndex: 1,
      },
      specialCondition: {
        bounds: { x: -20, y: 32.5, width: 20, height: 20 },
        sourceZIndex: 1,
      },
      abilityUsed: {
        bounds: { x: -20, y: 55, width: 60, height: 12 },
        sourceZIndex: 1,
      },
    });
    expect(cardBounds).toEqual(before);

    for (const bounds of [
      { ...cardBounds, x: Number.NaN },
      { ...cardBounds, y: Number.NEGATIVE_INFINITY },
      { ...cardBounds, width: 0 },
      { ...cardBounds, width: -1 },
      { ...cardBounds, width: Number.POSITIVE_INFINITY },
      { ...cardBounds, height: 0 },
      { ...cardBounds, height: -1 },
      { ...cardBounds, height: Number.NaN },
    ]) {
      expect(() => layoutLegacyActiveQ0Markers(bounds, 'local')).toThrow(
        'finite and positive'
      );
    }
    expect(() =>
      layoutLegacyActiveQ0Markers(
        cardBounds,
        'shared' as unknown as 'local' | 'opponent'
      )
    ).toThrow('local or opponent');
  });

  it('pins sole-bench q0 damage and ability geometry on both physical sides', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    const localCard = layoutLegacyPlaySlotCards(
      findBoardLayoutRegion(layout, 'local', 'bench'),
      [CARD_ASPECT_RATIO]
    )[0]!;
    const opponentCard = layoutLegacyPlaySlotCards(
      findBoardLayoutRegion(layout, 'opponent', 'bench'),
      [CARD_ASPECT_RATIO]
    )[0]!;
    expectRectClose(localCard, {
      x: 552.9185136363636,
      y: 630,
      width: 80.53977272727273,
      height: 112.5,
    });
    expectRectClose(opponentCard, {
      x: 574.5417136363636,
      y: 157.5,
      width: 80.53977272727273,
      height: 112.5,
    });

    const local = layoutLegacyBenchQ0Markers(localCard, 'local');
    expect(Object.keys(local)).toEqual(['damage', 'abilityUsed']);
    expect('specialCondition' in local).toBe(false);
    expectRectClose(local.damage.bounds, {
      x: 606.6116954545455,
      y: 658.125,
      width: 26.84659090909091,
      height: 26.84659090909091,
    });
    expectRectClose(local.abilityUsed.bounds, {
      x: 552.9185136363636,
      y: 686.25,
      width: 80.53977272727273,
      height: 16.107954545454547,
    });

    const opponent = layoutLegacyBenchQ0Markers(opponentCard, 'opponent');
    expect(Object.keys(opponent)).toEqual(['damage', 'abilityUsed']);
    expect('specialCondition' in opponent).toBe(false);
    expectRectClose(opponent.damage.bounds, {
      x: 574.5417136363636,
      y: 215.0284090909091,
      width: 26.84659090909091,
      height: 26.84659090909091,
    });
    expectRectClose(opponent.abilityUsed.bounds, {
      x: 574.5417136363636,
      y: 197.64204545454544,
      width: 80.53977272727273,
      height: 16.107954545454547,
    });
    expect(
      [...Object.values(local), ...Object.values(opponent)].map(
        (marker) => marker.sourceZIndex
      )
    ).toEqual([1, 1, 1, 1]);
  });

  it('keeps sole-bench q0 marker layout pure and rejects invalid inputs', () => {
    const cardBounds = Object.freeze({
      x: -20,
      y: 10,
      width: 60,
      height: 90,
    });
    const before = { ...cardBounds };
    expect(layoutLegacyBenchQ0Markers(cardBounds, 'local')).toEqual({
      damage: {
        bounds: { x: 20, y: 32.5, width: 20, height: 20 },
        sourceZIndex: 1,
      },
      abilityUsed: {
        bounds: { x: -20, y: 55, width: 60, height: 12 },
        sourceZIndex: 1,
      },
    });
    expect(cardBounds).toEqual(before);

    for (const bounds of [
      { ...cardBounds, x: Number.NaN },
      { ...cardBounds, y: Number.NEGATIVE_INFINITY },
      { ...cardBounds, width: 0 },
      { ...cardBounds, width: -1 },
      { ...cardBounds, width: Number.POSITIVE_INFINITY },
      { ...cardBounds, height: 0 },
      { ...cardBounds, height: -1 },
      { ...cardBounds, height: Number.NaN },
    ]) {
      expect(() => layoutLegacyBenchQ0Markers(bounds, 'local')).toThrow(
        'finite and positive'
      );
    }
    expect(() =>
      layoutLegacyBenchQ0Markers(
        cardBounds,
        'shared' as unknown as 'local' | 'opponent'
      )
    ).toThrow('local or opponent');
  });

  it('pins stable ordinary-evolution integer reflow on both physical sides', () => {
    const layout = createBoardLayoutSnapshot(
      state({
        viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      })
    );
    const cases = [
      {
        side: 'local',
        slot: 'active',
        flexX: 558.5,
        cardX: 558.5,
        topY: 481.5,
        direction: -1,
      },
      {
        side: 'local',
        slot: 'bench',
        flexX: 552.6884,
        cardX: 552.6884,
        topY: 630,
        direction: -1,
      },
      {
        side: 'opponent',
        slot: 'active',
        flexX: 558.5,
        cardX: 558.9375,
        topY: 292.5,
        direction: 1,
      },
      {
        side: 'opponent',
        slot: 'bench',
        flexX: 574.3116,
        cardX: 574.452225,
        topY: 157.5,
        direction: 1,
      },
    ] as const;
    for (const input of cases) {
      const region = findBoardLayoutRegion(layout, input.side, input.slot);
      const result = layoutLegacyOrdinaryEvolutionStack(region, 736 / 1024, 3);
      expect(result.cssomClientWidth).toBe(input.slot === 'active' ? 91 : 81);
      expect(result.flexItemBounds.x).toBeCloseTo(input.flexX, 5);
      expect(result.flexItemBounds.y).toBeCloseTo(input.topY, 10);
      expect(result.flexItemBounds.width).toBe(result.cssomClientWidth);
      expect(result.cards.map((card) => card.canonicalIndex)).toEqual([
        0, 1, 2,
      ]);
      expect(result.cards.map((card) => card.layerFromTop)).toEqual([2, 1, 0]);
      expect(result.cards.map((card) => card.sourceZIndex)).toEqual([
        -2, -1, 0,
      ]);
      for (const card of result.cards) {
        expect(card.bounds.x).toBeCloseTo(input.cardX, 5);
        expect(card.bounds.width).toBeCloseTo(
          region.physicalDeclaredBounds.height * (736 / 1024),
          10
        );
        expect(card.bounds.y).toBeCloseTo(
          input.topY +
            (input.direction * result.cssomClientWidth * card.layerFromTop) /
              15,
          5
        );
      }
    }

    const localActive = findBoardLayoutRegion(layout, 'local', 'active');
    const localBench = findBoardLayoutRegion(layout, 'local', 'bench');
    const opponentActive = findBoardLayoutRegion(layout, 'opponent', 'active');
    const opponentBench = findBoardLayoutRegion(layout, 'opponent', 'bench');
    const canonicalCases = [
      [localActive, 559, 559],
      [localBench, 552.6884, 552.6884],
      [opponentActive, 559, 558.7954545454545],
      [opponentBench, 574.3116, 574.7718272727273],
    ] as const;
    for (const [region, flexX, cardX] of canonicalCases) {
      const result = layoutLegacyOrdinaryEvolutionStack(
        region,
        CARD_ASPECT_RATIO,
        3
      );
      expect(result.cssomClientWidth).toBe(region.kind === 'active' ? 90 : 81);
      expect(result.flexItemBounds.x).toBeCloseTo(flexX, 5);
      expect(result.cards[2]!.bounds.x).toBeCloseTo(cardX, 5);
      expect(result.cards[0]!.bounds.width).toBeCloseTo(
        region.physicalDeclaredBounds.height * CARD_ASPECT_RATIO,
        10
      );
    }
  });

  it('fails closed outside the characterized ordinary-evolution inputs', () => {
    const layout = createBoardLayoutSnapshot(state());
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(() =>
      layoutLegacyOrdinaryEvolutionStack(hand, CARD_ASPECT_RATIO, 3)
    ).toThrow('active or bench');
    expect(() => layoutLegacyOrdinaryEvolutionStack(active, 0, 3)).toThrow(
      'aspect ratio'
    );
    for (const evolutionCount of [0, 1, 2, 4]) {
      expect(() =>
        layoutLegacyOrdinaryEvolutionStack(
          active,
          CARD_ASPECT_RATIO,
          evolutionCount
        )
      ).toThrow('exactly three');
    }
    expect(() => layoutLegacyOrdinaryEvolutionStack(active, 100, 3)).toThrow(
      'flex shrink'
    );
  });

  it('pins stable one-Energy active geometry from integer CSSOM width', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    for (const side of ['local', 'opponent'] as const) {
      const active = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacySingleEnergyAttachmentStack(
        active,
        CARD_ASPECT_RATIO
      );
      expect(result.baseCssomClientWidth).toBe(90);
      expect(result.attachmentOffset).toBe(15);
      expect(result.authoredWidth).toBe(105);
      expect(result.stableCssomClientWidth).toBe(105);
      expectRectClose(result.flexItemBounds, {
        x: 551.5,
        y: side === 'local' ? 481.5 : 292.5,
        width: 105,
        height: 126,
      });
      expect(result.base.sourceZIndex).toBe(0);
      expect(result.energy.sourceZIndex).toBe(-1);
      expect(result.base.bounds.width).toBeCloseTo(90.20454545454545, 10);
      expect(result.base.bounds.height).toBeCloseTo(126, 10);
      expect(result.energy.bounds.width).toBe(result.base.bounds.width);
      expect(result.energy.bounds.height).toBe(result.base.bounds.height);
      if (side === 'local') {
        expect(result.base.bounds.x).toBeCloseTo(551.5, 10);
        expect(result.energy.bounds.x).toBeCloseTo(566.5, 10);
      } else {
        expect(result.base.bounds.x).toBeCloseTo(566.2954545454545, 10);
        expect(result.energy.bounds.x).toBeCloseTo(551.2954545454545, 10);
      }
    }
  });

  it('fails closed outside one-Energy active geometry inputs', () => {
    const layout = createBoardLayoutSnapshot(state());
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const bench = findBoardLayoutRegion(layout, 'local', 'bench');
    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(() =>
      layoutLegacySingleEnergyAttachmentStack(bench, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    expect(() =>
      layoutLegacySingleEnergyAttachmentStack(hand, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    for (const aspectRatio of [0, -1, Number.NaN]) {
      expect(() =>
        layoutLegacySingleEnergyAttachmentStack(active, aspectRatio)
      ).toThrow('aspect ratio');
    }
    expect(() => layoutLegacySingleEnergyAttachmentStack(active, 100)).toThrow(
      'flex shrink'
    );
    for (const physicalDeclaredBounds of [
      { ...active.physicalDeclaredBounds, x: Number.NaN },
      { ...active.physicalDeclaredBounds, width: 0 },
    ]) {
      expect(() =>
        layoutLegacySingleEnergyAttachmentStack(
          { ...active, physicalDeclaredBounds },
          CARD_ASPECT_RATIO
        )
      ).toThrow('finite and positive');
    }
  });

  it('pins stable two-Energy active geometry from integer CSSOM width', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    const expected = {
      local: {
        flexX: 544,
        baseX: 544,
        energyXs: [559, 574],
      },
      opponent: {
        flexX: 544,
        baseX: 573.7954545454545,
        energyXs: [558.7954545454545, 543.7954545454545],
      },
    } as const;
    for (const side of ['local', 'opponent'] as const) {
      const active = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacyTwoEnergyAttachmentStack(
        active,
        CARD_ASPECT_RATIO
      );
      expect(result.baseCssomClientWidth).toBe(90);
      expect(result.attachmentOffset).toBe(15);
      expect(result.authoredWidth).toBe(120);
      expect(result.stableCssomClientWidth).toBe(120);
      expectRectClose(result.flexItemBounds, {
        x: expected[side].flexX,
        y: side === 'local' ? 481.5 : 292.5,
        width: 120,
        height: 126,
      });
      expect(result.base.sourceZIndex).toBe(0);
      expect(result.energies.map((energy) => energy.sourceZIndex)).toEqual([
        -1, -2,
      ]);
      for (const card of [result.base, ...result.energies]) {
        expect(card.bounds.y).toBeCloseTo(side === 'local' ? 481.5 : 292.5, 10);
        expect(card.bounds.width).toBeCloseTo(90.20454545454545, 10);
        expect(card.bounds.height).toBeCloseTo(126, 10);
      }
      expect(result.base.bounds.x).toBeCloseTo(expected[side].baseX, 10);
      expect(result.energies[0].bounds.x).toBeCloseTo(
        expected[side].energyXs[0],
        10
      );
      expect(result.energies[1].bounds.x).toBeCloseTo(
        expected[side].energyXs[1],
        10
      );
      expect(
        result.energies.map((energy) =>
          Math.abs(energy.bounds.x - result.base.bounds.x)
        )
      ).toEqual([result.attachmentOffset, result.attachmentOffset * 2]);
    }
  });

  it('fails closed outside two-Energy active geometry inputs', () => {
    const layout = createBoardLayoutSnapshot(state());
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const bench = findBoardLayoutRegion(layout, 'local', 'bench');
    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(() =>
      layoutLegacyTwoEnergyAttachmentStack(bench, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    expect(() =>
      layoutLegacyTwoEnergyAttachmentStack(hand, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    expect(() =>
      layoutLegacyTwoEnergyAttachmentStack(
        { ...active, surface: 'zone' },
        CARD_ASPECT_RATIO
      )
    ).toThrow('active play slot');
    for (const aspectRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        layoutLegacyTwoEnergyAttachmentStack(active, aspectRatio)
      ).toThrow('aspect ratio');
    }
    expect(() => layoutLegacyTwoEnergyAttachmentStack(active, 100)).toThrow(
      'flex shrink'
    );
    for (const physicalDeclaredBounds of [
      { ...active.physicalDeclaredBounds, x: Number.NaN },
      { ...active.physicalDeclaredBounds, y: Number.NEGATIVE_INFINITY },
      { ...active.physicalDeclaredBounds, width: 0 },
      { ...active.physicalDeclaredBounds, width: -1 },
      { ...active.physicalDeclaredBounds, height: 0 },
      { ...active.physicalDeclaredBounds, height: -1 },
    ]) {
      expect(() =>
        layoutLegacyTwoEnergyAttachmentStack(
          { ...active, physicalDeclaredBounds },
          CARD_ASPECT_RATIO
        )
      ).toThrow('finite and positive');
    }
    expect(() =>
      layoutLegacyTwoEnergyAttachmentStack(
        {
          ...active,
          physicalDeclaredBounds: {
            ...active.physicalDeclaredBounds,
            height: 0.1,
          },
        },
        0.1
      )
    ).toThrow('CSSOM base width');
  });

  it('pins stable one-Trainer-as-Tool active geometry and trailing margin', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    const expected = {
      local: {
        flexX: 547.6344,
        y: 481.5,
        baseX: 547.6344,
        toolX: 562.6344,
      },
      opponent: {
        flexX: 555.3656,
        y: 292.5,
        baseX: 570.1610545454545,
        toolX: 555.1610545454545,
      },
    } as const;
    for (const side of ['local', 'opponent'] as const) {
      const active = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacySingleTrainerToolAttachmentStack(
        active,
        CARD_ASPECT_RATIO
      );
      expect(result.baseCssomClientWidth).toBe(90);
      expect(result.attachmentOffset).toBe(15);
      expect(result.authoredWidth).toBe(105);
      expect(result.stableCssomClientWidth).toBe(105);
      expect(result.marginRight).toBeCloseTo(7.7312, 10);
      expectRectClose(result.flexItemBounds, {
        x: expected[side].flexX,
        y: expected[side].y,
        width: 105,
        height: 126,
      });
      expect(result.base.sourceZIndex).toBe(0);
      expect(result.tool.sourceZIndex).toBe(-1);
      expect(Object.keys(result.base).sort()).toEqual([
        'bounds',
        'sourceZIndex',
      ]);
      expect(Object.keys(result.tool).sort()).toEqual([
        'bounds',
        'sourceZIndex',
      ]);
      for (const card of [result.base, result.tool]) {
        expect(card.bounds.y).toBeCloseTo(expected[side].y, 10);
        expect(card.bounds.width).toBeCloseTo(90.20454545454545, 10);
        expect(card.bounds.height).toBeCloseTo(126, 10);
      }
      expect(result.base.bounds.x).toBeCloseTo(expected[side].baseX, 10);
      expect(result.tool.bounds.x).toBeCloseTo(expected[side].toolX, 10);
      expect(Math.abs(result.tool.bounds.x - result.base.bounds.x)).toBe(
        result.attachmentOffset
      );
    }
  });

  it('fails closed outside one-Trainer-as-Tool active geometry inputs', () => {
    const layout = createBoardLayoutSnapshot(state());
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const bench = findBoardLayoutRegion(layout, 'local', 'bench');
    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(() =>
      layoutLegacySingleTrainerToolAttachmentStack(bench, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    expect(() =>
      layoutLegacySingleTrainerToolAttachmentStack(hand, CARD_ASPECT_RATIO)
    ).toThrow('active play slot');
    expect(() =>
      layoutLegacySingleTrainerToolAttachmentStack(
        { ...active, surface: 'zone' },
        CARD_ASPECT_RATIO
      )
    ).toThrow('active play slot');
    for (const aspectRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        layoutLegacySingleTrainerToolAttachmentStack(active, aspectRatio)
      ).toThrow('aspect ratio');
    }
    expect(() =>
      layoutLegacySingleTrainerToolAttachmentStack(active, 100)
    ).toThrow('flex shrink');
    for (const physicalDeclaredBounds of [
      { ...active.physicalDeclaredBounds, x: Number.NaN },
      { ...active.physicalDeclaredBounds, y: Number.NEGATIVE_INFINITY },
      { ...active.physicalDeclaredBounds, width: 0 },
      { ...active.physicalDeclaredBounds, width: -1 },
      { ...active.physicalDeclaredBounds, height: 0 },
      { ...active.physicalDeclaredBounds, height: -1 },
    ]) {
      expect(() =>
        layoutLegacySingleTrainerToolAttachmentStack(
          { ...active, physicalDeclaredBounds },
          CARD_ASPECT_RATIO
        )
      ).toThrow('finite and positive');
    }
    expect(() =>
      layoutLegacySingleTrainerToolAttachmentStack(
        {
          ...active,
          physicalDeclaredBounds: {
            ...active.physicalDeclaredBounds,
            height: 0.1,
          },
        },
        0.1
      )
    ).toThrow('CSSOM base width');
  });

  it('pins canonical one-Energy/Trainer-as-Tool active and bench geometry', () => {
    const layout = createBoardLayoutSnapshot(
      state({ viewport: { width: 1600, height: 900, devicePixelRatio: 1 } })
    );
    const expected = {
      local: {
        active: {
          flexX: 540.1344,
          baseX: 540.1344,
          energyX: 555.1344,
          toolX: 570.1344,
        },
        bench: {
          flexX: 534.4168,
          baseX: 534.4168,
          energyX: 547.9168,
          toolX: 561.4168,
        },
      },
      opponent: {
        active: {
          flexX: 547.8656,
          baseX: 577.6610545454545,
          energyX: 562.6610545454545,
          toolX: 547.6610545454545,
        },
        bench: {
          flexX: 565.5832,
          baseX: 593.0434272727273,
          energyX: 579.5434272727273,
          toolX: 566.0434272727273,
        },
      },
    } as const;
    for (const side of ['local', 'opponent'] as const) {
      for (const kind of ['active', 'bench'] as const) {
        const region = findBoardLayoutRegion(layout, side, kind);
        const result = layoutLegacySingleEnergyTrainerToolAttachmentStack(
          region,
          CARD_ASPECT_RATIO
        );
        const baseWidth =
          kind === 'active' ? 90.20454545454545 : 80.53977272727273;
        const cardHeight = kind === 'active' ? 126 : 112.5;
        const baseCssomClientWidth = kind === 'active' ? 90 : 81;
        const attachmentOffset = kind === 'active' ? 15 : 13.5;
        const authoredWidth = kind === 'active' ? 120 : 108;
        expect(result.baseCssomClientWidth).toBe(baseCssomClientWidth);
        expect(result.attachmentOffset).toBe(attachmentOffset);
        expect(result.authoredWidth).toBe(authoredWidth);
        expect(result.stableCssomClientWidth).toBe(authoredWidth);
        expect(result.marginRight).toBeCloseTo(
          region.physicalDeclaredBounds.width * 0.02,
          10
        );
        expectRectClose(result.flexItemBounds, {
          x: expected[side][kind].flexX,
          y: region.physicalDeclaredBounds.y,
          width: authoredWidth,
          height: cardHeight,
        });
        expect(result.base.sourceZIndex).toBe(0);
        expect(result.energy.sourceZIndex).toBe(-1);
        expect(result.tool.sourceZIndex).toBe(-2);
        for (const card of [result.base, result.energy, result.tool]) {
          expect(card.bounds.y).toBeCloseTo(
            region.physicalDeclaredBounds.y,
            10
          );
          expect(card.bounds.width).toBeCloseTo(baseWidth, 10);
          expect(card.bounds.height).toBeCloseTo(cardHeight, 10);
        }
        expect(result.base.bounds.x).toBeCloseTo(
          expected[side][kind].baseX,
          10
        );
        expect(result.energy.bounds.x).toBeCloseTo(
          expected[side][kind].energyX,
          10
        );
        expect(result.tool.bounds.x).toBeCloseTo(
          expected[side][kind].toolX,
          10
        );
        expect(Math.abs(result.energy.bounds.x - result.base.bounds.x)).toBe(
          result.attachmentOffset
        );
        expect(Math.abs(result.tool.bounds.x - result.base.bounds.x)).toBe(
          result.attachmentOffset * 2
        );
      }
    }
  });

  it('fails closed outside one-Energy/Trainer-as-Tool layout inputs', () => {
    const layout = createBoardLayoutSnapshot(state());
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const hand = findBoardLayoutRegion(layout, 'local', 'hand');
    expect(() =>
      layoutLegacySingleEnergyTrainerToolAttachmentStack(
        hand,
        CARD_ASPECT_RATIO
      )
    ).toThrow('active or bench');
    expect(() =>
      layoutLegacySingleEnergyTrainerToolAttachmentStack(
        { ...active, surface: 'zone' },
        CARD_ASPECT_RATIO
      )
    ).toThrow('active or bench');
    for (const aspectRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        layoutLegacySingleEnergyTrainerToolAttachmentStack(active, aspectRatio)
      ).toThrow('aspect ratio');
    }
    expect(() =>
      layoutLegacySingleEnergyTrainerToolAttachmentStack(active, 100)
    ).toThrow('flex shrink');
    for (const physicalDeclaredBounds of [
      { ...active.physicalDeclaredBounds, x: Number.NaN },
      { ...active.physicalDeclaredBounds, y: Number.NEGATIVE_INFINITY },
      { ...active.physicalDeclaredBounds, width: 0 },
      { ...active.physicalDeclaredBounds, width: -1 },
      { ...active.physicalDeclaredBounds, height: 0 },
      { ...active.physicalDeclaredBounds, height: -1 },
    ]) {
      expect(() =>
        layoutLegacySingleEnergyTrainerToolAttachmentStack(
          { ...active, physicalDeclaredBounds },
          CARD_ASPECT_RATIO
        )
      ).toThrow('finite and positive');
    }
    expect(() =>
      layoutLegacySingleEnergyTrainerToolAttachmentStack(
        {
          ...active,
          physicalDeclaredBounds: {
            ...active.physicalDeclaredBounds,
            height: 0.1,
          },
        },
        0.1
      )
    ).toThrow('CSSOM base width');
  });

  it('fails closed for invalid viewport, player, frame and handle inputs', () => {
    expect(() =>
      createBoardLayoutSnapshot(
        state({ viewport: { width: 0, height: 720, devicePixelRatio: 1 } })
      )
    ).toThrow('positive');
    expect(() =>
      createBoardLayoutSnapshot(state({ playerIds: [blue, blue] }))
    ).toThrow('distinct');
    expect(() =>
      createBoardLayoutSnapshot(
        state({
          playerIds: [
            blue,
            red,
            asPlayerId('unexpected'),
          ] as unknown as BoardLayoutState['playerIds'],
        })
      )
    ).toThrow('exactly two players');
    expect(() =>
      createBoardLayoutSnapshot(
        state({
          shellMode: 'unexpected' as BoardLayoutState['shellMode'],
        })
      )
    ).toThrow('Unsupported board shell mode');
    expect(() =>
      createBoardLayoutSnapshot(
        state({
          vertical: {
            ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
            sharedPlacement: 'unexpected',
          } as unknown as BoardLayoutState['vertical'],
        })
      )
    ).toThrow('Unsupported board shared placement');
    expect(() =>
      createBoardLayoutSnapshot(
        state({ bottomPlayerId: asPlayerId('missing') })
      )
    ).toThrow('Bottom player');
    expect(() =>
      createBoardLayoutSnapshot(
        state({
          vertical: {
            ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
            lowerFrame: { bottomRatio: 0, heightRatio: 1.026 },
          },
        })
      )
    ).toThrow('overscan');
    expect(() =>
      createBoardLayoutSnapshot(
        state({
          vertical: {
            ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
            upperHandle: { bottomRatio: 1.026, heightRatio: 0.1 },
          },
        })
      )
    ).toThrow('clamping');
  });
});
