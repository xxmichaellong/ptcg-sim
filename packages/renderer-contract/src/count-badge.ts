import type { Rect } from './model.js';

/**
 * A pile's count badge on the table (geometry v2) as the DOM renderer draws
 * it (`.ptcgsim-zone-count--badge`): anchored by one corner with a negative
 * margin, so it stands `outsetPx` out past the anchor, at least `minWidthPx`
 * wide (one digit) and `heightPx` tall.
 */
export const TABLE_COUNT_BADGE = {
  outsetPx: 9,
  minWidthPx: 26,
  heightPx: 22,
} as const;

/** The least room a pile's count badge keeps from the table's edge. */
const COUNT_BADGE_EDGE_PX = 2;

/** How a count badge hangs from its anchor. */
export interface CountBadgeAnchor {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly horizontalAlign: 'left' | 'right';
  readonly verticalAlign: 'top' | 'bottom';
}

/** The box a pile's count badge covers, at its least width. */
export const countBadgeBox = ({
  anchor,
  horizontalAlign,
  verticalAlign,
}: CountBadgeAnchor): Rect => {
  const { outsetPx, minWidthPx, heightPx } = TABLE_COUNT_BADGE;
  return {
    x:
      horizontalAlign === 'left'
        ? anchor.x - outsetPx
        : anchor.x + outsetPx - minWidthPx,
    y:
      verticalAlign === 'top'
        ? anchor.y - outsetPx
        : anchor.y + outsetPx - heightPx,
    width: minWidthPx,
    height: heightPx,
  };
};

/**
 * The anchor that keeps a pile's count badge on the table (`bounds`, the
 * play area): a pile at the screen's edge has its badge stand out past its
 * corner and off the screen, so the badge moves in over the pile instead.
 */
export const countBadgeAnchorWithin = (
  badge: CountBadgeAnchor,
  bounds: Rect
): { readonly x: number; readonly y: number } => {
  const box = countBadgeBox(badge);
  const clamp = (at: number, size: number, start: number, extent: number) =>
    Math.max(
      start + COUNT_BADGE_EDGE_PX,
      Math.min(start + extent - COUNT_BADGE_EDGE_PX - size, at)
    );
  const x = clamp(box.x, box.width, bounds.x, bounds.width);
  const y = clamp(box.y, box.height, bounds.y, bounds.height);
  return { x: badge.anchor.x + (x - box.x), y: badge.anchor.y + (y - box.y) };
};
