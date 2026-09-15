import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';

export interface SessionPresentationIdentity {
  readonly playerId?: string;
  readonly displayName: string;
}

/**
 * Resolves only server-authenticated identity. Persisted spectator names make
 * this stable across Durable Object eviction; older snapshots fail safely to
 * the same generic label used by the legacy UI.
 */
export const sessionPresentationIdentity = (
  snapshot: RoomAuthoritySnapshot,
  sessionId: string
): SessionPresentationIdentity | undefined => {
  const session = snapshot.sessions[sessionId];
  if (!session) return undefined;
  if (session.viewer.kind === 'player') {
    const displayName =
      snapshot.state.players[session.viewer.playerId]?.displayName.trim();
    return displayName
      ? { playerId: session.viewer.playerId, displayName }
      : undefined;
  }
  const displayName = session.displayName?.trim() || 'Spectator';
  return { displayName };
};
