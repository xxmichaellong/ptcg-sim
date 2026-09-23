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

/** A target seat field only when it differs from the submitting seat. */
export const targetSeatField = (
  view: MatchViewState,
  playerId: PlayerId
): { readonly targetPlayerId?: string } =>
  view.viewer.kind === 'player' && view.viewer.playerId !== playerId
    ? { targetPlayerId: playerId }
    : {};
