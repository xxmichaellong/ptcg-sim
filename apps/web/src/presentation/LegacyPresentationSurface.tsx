import type { MatchViewState } from '@ptcgsim/game-core';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import type { ActivityFeedItem } from './ActivityFeedModel.js';
import type { LegacyGamePresentationRuntime } from './LegacyGamePresentationRuntime.js';
import { usePresentationState } from './usePresentationRuntime.js';

export type LegacyActivityClassName =
  | 'self-text'
  | 'opp-text'
  | 'self-message'
  | 'opp-message'
  | 'spectator-message'
  | 'announcement';

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
    return item.category === 'spectator' ? 'spectator-message' : 'announcement';
  }
  const primaryPlayerId =
    perspective.viewer.kind === 'player'
      ? perspective.viewer.playerId
      : perspective.playerOrder[0];
  const self = item.playerId === primaryPlayerId;
  return item.category === 'message'
    ? self
      ? 'self-message'
      : 'opp-message'
    : self
      ? 'self-text'
      : 'opp-text';
};

export interface LegacyPresentationSurfaceProps {
  readonly runtime: Pick<
    LegacyGamePresentationRuntime,
    'activityFeed' | 'liveRegion'
  >;
  /** The coordinator's effective live-or-replay view perspective. */
  readonly perspective?: LegacyActivityPerspective;
  /** Uses the matching legacy solo/replay or connected multiplayer DOM ID. */
  readonly feedId?: 'chatbox' | 'p2Chatbox';
  /**
   * Opening content painted above the activity entries, like v1's welcome
   * text inside `#chatbox`. Cleared together with the entries: v1's Clear
   * battle log empties the whole panel, so once the feed has been emptied
   * after holding entries the intro stays gone.
   */
  readonly intro?: ReactNode;
  /**
   * Whether this mount also speaks the polite announcements. A feed shown
   * in a sheet that can close leaves that to a `PresentationAnnouncer`
   * mounted for the page, so a closed log never silences the table.
   */
  readonly announcer?: boolean;
}

/** A row of the feed: a line, and how many times in a row it was said. */
interface ActivityRow {
  readonly item: ActivityFeedItem;
  readonly first: ActivityFeedItem;
  readonly count: number;
}

/**
 * The feed's rows: the same game line said again and again (Undo pressed
 * twelve times) is one row with a count. What people say in chat is never
 * folded.
 */
export const activityRows = (
  items: readonly ActivityFeedItem[]
): readonly ActivityRow[] => {
  const rows: ActivityRow[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    if (
      last &&
      (item.category === 'player' || item.category === 'announcement') &&
      last.item.category === item.category &&
      last.item.eventType === item.eventType &&
      last.item.playerId === item.playerId &&
      last.item.message === item.message
    ) {
      rows[rows.length - 1] = { ...last, item, count: last.count + 1 };
    } else {
      rows.push({ item, first: item, count: 1 });
    }
  }
  return rows;
};

/** The polite live region alone: what the table says to assistive tech. */
export const PresentationAnnouncer = ({
  runtime,
}: {
  readonly runtime: Pick<LegacyGamePresentationRuntime, 'liveRegion'>;
}) => {
  const liveRegion = usePresentationState(runtime.liveRegion);
  return (
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
  );
};

/** Concrete React mount for the existing activity panel and polite live region. */
export const LegacyPresentationSurface = ({
  runtime,
  perspective,
  feedId = 'chatbox',
  intro,
  announcer = true,
}: LegacyPresentationSurfaceProps) => {
  const feed = usePresentationState(runtime.activityFeed);
  const feedElement = useRef<HTMLDivElement>(null);
  const heldEntries = useRef(false);
  const [introCleared, setIntroCleared] = useState(false);
  if (feed.items.length > 0) {
    heldEntries.current = true;
  } else if (heldEntries.current && !introCleared) {
    setIntroCleared(true);
  }

  useLayoutEffect(() => {
    const element = feedElement.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [feed.newestItemId]);

  return (
    <div className="legacy-presentation-surface">
      <div
        id={feedId}
        ref={feedElement}
        className={`legacy-activity-feed${
          feedId === 'p2Chatbox' ? ' legacy-activity-feed--multiplayer' : ''
        }`}
        role="log"
        aria-label="Log"
        aria-live="off"
      >
        {intro !== undefined && !introCleared && (
          <div className="legacy-activity-intro" data-activity-intro="true">
            {intro}
          </div>
        )}
        {activityRows(feed.items).map(({ item, first, count }) => (
          <p
            key={first.id}
            className={legacyActivityClassName(item, perspective)}
            data-event-type={item.eventType}
            data-revision={item.revision}
            {...(count > 1 ? { 'data-repeat': count } : {})}
          >
            {item.message}
            {count > 1 ? (
              <span className="legacy-activity-repeat">×{count}</span>
            ) : null}
          </p>
        ))}
      </div>
      {announcer ? <PresentationAnnouncer runtime={runtime} /> : null}
    </div>
  );
};
