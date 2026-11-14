import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

/**
 * The seat whose own-only controls the viewer operates: v1's
 * `systemState.initiator`, "the user on the bottom half of the screen". A
 * player acts for their own seat until they flip the board (Solo, or a room
 * where both players enabled board flip), after which the seat now at the
 * bottom takes the sidebar buttons, the unselected keybinds, and the
 * own-only context-menu entries. Spectators act for nobody.
 */
export const actingPlayerIdOf = (
  view: MatchViewState | undefined,
  bottomPlayerId: string | undefined
): PlayerId | undefined => {
  if (!view || view.viewer.kind !== 'player') return undefined;
  return bottomPlayerId !== undefined && view.players[bottomPlayerId]
    ? (bottomPlayerId as PlayerId)
    : view.viewer.playerId;
};

/**
 * The colour a seat is shown in wherever it sits on the table, as the log
 * shows it: the viewer's own seat (a spectator's, the first) in the "you"
 * colour and the other in the opponent's. Solo's seats are named Blue and
 * Red after these colours, so turning the board around must not swap them.
 * The scene stamps the same rule on each seat's frame (`frame.tone`).
 */
export { seatToneOf } from '@ptcgsim/renderer-contract';

/** A target seat field only when it differs from the submitting seat. */
export const targetSeatField = (
  view: MatchViewState,
  playerId: PlayerId
): { readonly targetPlayerId?: string } =>
  view.viewer.kind === 'player' && view.viewer.playerId !== playerId
    ? { targetPlayerId: playerId }
    : {};
