import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

/**
 * A seat's colour: `local` is the "you" colour (blue), `opponent` the other
 * (red). It follows the player wherever they sit -- turning the board
 * around, in Solo or a coaching room, moves the seats, not their colours,
 * as v1's flip swapped `self-color` and `opp-color`.
 */
export type SeatTone = 'local' | 'opponent';

/**
 * The seat the viewer calls their own: their seat, or a spectator's (and a
 * replay's watcher's) first.
 */
export const ownSeatOf = (
  view: Pick<MatchViewState, 'viewer' | 'playerOrder'>
): PlayerId | undefined =>
  view.viewer.kind === 'player' ? view.viewer.playerId : view.playerOrder[0];

/** The colour `playerId`'s seat is shown in, to this view's viewer. */
export const seatToneOf = (
  view: Pick<MatchViewState, 'viewer' | 'playerOrder'> | undefined,
  playerId: string | null | undefined
): SeatTone | undefined => {
  if (!view || !playerId) return undefined;
  return playerId === ownSeatOf(view) ? 'local' : 'opponent';
};
