import type { PlayerId } from '@ptcgsim/game-core';
import {
  TABLE_COIN_MIN_PX,
  type BoardLayoutSnapshot,
  type Rect,
} from '@ptcgsim/renderer-contract';

/** Where a player's coin rests on the table. */
export interface TableCoinSpot {
  readonly playerId: PlayerId;
  /** The half at the bottom of the screen: the viewer's own, or their seat. */
  readonly own: boolean;
  /** The coin's square on the flat table, in board pixels. */
  readonly rect: Rect;
}

/**
 * Each player's coin, where the layout keeps it: under their VSTAR/GX
 * markers, beside their prizes on their own left as they sit at the table
 * (the far half is turned around), clear of every zone, the Stadium and the
 * other pieces. A half the viewer has hidden has no coin. The halves shown
 * have theirs or neither does: where one is too small for a coin, the
 * table keeps none and the rail offers Coin instead.
 */
export const tableCoinSpots = (
  layout: BoardLayoutSnapshot
): readonly TableCoinSpot[] => {
  const shown = layout.players.filter((frame) => !frame.hidden);
  return shown.every(
    (frame) => (frame.extras?.coin.width ?? 0) >= TABLE_COIN_MIN_PX
  )
    ? shown.map((frame) => ({
        playerId: frame.playerId,
        own: frame.playerId === layout.bottomPlayerId,
        rect: { ...frame.extras!.coin },
      }))
    : [];
};
