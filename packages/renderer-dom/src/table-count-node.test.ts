import { asPlayerId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardSceneLayout,
  CardSceneNode,
  ZoneCountSceneNode,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { tableCountNode } from './table-count-node.js';

const layout = {
  playAreaBounds: { x: 0, y: 0, width: 844, height: 390 },
} as BoardSceneLayout;

const count = (
  overrides: Partial<ZoneCountSceneNode> = {}
): ZoneCountSceneNode => ({
  id: 'count:zone:p2:deck',
  zoneId: 'zone:p2:deck',
  playerId: asPlayerId('p2'),
  side: 'opponent',
  kind: 'deck',
  count: 0,
  anchor: { x: 8, y: 117 },
  horizontalAlign: 'left',
  verticalAlign: 'top',
  fontSizePx: 13,
  color: '#000',
  zIndex: 15,
  label: '0 cards',
  hint: '0 cards in their deck',
  ...overrides,
});

describe('a count on the table', () => {
  it("keeps a pile's badge on the screen: a pile at its edge has it moved in", () => {
    // The far deck at the left edge of a phone held sideways: its badge,
    // 9px out past the pile's corner, would start a pixel off the screen.
    const node = tableCountNode(count(), undefined, true, layout);
    expect(node.anchor.x - 9).toBeGreaterThanOrEqual(2);
    expect(node.anchor.y).toBe(117);
    // One with room keeps its place.
    const inside = count({ anchor: { x: 300, y: 117 } });
    expect(tableCountNode(inside, undefined, true, layout)).toBe(inside);
  });

  it("leaves the hand's count, and v1's geometry, as they were", () => {
    const hand = count({ kind: 'hand', anchor: { x: -20, y: 117 } });
    expect(tableCountNode(hand, undefined, true, layout)).toBe(hand);
    const legacy = count();
    expect(tableCountNode(legacy, undefined, false, layout)).toBe(legacy);
  });

  it("puts a pile's badge on its top card's corner, as high as the pile stands", () => {
    // The near deck: its place's corner at (400, 300), its card a little
    // inside it.
    const near = count({
      side: 'local',
      anchor: { x: 400, y: 300 },
      horizontalAlign: 'right',
      verticalAlign: 'bottom',
    });
    const top = {
      bounds: { x: 340, y: 210, width: 56, height: 78 },
    } as CardSceneNode;
    // Flat, on the card's corner and not its place's.
    expect(tableCountNode(near, undefined, true, layout, top).anchor).toEqual({
      x: 396,
      y: 288,
    });
    // Tilted, where the top of the pile is painted: a full deck stands
    // well above the table, and its badge with it.
    const depth = {
      pose: () => ({
        bounds: top.bounds,
        turns: 0,
        elevation: 12,
        thickness: 12,
        plane: 1,
      }),
      point: (
        point: { x: number; y: number },
        elevation = 0
      ): { x: number; y: number } => ({ x: point.x, y: point.y - elevation }),
    } as unknown as BoardDepthProjection;
    expect(tableCountNode(near, depth, true, layout, top).anchor).toEqual({
      x: 396,
      y: 276,
    });
    // An empty pile's badge keeps its place's corner, on the table.
    expect(tableCountNode(near, depth, true, layout).anchor).toEqual({
      x: 400,
      y: 300,
    });
  });
});
