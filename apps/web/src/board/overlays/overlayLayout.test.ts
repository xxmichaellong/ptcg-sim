import { CARD_ASPECT_RATIO } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  OVERLAY_CARD_MAX_HEIGHT,
  OVERLAY_CARD_MIN_HEIGHT,
  OVERLAY_PANEL_MAX_WIDTH,
  overlayBoardMargin,
  overlayLargeCardHeight,
  stackPreviewLayout,
  workAreaPanelLayout,
  zoneBrowserLayout,
  type OverlayBoardSize,
  type OverlayPanelLayout,
} from './overlayLayout.js';

/** The board column of a 1440 x 900 window (75.5% wide, full height). */
const LAPTOP: OverlayBoardSize = { width: 1087, height: 900 };
const HD: OverlayBoardSize = { width: 1450, height: 1080 };
const SMALL: OverlayBoardSize = { width: 1280, height: 720 };
/** v1's "Looking at cards..." card at 1440 x 900, the size players could not read. */
const V1_WORK_AREA_CARD_HEIGHT = 111;

const expectOnBoard = (
  layout: OverlayPanelLayout,
  board: OverlayBoardSize
): void => {
  const margin = overlayBoardMargin(board);
  expect(layout.left).toBeGreaterThanOrEqual(margin - 1e-9);
  expect(layout.top).toBeGreaterThanOrEqual(margin - 1e-9);
  expect(layout.left + layout.width).toBeLessThanOrEqual(
    board.width - margin + 1e-9
  );
  expect(layout.top + layout.height).toBeLessThanOrEqual(
    board.height - margin + 1e-9
  );
};

describe('overlay layout', () => {
  it('sizes cards from the board: a third of its height, at most 300px', () => {
    expect(overlayLargeCardHeight(LAPTOP)).toBe(OVERLAY_CARD_MAX_HEIGHT);
    expect(overlayLargeCardHeight(SMALL)).toBeCloseTo(720 * 0.34);
    expect(overlayLargeCardHeight({ width: 300, height: 100 })).toBe(
      OVERLAY_CARD_MIN_HEIGHT
    );
    expect(overlayBoardMargin(LAPTOP)).toBe(27);
    expect(overlayBoardMargin({ width: 200, height: 200 })).toBe(12);
    expect(overlayBoardMargin({ width: 4000, height: 2000 })).toBe(32);
  });

  it('opens a small pile at full size, centred and fitted to its cards', () => {
    for (const board of [LAPTOP, HD, SMALL]) {
      const layout = zoneBrowserLayout(board, 3);
      expect(layout.cardHeight).toBe(overlayLargeCardHeight(board));
      expect(layout.cardHeight).toBeGreaterThan(2 * V1_WORK_AREA_CARD_HEIGHT);
      expectOnBoard(layout, board);
      expect(layout.left + layout.width / 2).toBeCloseTo(board.width / 2);
      expect(layout.top + layout.height / 2).toBeCloseTo(board.height / 2);
      // One row: the panel is no taller than a row of cards and its chrome.
      expect(layout.height).toBeLessThan(layout.cardHeight * 2);
    }
    const empty = zoneBrowserLayout(LAPTOP, 0);
    expect(empty.cardHeight).toBe(OVERLAY_CARD_MAX_HEIGHT);
    expectOnBoard(empty, LAPTOP);
  });

  it('steps a big pile down to the compact size and uses the board to show it', () => {
    const deck = zoneBrowserLayout(LAPTOP, 47);
    expect(deck.cardHeight).toBeLessThan(overlayLargeCardHeight(LAPTOP));
    expect(deck.cardHeight).toBeCloseTo(Math.min(900 * 0.24, 216));
    // Still about twice v1's deck browser card (74px tall at this size).
    expect(deck.cardHeight).toBeGreaterThan(2 * 74);
    expectOnBoard(deck, LAPTOP);
    expect(deck.height).toBe(LAPTOP.height - 2 * overlayBoardMargin(LAPTOP));
    const columns = Math.floor(
      (deck.width - 2 * 16 - 2 - 12 + 12) /
        (deck.cardHeight * CARD_ASPECT_RATIO + 12)
    );
    expect(columns).toBeGreaterThanOrEqual(5);

    const wide = zoneBrowserLayout({ width: 3000, height: 1200 }, 60);
    expect(wide.width).toBeLessThanOrEqual(OVERLAY_PANEL_MAX_WIDTH);
    expect(wide.left + wide.width / 2).toBeCloseTo(1500);
  });

  it('keeps a pile that fits in two large rows at the large size', () => {
    const contentWidth = LAPTOP.width - 2 * 27 - 2 * 16 - 2 - 12;
    const perRow = Math.floor(
      (contentWidth + 12) / (300 * CARD_ASPECT_RATIO + 12)
    );
    expect(zoneBrowserLayout(LAPTOP, perRow * 2).cardHeight).toBe(300);
    expect(zoneBrowserLayout(LAPTOP, perRow * 2 + 1).cardHeight).toBe(216);
  });

  it('grows a work area around the scene box it covers, on the board', () => {
    // Where the v1 geometry puts "Looking at cards..." on the lower half.
    const zone = { x: 141.5, y: 492.75, width: 792, height: 380 };
    for (const count of [1, 3, 12]) {
      const layout = workAreaPanelLayout(zone, LAPTOP, count, true);
      expect(layout.cardHeight).toBe(300);
      expect(layout.cardHeight).toBeGreaterThan(2.5 * V1_WORK_AREA_CARD_HEIGHT);
      expectOnBoard(layout, LAPTOP);
      // It always covers the box where the scene paints its own copies.
      expect(layout.left).toBeLessThanOrEqual(zone.x);
      expect(layout.top).toBeLessThanOrEqual(zone.y);
      expect(layout.left + layout.width).toBeGreaterThanOrEqual(
        zone.x + zone.width
      );
      expect(layout.top + layout.height).toBeGreaterThanOrEqual(
        zone.y + zone.height
      );
    }
    // Many cards scroll in a row as wide as the board allows.
    expect(workAreaPanelLayout(zone, LAPTOP, 12, true).width).toBe(
      LAPTOP.width - 2 * 27
    );
    // A read-only panel has no button row, so its cards keep the room.
    const small = { width: 1280, height: 600 };
    const readOnly = workAreaPanelLayout(
      { x: 200, y: 300, width: 600, height: 250 },
      small,
      2,
      false
    );
    const interactive = workAreaPanelLayout(
      { x: 200, y: 300, width: 600, height: 250 },
      small,
      2,
      true
    );
    expect(readOnly.height).toBeLessThan(interactive.height);
  });

  it('lays a stack out upright over its half, in up to three rows', () => {
    const frame = { x: 0, y: 450, width: 1087, height: 450 };
    const pair = stackPreviewLayout(frame, LAPTOP, 2);
    expect(pair.cardHeight).toBe(300);
    expectOnBoard(pair, LAPTOP);
    expect(pair.left + pair.width / 2).toBeCloseTo(1087 / 2);

    const big = stackPreviewLayout(frame, LAPTOP, 9);
    expectOnBoard(big, LAPTOP);
    expect(big.cardHeight).toBeGreaterThan(150);
    expect(big.cardHeight).toBeLessThanOrEqual(300);

    const upper = stackPreviewLayout(
      { x: 0, y: 0, width: 1087, height: 450 },
      LAPTOP,
      2
    );
    expect(upper.top).toBeLessThan(pair.top);
    expectOnBoard(upper, LAPTOP);
  });
});
