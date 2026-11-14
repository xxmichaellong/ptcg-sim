import { describe, expect, it } from 'vitest';

import {
  countBadgeAnchorWithin,
  countBadgeBox,
  TABLE_COUNT_BADGE,
} from './count-badge.js';

const table = { x: 0, y: 0, width: 844, height: 390 };

describe('pile count badges on the table', () => {
  it('stands out past the corner it hangs from', () => {
    expect(
      countBadgeBox({
        anchor: { x: 100, y: 200 },
        horizontalAlign: 'right',
        verticalAlign: 'bottom',
      })
    ).toEqual({
      x: 100 + TABLE_COUNT_BADGE.outsetPx - TABLE_COUNT_BADGE.minWidthPx,
      y: 200 + TABLE_COUNT_BADGE.outsetPx - TABLE_COUNT_BADGE.heightPx,
      width: TABLE_COUNT_BADGE.minWidthPx,
      height: TABLE_COUNT_BADGE.heightPx,
    });
  });

  it('leaves a badge with room where it is', () => {
    const badge = {
      anchor: { x: 400, y: 200 },
      horizontalAlign: 'left',
      verticalAlign: 'top',
    } as const;
    expect(countBadgeAnchorWithin(badge, table)).toEqual(badge.anchor);
  });

  it("moves a pile's badge in from the screen's edge rather than cut it off", () => {
    // The far deck at the left edge of a phone held sideways: its badge
    // hangs from its top-left corner, 9px past the screen's edge.
    const far = countBadgeAnchorWithin(
      {
        anchor: { x: 8, y: 117 },
        horizontalAlign: 'left',
        verticalAlign: 'top',
      },
      table
    );
    expect(far.y).toBe(117);
    const farBox = countBadgeBox({
      anchor: far,
      horizontalAlign: 'left',
      verticalAlign: 'top',
    });
    expect(farBox.x).toBeGreaterThanOrEqual(2);
    // The near column at the right edge, its badge at the bottom right.
    const near = countBadgeAnchorWithin(
      {
        anchor: { x: 840, y: 388 },
        horizontalAlign: 'right',
        verticalAlign: 'bottom',
      },
      table
    );
    const nearBox = countBadgeBox({
      anchor: near,
      horizontalAlign: 'right',
      verticalAlign: 'bottom',
    });
    expect(nearBox.x + nearBox.width).toBeLessThanOrEqual(table.width - 2);
    expect(nearBox.y + nearBox.height).toBeLessThanOrEqual(table.height - 2);
  });
});
