import type { BoardScene } from '@ptcgsim/renderer-contract';

/** What the tilted table's projection offers here (BoardDepthProjection). */
interface TablePointProjection {
  readonly point: (point: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  };
}

/**
 * Where the turn banner's middle lies, in the board's own pixels: on the
 * centre line between the halves as it is drawn -- projected, on the tilted
 * table -- so it runs across the middle of the board, not of the window
 * (the halves are seldom the same height). With one half shown, that half's
 * middle. Undefined with neither.
 */
export const turnBannerCentreY = (
  scene: BoardScene,
  depth?: TablePointProjection
): number | undefined => {
  const shown = scene.layout.players.filter((frame) => !frame.hidden);
  const drawnY = (x: number, y: number): number =>
    depth ? depth.point({ x, y }).y : y;
  const lower = shown.find((frame) => frame.physicalSide === 'lower');
  const upper = shown.find((frame) => frame.physicalSide === 'upper');
  if (lower && upper) {
    return drawnY(lower.bounds.x + lower.bounds.width / 2, lower.bounds.y);
  }
  const only = shown[0];
  if (!only) return undefined;
  const { x, y, width, height } = only.bounds;
  const middle = x + width / 2;
  return (drawnY(middle, y) + drawnY(middle, y + height)) / 2;
};
