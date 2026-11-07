import type { MatchState } from '@ptcgsim/game-core';
import type { AuthoritySession } from './model.js';

/** Authenticated names follow the canonical player, including across Undo. */
export const sessionWithPlayerName = (
  session: AuthoritySession,
  state: MatchState,
  previous: MatchState
): AuthoritySession => {
  if (
    session.viewer.kind !== 'player' ||
    session.displayName === undefined ||
    previous.players[session.viewer.playerId]?.displayName ===
      state.players[session.viewer.playerId]?.displayName
  )
    return session;
  const name = state.players[session.viewer.playerId]?.displayName;
  return name === undefined || name === session.displayName
    ? session
    : { ...session, displayName: name };
};
