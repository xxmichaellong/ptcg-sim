import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { CARD_ASPECT_RATIO } from './geometry.js';
import type { BoardLayoutState } from './layout.js';
import {
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_CONTROL_CORNER_PX,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  createLayoutSnapshotFor,
  createTableLayoutSnapshot,
  layoutTableHand,
  layoutTablePrizes,
  resizeLayoutStateFor,
  tableRailWidth,
} from './layout-table.js';
import type { Rect } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const blue = asPlayerId('spike-blue');
const red = asPlayerId('spike-red');
const stateAt = (
  width: number,
  height: number,
  overrides: Partial<BoardLayoutState> = {}
): BoardLayoutState => ({
  geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
  viewport: { width, height, devicePixelRatio: 1 },
  playerIds: [blue, red],
  bottomPlayerId: blue,
  shellMode: 'sidebar',
  vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
  ...overrides,
});
const region = (
  snapshot: ReturnType<typeof createTableLayoutSnapshot>,
  side: 'local' | 'opponent',
  kind: string
) =>
  snapshot.players
    .find((player) => player.side === side)!
    .regions.find((candidate) => candidate.kind === kind)!;
const inside = (rect: Rect, outer: Rect) =>
  rect.x >= outer.x - 0.01 &&
  rect.y >= outer.y - 0.01 &&
  rect.x + rect.width <= outer.x + outer.width + 0.01 &&
  rect.y + rect.height <= outer.y + outer.height + 0.01;
const overlaps = (left: Rect, right: Rect) =>
  left.x < right.x + right.width - 0.01 &&
  right.x < left.x + left.width - 0.01 &&
  left.y < right.y + right.height - 0.01 &&
  right.y < left.y + left.height - 0.01;

