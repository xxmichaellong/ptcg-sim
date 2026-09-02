import type { MatchViewState } from '@ptcgsim/game-core';
import { useLayoutEffect, useRef } from 'react';

import type { ActivityFeedItem } from './ActivityFeedModel.js';
import type { LegacyGamePresentationRuntime } from './LegacyGamePresentationRuntime.js';
import { usePresentationState } from './usePresentationRuntime.js';

export type LegacyActivityClassName = 'self-text' | 'opp-text' | 'announcement';

export type LegacyActivityPerspective = Pick<
  MatchViewState,
  'viewer' | 'playerOrder'
>;

/** Preserves the legacy blue/self, red/opponent, and neutral row treatment. */
export const legacyActivityClassName = (
  item: ActivityFeedItem,
  perspective: LegacyActivityPerspective | undefined
): LegacyActivityClassName => {
  if (item.category === 'announcement' || !item.playerId || !perspective) {
    return 'announcement';
  }
  const primaryPlayerId =
    perspective.viewer.kind === 'player'
      ? perspective.viewer.playerId
      : perspective.playerOrder[0];
  return item.playerId === primaryPlayerId ? 'self-text' : 'opp-text';
};

export interface LegacyPresentationSurfaceProps {
  readonly runtime: Pick<
    LegacyGamePresentationRuntime,
    'activityFeed' | 'liveRegion'
  >;
  /** The coordinator's effective live-or-replay view perspective. */
  readonly perspective?: LegacyActivityPerspective;
}

/** Concrete React mount for the existing activity panel and polite live region. */
export const LegacyPresentationSurface = ({
  runtime,
  perspective,
}: LegacyPresentationSurfaceProps) => {
  const feed = usePresentationState(runtime.activityFeed);
  const liveRegion = usePresentationState(runtime.liveRegion);
  const feedElement = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = feedElement.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [feed.newestItemId]);

  return (
    <div className="legacy-presentation-surface">
      <div
        id="chatbox"
        ref={feedElement}
        className="legacy-activity-feed"
        role="log"
        aria-label="Game activity"
        aria-live="off"
      >
        {feed.items.map((item) => (
          <p
            key={item.id}
            className={legacyActivityClassName(item, perspective)}
            data-event-type={item.eventType}
            data-revision={item.revision}
          >
            {item.message}
          </p>
        ))}
      </div>
      <div
        className="presentation-live-region"
        role="status"
        aria-live={liveRegion.announcement?.politeness ?? 'polite'}
        aria-atomic="true"
      >
        {liveRegion.announcement && (
          <span key={liveRegion.announcement.id}>
            {liveRegion.announcement.message}
          </span>
        )}
      </div>
    </div>
  );
};
