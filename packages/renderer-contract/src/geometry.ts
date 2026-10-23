import type { PlayerId, QuarterTurns } from '@ptcgsim/game-core';
import type {
  BoardLayoutOptions,
  BoardSide,
  BoardViewport,
  Rect,
} from './model.js';

export const LEGACY_PLAY_AREA_WIDTH_RATIO = 0.755;
export const LEGACY_SIDEBAR_WIDTH_RATIO = 0.24;
export const CARD_ASPECT_RATIO = 63 / 88;

export type PlayerZoneGeometryKind =
  | 'hand'
  | 'bench'
  | 'active'
  | 'prizes'
  | 'lostZone'
  | 'deck'
  | 'discard'
  | 'board';

/**
 * Versioned transcription of the v1 self/opp iframe percentages. Values are
 * local to one player half and deliberately preserve the opponent free-board
 * asymmetry before its 180-degree transform.
 */
const LEGACY_PLAYER_GEOMETRY: Readonly<
  Record<Exclude<PlayerZoneGeometryKind, 'board'>, Rect>
> = {
  hand: { x: 0, y: 0.7, width: 1, height: 0.3 },
  bench: { x: 0.1, y: 0.4, width: 0.79, height: 0.25 },
  active: { x: 0.34, y: 0.07, width: 0.32, height: 0.28 },
  prizes: { x: 0.01, y: 0.21, width: 0.06, height: 0.43 },
  lostZone: { x: 0.01, y: 0.01, width: 0.07, height: 0.15 },
  deck: { x: 0.91, y: 0.09, width: 0.08, height: 0.25 },
  discard: { x: 0.91, y: 0.41, width: 0.08, height: 0.23 },
};

export const assertViewport = (viewport: BoardViewport): void => {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    !Number.isFinite(viewport.devicePixelRatio) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    viewport.devicePixelRatio <= 0
  ) {
    throw new Error('Board viewport dimensions and DPR must be positive');
  }
};

export const assertLayoutOptions = (options: BoardLayoutOptions): void => {
  assertViewport(options.viewport);
  if (
    !Number.isFinite(options.splitRatio) ||
    options.splitRatio < 0.2 ||
    options.splitRatio > 0.8
  ) {
    throw new Error('Board split ratio must be between 0.2 and 0.8');
  }
};

export const sideForPlayer = (
  playerId: PlayerId,
  bottomPlayerId: PlayerId
): BoardSide => (playerId === bottomPlayerId ? 'local' : 'opponent');

const rotateHalfRect = (rect: Rect): Rect => ({
  x: 1 - rect.x - rect.width,
  y: 1 - rect.y - rect.height,
  width: rect.width,
  height: rect.height,
});

const normalizedZoneRect = (
  kind: PlayerZoneGeometryKind,
  side: BoardSide
): Rect => {
  const rect =
    kind === 'board'
      ? side === 'local'
        ? { x: 0.66, y: 0.09, width: 0.24, height: 0.3 }
        : { x: 0.12, y: 0.09, width: 0.22, height: 0.3 }
      : LEGACY_PLAYER_GEOMETRY[kind];
  return side === 'opponent' ? rotateHalfRect(rect) : rect;
};

export const layoutPlayerZone = (
  kind: PlayerZoneGeometryKind,
  side: BoardSide,
  options: BoardLayoutOptions
): Rect => {
  assertLayoutOptions(options);
  const rect = normalizedZoneRect(kind, side);
  const upperHeight = options.viewport.height * options.splitRatio;
  const halfHeight =
    side === 'opponent' ? upperHeight : options.viewport.height - upperHeight;
  const originY = side === 'opponent' ? 0 : upperHeight;
  return {
    x: rect.x * options.viewport.width,
    y: originY + rect.y * halfHeight,
    width: rect.width * options.viewport.width,
    height: rect.height * halfHeight,
  };
};

export const layoutStadium = (viewport: BoardViewport): Rect => {
  assertViewport(viewport);
  return {
    x: viewport.width * 0.11,
    y: viewport.height * 0.42,
    width: viewport.width * 0.06,
    height: viewport.height * 0.16,
  };
};

export const insetRect = (rect: Rect, inset: number): Rect => ({
  x: rect.x + inset,
  y: rect.y + inset,
  width: Math.max(0, rect.width - inset * 2),
  height: Math.max(0, rect.height - inset * 2),
});

export const containsPoint = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y &&
  y <= rect.y + rect.height;

/**
 * Tests the same center-origin quarter-turn rectangle painted by the DOM and
 * Pixi renderers. Scene bounds remain the untransformed layout box; the point
 * is inverse-rotated into that box so paint and shared input stay aligned.
 */
export const containsPointInRotatedRect = (
  rect: Rect,
  rotationQuarterTurns: QuarterTurns,
  x: number,
  y: number
): boolean => {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const deltaX = x - centerX;
  const deltaY = y - centerY;
  let layoutDeltaX: number;
  let layoutDeltaY: number;
  switch (rotationQuarterTurns) {
    case 0:
      layoutDeltaX = deltaX;
      layoutDeltaY = deltaY;
      break;
    case 1:
      layoutDeltaX = deltaY;
      layoutDeltaY = -deltaX;
      break;
    case 2:
      layoutDeltaX = -deltaX;
      layoutDeltaY = -deltaY;
      break;
    case 3:
      layoutDeltaX = -deltaY;
      layoutDeltaY = deltaX;
      break;
    default:
      return false;
  }
  return containsPoint(rect, centerX + layoutDeltaX, centerY + layoutDeltaY);
};
