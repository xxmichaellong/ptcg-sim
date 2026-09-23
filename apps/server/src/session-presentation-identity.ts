import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';

export interface SessionPresentationIdentity {
  readonly playerId?: string;
  readonly displayName: string;
}

/**
 * The seat a player session may speak for. v1's flipped board acts as the seat
 * at the bottom, which is the connected seat in an ordinary room, either seat
 * in Solo, and either seat in a room where both players enabled board flip.
 * Anything else falls back to the session's own seat, so a requested seat can
 * never become an identity of its own.
 */
export const actingPlayerIdForSession = (
  snapshot: RoomAuthoritySnapshot,
  sessionId: string,
  requestedPlayerId: string | undefined
): string | undefined => {
  const session = snapshot.sessions[sessionId];
  if (!session || session.viewer.kind !== 'player') return undefined;
  const ownPlayerId = session.viewer.playerId;
  if (requestedPlayerId === undefined || requestedPlayerId === ownPlayerId) {
    return ownPlayerId;
  }
  if (!snapshot.state.players[requestedPlayerId]) return ownPlayerId;
  const flipAllowed =
    snapshot.mode === 'solo' ||
    Object.values(snapshot.state.players).every(
      (player) => player.coachingConsent === true
    );
  return flipAllowed ? requestedPlayerId : ownPlayerId;
};

/**
 * Resolves only server-authenticated identity. Persisted spectator names make
 * this stable across Durable Object eviction; older snapshots fail safely to
 * the same generic label used by the legacy UI. A player session may present
 * the seat it is acting for, which is what v1's flipped board does.
 */
export const sessionPresentationIdentity = (
  snapshot: RoomAuthoritySnapshot,
  sessionId: string,
  requestedPlayerId?: string
): SessionPresentationIdentity | undefined => {
  const session = snapshot.sessions[sessionId];
  if (!session) return undefined;
  if (session.viewer.kind === 'player') {
    const playerId =
      actingPlayerIdForSession(snapshot, sessionId, requestedPlayerId) ??
      session.viewer.playerId;
    const displayName = snapshot.state.players[playerId]?.displayName.trim();
    return displayName ? { playerId, displayName } : undefined;
  }
  const displayName = session.displayName?.trim() || 'Spectator';
  return { displayName };
};
