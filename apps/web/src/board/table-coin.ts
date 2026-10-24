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
 * other pieces. A half the viewer has hidden has no coin, and neither has a
 * half too small for one (the rail offers Coin instead).
 */
export const tableCoinSpots = (
  layout: BoardLayoutSnapshot
): readonly TableCoinSpot[] =>
  layout.players.flatMap((frame) => {
    const coin = frame.extras?.coin;
    return !frame.hidden && coin && coin.width >= TABLE_COIN_MIN_PX
      ? [
          {
            playerId: frame.playerId,
            own: frame.playerId === layout.bottomPlayerId,
            rect: { ...coin },
          },
        ]
      : [];
  });
