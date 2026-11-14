import type { BoardScene, Rect } from '@ptcgsim/renderer-contract';

/**
 * Room around the spots, for the count badges that hang off their corners
 * and so no card sits on the mat's very edge.
 */
export const MAT_MARGIN_PX = 16;

/**
 * Where the tilted table's mat lies: as far as anything is laid on it.
 * The hands are held over the desk, not laid on the mat, so the mat ends
 * past the bench on either side instead of running on under them.
 */
export const tableMatBounds = (scene: BoardScene): Rect => {
  const { width, height } = scene.viewport;
  const spots = scene.zones
    .filter(
      (zone) =>
        zone.kind !== 'hand' && zone.bounds.width > 0 && zone.bounds.height > 0
    )
    .map((zone) => zone.bounds);
  if (spots.length === 0) return { x: 0, y: 0, width, height };
  const left = Math.max(
    0,
    Math.min(...spots.map((spot) => spot.x)) - MAT_MARGIN_PX
  );
  const top = Math.max(
    0,
    Math.min(...spots.map((spot) => spot.y)) - MAT_MARGIN_PX
  );
  const right = Math.min(
    width,
    Math.max(...spots.map((spot) => spot.x + spot.width)) + MAT_MARGIN_PX
  );
  const bottom = Math.min(
    height,
    Math.max(...spots.map((spot) => spot.y + spot.height)) + MAT_MARGIN_PX
  );
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width, height };
};
