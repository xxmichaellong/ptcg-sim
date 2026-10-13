import { describe, expect, it } from 'vitest';

import { BoardDepthProjection, DEFAULT_BOARD_DEPTH } from './board-depth.js';
import { DEFAULT_BOARD_PREFERENCES } from './defaults.js';
import { looseBoardTargetAt, resolveBoardDropTarget } from './drag.js';
import { containsPoint } from './geometry.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
} from './layout-table.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardLayoutState,
} from './layout.js';
import type { BoardScene } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const view = createRendererSpikeView();
const [bottom, top] = [view.playerOrder[0]!, view.playerOrder[1]!];

const tableScene = (overrides: Partial<BoardLayoutState> = {}): BoardScene =>
  createBoardScene(
    view,
    createTableLayoutSnapshot({
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
      playerIds: [bottom, top],
      bottomPlayerId: bottom,
      shellMode: 'fullscreen',
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
      ...overrides,
    })
  );

/** A point of bare felt in a player's half: no zone or card there. */
const emptyFelt = (scene: BoardScene, playerId: string) => {
  const half = scene.layout.players.find((p) => p.playerId === playerId)!;
  for (
    let y = half.bounds.y + 4;
    y < half.bounds.y + half.bounds.height;
    y += 6
  )
    for (
      let x = half.bounds.x + 4;
      x < half.bounds.x + half.bounds.width;
      x += 6
    ) {
      const taken =
        scene.zones.some((zone) => containsPoint(zone.bounds, x, y)) ||
        scene.cards.some((card) => containsPoint(card.bounds, x, y));
      if (!taken) return { x, y };
    }
  throw new Error('No bare felt in this half');
};

const boardOf = (scene: BoardScene, playerId: string) =>
  scene.zones.find(
    (zone) => zone.kind === 'board' && zone.playerId === playerId
  )!.id;

describe('the loose board on the redesigned table', () => {
  it('takes a card dropped on bare felt in either half', () => {
    const scene = tableScene();
    const source = scene.cards.find((card) => card.interactive)!.id;
    for (const playerId of [bottom, top]) {
      const point = emptyFelt(scene, playerId);
      expect(looseBoardTargetAt(scene, point.x, point.y)).toBe(
        boardOf(scene, playerId)
      );
      expect(resolveBoardDropTarget(scene, source, point.x, point.y)).toBe(
        boardOf(scene, playerId)
      );
    }
  });

  it('leaves zones and cards their own drops', () => {
    const scene = tableScene();
    const source = scene.cards.find((card) => card.interactive)!.id;
    const bench = scene.zones.find(
      (zone) => zone.kind === 'bench' && zone.playerId === bottom
    )!;
    const point = {
      x: bench.bounds.x + bench.bounds.width - 4,
      y: bench.bounds.y + bench.bounds.height - 4,
    };
    expect(resolveBoardDropTarget(scene, source, point.x, point.y)).toBe(
      bench.id
    );
  });

  it('is nowhere outside the halves, or in a half the viewer hid', () => {
    const scene = tableScene({ hiddenPhysicalSide: 'upper' });
    expect(looseBoardTargetAt(scene, -10, -10)).toBeNull();
    const upper = scene.layout.players.find(
      (player) => player.physicalSide === 'upper'
    )!;
    expect(upper.hidden).toBe(true);
    expect(
      looseBoardTargetAt(scene, upper.bounds.x + 4, upper.bounds.y + 4)
    ).toBeNull();
  });

  it("keeps v1's own geometry as v1 had it", () => {
    const scene = createBoardScene(
      view,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
        playerIds: [bottom, top],
        bottomPlayerId: bottom,
        shellMode: 'fullscreen',
        vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
      })
    );
    expect(scene.layout.geometryVersion).not.toBe(
      TABLE_LAYOUT_GEOMETRY_VERSION
    );
    const half = scene.layout.players[0];
    expect(
      looseBoardTargetAt(scene, half.bounds.x + 2, half.bounds.y + 2)
    ).toBeNull();
  });

  it('works the same through the tabletop camera', () => {
    const scene = tableScene();
    const depth = new BoardDepthProjection(scene, {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
    });
    const source = scene.cards.find((card) => card.interactive)!.id;
    const felt = emptyFelt(scene, bottom);
    const screen = depth.point(felt);
    expect(depth.drop(screen, source).targetId).toBe(boardOf(scene, bottom));
  });
});
