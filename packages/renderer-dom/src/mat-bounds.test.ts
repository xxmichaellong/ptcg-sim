import type { BoardScene } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { MAT_MARGIN_PX, tableMatBounds } from './mat-bounds.js';

type Zone = BoardScene['zones'][number];

const zone = (kind: Zone['kind'], bounds: Zone['bounds']): Zone =>
  ({ id: `zone:${kind}:${String(bounds.y)}`, kind, bounds }) as Zone;

const scene = (zones: readonly Zone[]): BoardScene =>
  ({ viewport: { width: 1000, height: 800 }, zones }) as unknown as BoardScene;

describe('tableMatBounds', () => {
  it('ends past the benches, not under the hands', () => {
    const bounds = tableMatBounds(
      scene([
        zone('hand', { x: 100, y: 0, width: 800, height: 80 }),
        zone('bench', { x: 60, y: 100, width: 880, height: 120 }),
        zone('active', { x: 400, y: 240, width: 200, height: 140 }),
        zone('prizes', { x: 20, y: 400, width: 120, height: 260 }),
        zone('bench', { x: 60, y: 560, width: 880, height: 120 }),
        zone('hand', { x: 100, y: 700, width: 800, height: 100 }),
      ])
    );
    expect(bounds).toEqual({
      x: 20 - MAT_MARGIN_PX,
      y: 100 - MAT_MARGIN_PX,
      width: 940 - 20 + 2 * MAT_MARGIN_PX,
      height: 680 - 100 + 2 * MAT_MARGIN_PX,
    });
  });

  it('stays inside the table and covers it all when nothing lies on it', () => {
    expect(
      tableMatBounds(
        scene([zone('bench', { x: 4, y: 2, width: 994, height: 797 })])
      )
    ).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(
      tableMatBounds(
        scene([zone('hand', { x: 0, y: 700, width: 1000, height: 100 })])
      )
    ).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });
});
