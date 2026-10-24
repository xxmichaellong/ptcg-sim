import { asPlayerId } from '@ptcgsim/game-core';
import {
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_COIN_MAX_PX,
  TABLE_COIN_MIN_PX,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  createTableLayoutSnapshot,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type Rect,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { tableCoinSpots } from './table-coin.js';

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
  it('lays each coin under its markers beside its prizes, never on anything', () => {
    for (const [width, height] of SIZES) {
      for (const overrides of [
        {},
        { oncePerGameMarkers: 2 },
        { oncePerGameMarkers: 1 },
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
          // In the Active's row, on the player's own left: the far half is
          // turned around, so theirs is to the viewer's right.
          const own = active(layout, spot.playerId);
          expect(spot.rect.y, label).toBeGreaterThanOrEqual(own.y - 0.01);
          expect(spot.rect.y + spot.rect.height, label).toBeLessThanOrEqual(
            own.y + own.height + 0.01
          );
          if (spot.own) {
            expect(spot.rect.x + spot.rect.width, label).toBeLessThan(own.x);
          } else {
            expect(spot.rect.x, label).toBeGreaterThan(own.x + own.width);
          }
          // Under the markers, in their column.
          const markers = layout.players.find(
            (frame) => frame.playerId === spot.playerId
          )!.extras?.markers;
          if (markers) {
            expect(centre(spot.rect).x, label).toBeCloseTo(
              centre(markers).x,
              6
            );
            if (spot.own) {
              expect(spot.rect.y, label).toBeGreaterThan(
                markers.y + markers.height
              );
            } else {
              expect(spot.rect.y + spot.rect.height, label).toBeLessThan(
                markers.y
              );
            }
          }
        }
      }
    }
  });

  it('gives both players a coin on a desktop table, and the near one on a phone', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1920, 1080],
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
    expect(
      tableCoinSpots(layoutAt(390, 844)).find((spot) => spot.own)?.playerId
    ).toBe(blue);
  });

  it('lies where the markers would start with none, and in the same place on both halves', () => {
    const layout = layoutAt(1440, 900);
    const [own, theirs] = tableCoinSpots(layout);
    const mine = active(layout, blue);
    const far = active(layout, red);
    // At the top of the row toward the middle of the table: the far half's
    // is turned around.
    expect(own!.rect.y).toBeCloseTo(mine.y, 6);
    expect(theirs!.rect.y + theirs!.rect.height).toBeCloseTo(
      far.y + far.height,
      6
    );
    // Beside each player's own prizes, within a coin of them.
    const prizesOf = (playerId: string): Rect =>
      layout.players
        .find((frame) => frame.playerId === playerId)!
        .regions.find((region) => region.kind === 'prizes')!
        .physicalDeclaredBounds;
    const ownPrizes = prizesOf(blue);
    const farPrizes = prizesOf(red);
    const fromOwn = own!.rect.x - (ownPrizes.x + ownPrizes.width);
    const fromFar = farPrizes.x - (theirs!.rect.x + theirs!.rect.width);
    for (const [gap, coin] of [
      [fromOwn, own!.rect.width],
      [fromFar, theirs!.rect.width],
    ] as const) {
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(coin);
    }
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
