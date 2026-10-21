import type { PlayerId } from '@ptcgsim/game-core';
import type { BoardLayoutSnapshot, Rect } from '@ptcgsim/renderer-contract';

/** Where a player's coin rests on the table. */
export interface TableCoinSpot {
  readonly playerId: PlayerId;
  /** The half at the bottom of the screen: the viewer's own, or their seat. */
  readonly own: boolean;
  /** The coin's square on the flat table, in board pixels. */
  readonly rect: Rect;
}

/** A coin is about a third of an Active card tall, within these bounds. */
const COIN_SHARE_OF_ACTIVE = 0.34;
export const TABLE_COIN_MIN_PX = 34;
export const TABLE_COIN_MAX_PX = 64;
/**
 * Where in the Active's row the coin lies, given the room: a quarter of the
 * way down it from the middle of the table, and three quarters of the way
 * along the clear felt toward the player's own right.
 */
const COIN_ROW_HEIGHT = 0.25;
const COIN_ROW_ALONG = 0.75;
/** The least felt kept between the coin and anything else on the table. */
const COIN_CLEARANCE_PX = 10;

interface Span {
  readonly from: number;
  readonly to: number;
}

/** The parts of `span` that none of `taken` covers. */
const freeSpans = (span: Span, taken: readonly Span[]): Span[] => {
  let free: Span[] = [span];
  for (const cut of taken) {
    free = free.flatMap((part) => {
      if (cut.to <= part.from || cut.from >= part.to) return [part];
      const pieces: Span[] = [];
      if (cut.from > part.from) pieces.push({ from: part.from, to: cut.from });
      if (cut.to < part.to) pieces.push({ from: cut.to, to: part.to });
      return pieces;
    });
  }
  return free;
};

/**
 * Each player's coin, on the felt beside their Active Pokémon on their own
 * right as they sit at the table (the far half is turned around): toward
 * the middle of the table and out toward their right (COIN_ROW_HEIGHT,
 * COIN_ROW_ALONG) where the row is clear, or just clear of whatever reaches
 * into it (on a phone the Stadium does), so it never lies on a zone, a
 * pile, the Stadium or the optional pieces. A half the viewer has hidden
 * has no coin, and neither has a half too cramped for one.
 */
export const tableCoinSpots = (
  layout: BoardLayoutSnapshot
): readonly TableCoinSpot[] => {
  const shown = layout.players.filter((frame) => !frame.hidden);
  const obstacles: Rect[] = [
    ...shown.flatMap((frame) => [
      ...frame.regions.map((region) => region.physicalDeclaredBounds),
      ...(frame.extras?.markers ? [frame.extras.markers] : []),
      ...(frame.extras ? [frame.extras.control] : []),
    ]),
    layout.shared.stadium.physicalDeclaredBounds,
  ].filter((rect) => rect.width > 0 && rect.height > 0);
  const play = layout.playAreaBounds;
  return shown.flatMap((frame) => {
    const active = frame.regions.find(
      (region) => region.kind === 'active'
    )?.physicalDeclaredBounds;
    if (!active || active.width <= 0 || active.height <= 0) return [];
    const ownRight = frame.rotationQuarterTurns !== 2;
    const row: Span = ownRight
      ? {
          from: active.x + active.width + COIN_CLEARANCE_PX,
          to: play.x + play.width - COIN_CLEARANCE_PX,
        }
      : {
          from: play.x + COIN_CLEARANCE_PX,
          to: active.x - COIN_CLEARANCE_PX,
        };
    const wanted = Math.min(
      TABLE_COIN_MAX_PX,
      active.height * COIN_SHARE_OF_ACTIVE
    );
    const top = active.y + wanted / 2;
    const bottom = active.y + active.height - wanted / 2;
    // The near half's middle of the table is above its Active; the far
    // half's, below.
    const nearHalf = active.y + active.height / 2 > play.y + play.height / 2;
    const aim = Math.min(
      bottom,
      Math.max(
        top,
        active.y +
          active.height * (nearHalf ? COIN_ROW_HEIGHT : 1 - COIN_ROW_HEIGHT)
      )
    );
    const others = obstacles.filter((rect) => rect !== active);
    // Where it aims, or just above or below anything in the row.
    const heights = [
      aim,
      ...others.flatMap((rect) => [
        rect.y + rect.height + COIN_CLEARANCE_PX + wanted / 2,
        rect.y - COIN_CLEARANCE_PX - wanted / 2,
      ]),
    ].filter((y) => y >= top - 0.01 && y <= bottom + 0.01);
    let best:
      | {
          readonly x: number;
          readonly y: number;
          readonly size: number;
          readonly width: number;
        }
      | undefined;
    for (const y of heights) {
      const taken = others
        .filter(
          (rect) =>
            rect.y < y + wanted / 2 + COIN_CLEARANCE_PX &&
            rect.y + rect.height > y - wanted / 2 - COIN_CLEARANCE_PX
        )
        .map((rect) => ({
          from: rect.x - COIN_CLEARANCE_PX,
          to: rect.x + rect.width + COIN_CLEARANCE_PX,
        }));
      for (const span of freeSpans(row, taken)) {
        const width = span.to - span.from;
        const size = Math.min(wanted, width);
        // The biggest coin; then the one nearest where it aims; then the
        // one with the most felt around it.
        const better =
          !best ||
          size > best.size + 0.01 ||
          (size > best.size - 0.01 &&
            (Math.abs(y - aim) < Math.abs(best.y - aim) - 0.01 ||
              (Math.abs(Math.abs(y - aim) - Math.abs(best.y - aim)) <= 0.01 &&
                width > best.width)));
        const along = ownRight ? COIN_ROW_ALONG : 1 - COIN_ROW_ALONG;
        if (better)
          best = {
            x: span.from + size / 2 + (width - size) * along,
            y,
            size,
            width,
          };
      }
    }
    if (!best || best.size < TABLE_COIN_MIN_PX) return [];
    return [
      {
        playerId: frame.playerId,
        own: frame.playerId === layout.bottomPlayerId,
        rect: {
          x: best.x - best.size / 2,
          y: best.y - best.size / 2,
          width: best.size,
          height: best.size,
        },
      },
    ];
  });
};
