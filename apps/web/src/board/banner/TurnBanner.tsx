import type { MatchViewState } from '@ptcgsim/game-core';
import { useEffect, useRef, useState } from 'react';

import './TurnBanner.css';

interface Announcement {
  readonly key: number;
  readonly title: string;
  readonly turnNumber: number;
  readonly side: 'local' | 'opponent';
}

export interface TurnBannerProps {
  readonly view: MatchViewState | undefined;
  /** The seat painted at the bottom: "your" side of the table. */
  readonly bottomPlayerId: string | undefined;
}

/** How long the banner stays before it slides away. */
const VISIBLE_MS = 1_350;

/**
 * A brief banner across the table when a new turn starts. It never takes
 * input and never waits for anything; it only marks the moment. The first
 * view and any jump backwards (undo, a replay seek) announce nothing.
 */
export const TurnBanner = ({ view, bottomPlayerId }: TurnBannerProps) => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const lastRef = useRef<{ matchId: string; turnNumber: number } | null>(null);
  const turnNumber = view?.turn.number;
  const currentPlayerId = view?.turn.currentPlayerId;
  const matchId = view?.matchId;

  useEffect(() => {
    if (matchId === undefined || turnNumber === undefined) return undefined;
    const last = lastRef.current;
    lastRef.current = { matchId, turnNumber };
    if (!last || last.matchId !== matchId || turnNumber <= last.turnNumber) {
      return undefined;
    }
    const player = currentPlayerId ? view?.players[currentPlayerId] : undefined;
    const ownTurn =
      view?.viewer.kind === 'player' &&
      view.viewer.playerId === currentPlayerId;
    setAnnouncement({
      key: Date.now(),
      title: ownTurn ? 'Your turn' : `${player?.displayName ?? 'Next'}'s turn`,
      turnNumber,
      side: currentPlayerId === bottomPlayerId ? 'local' : 'opponent',
    });
    const timer = setTimeout(() => setAnnouncement(null), VISIBLE_MS);
    return () => clearTimeout(timer);
    // The view object changes with every publication; only the turn matters,
    // so the rest of it is read when the turn changes rather than tracked.
  }, [matchId, turnNumber]);

  if (!announcement) return null;
  return (
    <div
      key={announcement.key}
      className="turn-banner"
      data-turn-banner=""
      data-side={announcement.side}
      aria-hidden="true"
    >
      <span className="turn-banner__title">{announcement.title}</span>
      <span className="turn-banner__turn">Turn {announcement.turnNumber}</span>
    </div>
  );
};
