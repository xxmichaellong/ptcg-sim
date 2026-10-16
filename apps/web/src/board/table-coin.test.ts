import { asPlayerId } from '@ptcgsim/game-core';
import {
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  createTableLayoutSnapshot,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type Rect,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  TABLE_COIN_MAX_PX,
  TABLE_COIN_MIN_PX,
  tableCoinSpots,
} from './table-coin.js';

const blue = asPlayerId('spike-blue');
const red = asPlayerId('spike-red');
const layoutAt = (
  width: number,
  height: number,
  overrides: Partial<BoardLayoutState> = {}
): BoardLayoutSnapshot =>
  createTableLayoutSnapshot({
    geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
    viewport: { width, height, devicePixelRatio: 1 },
    playerIds: [blue, red],
    bottomPlayerId: blue,
    shellMode: 'fullscreen',
    vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
    ...overrides,
  });

const overlaps = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;
const centre = (rect: Rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});
const active = (layout: BoardLayoutSnapshot, playerId: string): Rect =>
  layout.players
    .find((frame) => frame.playerId === playerId)!
    .regions.find((region) => region.kind === 'active')!.physicalDeclaredBounds;

const SIZES: readonly (readonly [number, number])[] = [
  [1440, 900],
  [1280, 720],
  [1024, 700],
  [1920, 1080],
  [390, 844],
  [360, 740],
  [844, 390],
];

describe('tableCoinSpots', () => {
  it('lays each coin on clear felt beside its own Active, never on anything', () => {
    for (const [width, height] of SIZES) {
      for (const overrides of [
        {},
        { oncePerGameMarkers: 2 },
        { hideEmptyLostZone: true },
        { farCardsUpright: true },
      ] as const) {
        const layout = layoutAt(width, height, overrides);
        const label = `${width}x${height} ${JSON.stringify(overrides)}`;
        const spots = tableCoinSpots(layout);
        const taken = [
          ...layout.players.flatMap((frame) => [
            ...frame.regions.map((region) => region.physicalDeclaredBounds),
            ...(frame.extras?.markers ? [frame.extras.markers] : []),
            ...(frame.extras ? [frame.extras.control] : []),
          ]),
          layout.shared.stadium.physicalDeclaredBounds,
        ];
        for (const spot of spots) {
          expect(spot.rect.width, label).toBe(spot.rect.height);
          expect(spot.rect.width, label).toBeGreaterThanOrEqual(
            TABLE_COIN_MIN_PX
          );
          expect(spot.rect.width, label).toBeLessThanOrEqual(TABLE_COIN_MAX_PX);
          for (const rect of taken)
            expect(overlaps(spot.rect, rect), label).toBe(false);
          const play = layout.playAreaBounds;
          expect(spot.rect.x, label).toBeGreaterThanOrEqual(play.x);
          expect(spot.rect.x + spot.rect.width, label).toBeLessThanOrEqual(
            play.x + play.width
          );
          // Level with the Active's row, on the player's own right: the far
          // half is turned around, so theirs is to the viewer's left.
          const own = active(layout, spot.playerId);
          const at = centre(spot.rect);
          expect(at.y, label).toBeGreaterThanOrEqual(own.y);
          expect(at.y, label).toBeLessThanOrEqual(own.y + own.height);
          if (spot.own) expect(at.x, label).toBeGreaterThan(own.x + own.width);
          else expect(at.x, label).toBeLessThan(own.x);
        }
      }
    }
  });

  it('gives both players a coin on a desktop table and a phone', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [390, 844],
    ] as const) {
      const spots = tableCoinSpots(layoutAt(width, height));
      expect(
        spots.map((spot) => [spot.playerId, spot.own]),
        `${width}x${height}`
      ).toEqual([
        [blue, true],
        [red, false],
      ]);
    }
  });

  it('keeps the coin level with the Active where the row is clear', () => {
    const layout = layoutAt(1440, 900);
    const [own] = tableCoinSpots(layout);
    const activeRect = active(layout, blue);
    expect(centre(own!.rect).y).toBeCloseTo(
      activeRect.y + activeRect.height / 2,
      6
    );
    // Past the Stadium, in the felt the far player's staging area mirrors.
    const stadium = layout.shared.stadium.physicalDeclaredBounds;
    expect(own!.rect.x).toBeGreaterThan(stadium.x + stadium.width);
  });

  it('drops below the Stadium where it reaches into a phone’s row', () => {
    const layout = layoutAt(390, 844);
    const own = tableCoinSpots(layout).find((spot) => spot.own)!;
    const stadium = layout.shared.stadium.physicalDeclaredBounds;
    expect(own.rect.y).toBeGreaterThanOrEqual(stadium.y + stadium.height);
  });

  it('has no coin for a hidden half', () => {
    const mine = tableCoinSpots(
      layoutAt(1440, 900, { hiddenPhysicalSide: 'upper' })
    );
    expect(mine.map((spot) => spot.playerId)).toEqual([blue]);
    const theirs = tableCoinSpots(
      layoutAt(1440, 900, { hiddenPhysicalSide: 'lower' })
    );
    expect(theirs.map((spot) => [spot.playerId, spot.own])).toEqual([
      [red, false],
    ]);
  });

  it('has no coin where the row has no room for one', () => {
    expect(tableCoinSpots(layoutAt(200, 300))).toEqual([]);
  });
});