describe('table layout (geometry v2)', () => {
  it('gives the table everything but a clamped rail', () => {
    expect(tableRailWidth(1280)).toBe(300);
    expect(tableRailWidth(1440)).toBe(331);
    expect(tableRailWidth(2560)).toBe(380);
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    expect(snapshot.geometryVersion).toBe(2);
    expect(snapshot.playAreaBounds).toEqual({
      x: 0,
      y: 0,
      width: 1109,
      height: 900,
    });
    expect(snapshot.sidebarBounds).toEqual({
      x: 1109,
      y: 0,
      width: 331,
      height: 900,
    });
    const full = createTableLayoutSnapshot(
      stateAt(1440, 900, { shellMode: 'fullscreen' })
    );
    expect(full.playAreaBounds.width).toBe(1440);
    expect(full.sidebarBounds).toBeNull();
  });

  it('lays each half out like the play mat without regions colliding', () => {
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    for (const side of ['local', 'opponent'] as const) {
      const player = snapshot.players.find(
        (candidate) => candidate.side === side
      )!;
      const kinds = player.regions.map((candidate) => candidate.kind).sort();
      expect(kinds).toEqual(
        [
          'active',
          'bench',
          'board',
          'deck',
          'discard',
          'hand',
          'lostZone',
          'prizes',
        ].sort()
      );
      for (const candidate of player.regions) {
        expect(
          inside(candidate.physicalDeclaredBounds, player.frameBounds),
          `${side} ${candidate.kind}`
        ).toBe(true);
      }
      for (const left of player.regions) {
        for (const right of player.regions) {
          if (left === right) continue;
          expect(
            overlaps(left.physicalDeclaredBounds, right.physicalDeclaredBounds),
            `${side} ${left.kind} / ${right.kind}`
          ).toBe(false);
        }
      }
    }
    // The viewer's mat: prizes left of the Active, deck right, hand at the
    // bottom edge, the Active nearest the centre line.
    const prizes = region(snapshot, 'local', 'prizes').physicalDeclaredBounds;
    const active = region(snapshot, 'local', 'active').physicalDeclaredBounds;
    const deck = region(snapshot, 'local', 'deck').physicalDeclaredBounds;
    const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
    expect(prizes.x).toBeLessThan(active.x);
    expect(deck.x).toBeGreaterThan(active.x + active.width);
    expect(hand.y + hand.height).toBeCloseTo(900, 5);
    expect(active.y).toBeLessThan(hand.y);
    // The opponent's mat is turned around: their prizes on the right, their
    // hand along the top edge.
    const theirPrizes = region(
      snapshot,
      'opponent',
      'prizes'
    ).physicalDeclaredBounds;
    const theirHand = region(
      snapshot,
      'opponent',
      'hand'
    ).physicalDeclaredBounds;
    expect(theirPrizes.x).toBeGreaterThan(active.x);
    expect(theirHand.y).toBeCloseTo(0, 5);
    // Behaviour comes from v1's regions: the same surfaces and affordances.
    const v1 = createLayoutSnapshotFor({
      ...stateAt(1440, 900),
      geometryVersion: 1,
      vertical: {
        lowerFrame: { bottomRatio: 0, heightRatio: 0.5 },
        upperFrame: { bottomRatio: 0.5, heightRatio: 0.5 },
        lowerHandle: { bottomRatio: 0.505, heightRatio: 0.025 },
        upperHandle: { bottomRatio: 0.53, heightRatio: 0.025 },
        sharedPlacement: 'cssDefault',
      },
    });
    for (const kind of ['hand', 'deck', 'prizes', 'active']) {
      const legacy = v1.players[0].regions.find(
        (candidate) => candidate.kind === kind
      )!;
      const table = region(snapshot, 'local', kind);
      expect(table.surface).toBe(legacy.surface);
      expect(table.affordances).toEqual(legacy.affordances);
    }
  });

  it("keeps the seam clear for the table controls and a corner for each player's markers", () => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(stateAt(width, height));
      const controls = snapshot.shared.boardControlsAnchor;
      for (const player of snapshot.players) {
        for (const candidate of player.regions) {
          const rect = candidate.physicalDeclaredBounds;
          const clear =
            rect.y >= controls.y + controls.height - 0.01 ||
            rect.y + rect.height <= controls.y + 0.01;
          expect(clear, `${width} ${player.side} ${candidate.kind}`).toBe(true);
        }
      }
      // The hand starts after its owner's marker corner.
      const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
      const prizes = region(snapshot, 'local', 'prizes').physicalDeclaredBounds;
      expect(hand.x - prizes.x).toBeGreaterThanOrEqual(TABLE_CONTROL_CORNER_PX);
    }
  });

  it('makes the cards readable at common desktop sizes', () => {
    for (const [width, height, minimum] of [
      [1440, 900, { active: 150, bench: 130, hand: 150 }],
      [1920, 1080, { active: 180, bench: 155, hand: 180 }],
      [1280, 720, { active: 120, bench: 100, hand: 120 }],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(stateAt(width, height));
      const active = region(snapshot, 'local', 'active').physicalDeclaredBounds;
      const bench = region(snapshot, 'local', 'bench').physicalDeclaredBounds;
      const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
      expect(active.height, `${width} active`).toBeGreaterThanOrEqual(
        minimum.active
      );
      expect(bench.height, `${width} bench`).toBeGreaterThanOrEqual(
        minimum.bench
      );
      const [handCard] = layoutTableHand(hand, 'local', 1);
      expect(handCard!.height, `${width} hand`).toBeGreaterThanOrEqual(
        minimum.hand
      );
      // Five bench Pokémon with two Energy each fit side by side.
      const benchCardWidth = bench.height * CARD_ASPECT_RATIO;
      expect(5 * benchCardWidth * (1 + 2 / 6) + 4 * 8).toBeLessThanOrEqual(
        bench.width
      );
    }
  });

  it('runs the hand off the screen edge and overlaps it when crowded', () => {
    const content = { x: 100, y: 600, width: 700, height: 130 };
    const three = layoutTableHand(content, 'local', 3);
    expect(three[0]!.height).toBeCloseTo(130 / 0.8, 5);
    expect(three[0]!.y).toBe(600);
    expect(three[1]!.x - three[0]!.x).toBeGreaterThan(three[0]!.width);
    const crowded = layoutTableHand(content, 'local', 20);
    expect(crowded[0]!.x).toBeCloseTo(100, 5);
    expect(crowded.at(-1)!.x + crowded.at(-1)!.width).toBeCloseTo(800, 5);
    expect(crowded[1]!.x - crowded[0]!.x).toBeLessThan(crowded[0]!.width);
    // The opponent's hand runs off the top, in mirrored order.
    const theirs = layoutTableHand({ ...content, y: 0 }, 'opponent', 3);
    expect(theirs[0]!.y + theirs[0]!.height).toBeCloseTo(130, 5);
    expect(theirs[0]!.x).toBeGreaterThan(theirs[2]!.x);
  });

  it("lays prizes in a two-by-three grid starting at their owner's top left", () => {
    const content = { x: 0, y: 0, width: 160, height: 330 };
    const mine = layoutTablePrizes(content, 'local', 6);
    expect(new Set(mine.map((rect) => Math.round(rect.x))).size).toBe(2);
    expect(new Set(mine.map((rect) => Math.round(rect.y))).size).toBe(3);
    expect(mine[0]!.x).toBeLessThan(mine[1]!.x);
    expect(mine[0]!.y).toBeLessThan(mine[2]!.y);
    const theirs = layoutTablePrizes(content, 'opponent', 6);
    expect(theirs[0]!.x).toBeGreaterThan(theirs[1]!.x);
    expect(theirs[0]!.y).toBeGreaterThan(theirs[2]!.y);
    for (const rect of [...mine, ...theirs])
      expect(inside(rect, content)).toBe(true);
  });

  it('builds a full scene whose cards stay on the table except the hidden part of the hand', () => {
    const view: MatchViewState = createRendererSpikeView();
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    const scene = createBoardScene(view, snapshot);
    expect(scene.layout.geometryVersion).toBe(2);
    expect(scene.viewport.width).toBe(1109);
    const table = {
      x: 0,
      y: 0,
      width: scene.viewport.width,
      height: scene.viewport.height,
    };
    for (const card of scene.cards) {
      if (card.parentId.endsWith(':hand')) {
        // Hand cards are cut by the screen edge but never by its sides.
        expect(card.bounds.x).toBeGreaterThanOrEqual(-0.01);
        expect(card.bounds.x + card.bounds.width).toBeLessThanOrEqual(
          table.width + 0.01
        );
        continue;
      }
      expect(inside(card.bounds, table), card.parentId).toBe(true);
    }
    // No zone scrolls in the table layout.
    expect(scene.zones.every((zone) => zone.scroll === undefined)).toBe(true);
  });

  it('moves the seam when either handle is dragged, keeping both halves usable', () => {
    const state = stateAt(1440, 900);
    const dragged = resizeLayoutStateFor(state, 'lower', 360);
    expect(dragged.vertical.upperFrame.heightRatio).toBeCloseTo(0.4, 5);
    expect(dragged.vertical.lowerFrame.heightRatio).toBeCloseTo(0.6, 5);
    expect(
      resizeLayoutStateFor(state, 'upper', 0).vertical.upperFrame.heightRatio
    ).toBeCloseTo(0.34, 5);
    expect(
      resizeLayoutStateFor(state, 'lower', 900).vertical.lowerFrame.heightRatio
    ).toBeCloseTo(0.34, 5);
    expect(() => createLayoutSnapshotFor(dragged)).not.toThrow();
  });
});
