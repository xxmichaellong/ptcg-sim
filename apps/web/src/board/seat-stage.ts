import type { MatchViewState } from '@ptcgsim/game-core';

/**
 * Where a seat is before and during a game, which decides what the table
 * asks of it (ADR-030): no cards yet (load a deck), a deck that has not been
 * set up (set up), or a game under way.
 */
export type SeatStage = 'empty' | 'loaded' | 'playing';

export const seatStage = (
  view: MatchViewState | undefined,
  playerId: string | undefined
): SeatStage => {
  if (!view || !playerId) return 'empty';
  const board = view.boards[playerId];
  if (board && (board.activeStackId !== null || board.benchStackIds.length > 0))
    return 'playing';
  let total = 0;
  let inDeck = 0;
  for (const zone of Object.values(view.zones)) {
    if (zone.ownerId !== playerId) continue;
    total += zone.cards.length;
    if (zone.kind === 'deck') inDeck += zone.cards.length;
  }
  if (total === 0) return 'empty';
  return inDeck === total ? 'loaded' : 'playing';
};
