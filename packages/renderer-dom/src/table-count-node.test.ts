import { asPlayerId } from '@ptcgsim/game-core';
import type {
  BoardSceneLayout,
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
});
