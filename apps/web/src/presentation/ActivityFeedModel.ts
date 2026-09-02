import type {
  ActivityPresentationSnapshot,
  PresentationStateSource,
} from './PresentationRuntime.js';

export interface ActivityFeedItem {
  /** Stable local identity; suitable for keyed DOM or canvas rows. */
  readonly id: number;
  readonly revision: number;
  readonly eventType: ActivityPresentationSnapshot['entries'][number]['effect']['eventType'];
  readonly category: 'player' | 'announcement';
  readonly message: string;
  /** Styling metadata only. It must never be interpolated into visible text. */
  readonly playerId?: string;
}

export interface ActivityFeedSnapshot {
  readonly items: readonly ActivityFeedItem[];
  readonly newestItemId: number | null;
}

const EMPTY_ACTIVITY_FEED: ActivityFeedSnapshot = {
  items: [],
  newestItemId: null,
};

/**
 * Converts recipient-safe activity effects into a renderer-neutral feed model.
 * It deliberately carries no DOM class names, scroll state, or mutable nodes.
 */
export const activityFeedForPresentation = (
  snapshot: ActivityPresentationSnapshot
): ActivityFeedSnapshot => {
  if (snapshot.entries.length === 0) return EMPTY_ACTIVITY_FEED;
  const items = snapshot.entries.map(({ id, effect }) => ({
    id,
    revision: effect.revision,
    eventType: effect.eventType,
    category: effect.category,
    message: effect.message,
    ...(effect.playerId ? { playerId: effect.playerId } : {}),
  }));
  return { items, newestItemId: items.at(-1)!.id };
};

/** Memoizes the projection by immutable source snapshot identity. */
export const createActivityFeedSource = (
  source: PresentationStateSource<ActivityPresentationSnapshot>
): PresentationStateSource<ActivityFeedSnapshot> => {
  let presentationSnapshot = source.getSnapshot();
  let feedSnapshot = activityFeedForPresentation(presentationSnapshot);
  return {
    subscribe: source.subscribe,
    getSnapshot: () => {
      const next = source.getSnapshot();
      if (next !== presentationSnapshot) {
        presentationSnapshot = next;
        feedSnapshot = activityFeedForPresentation(next);
      }
      return feedSnapshot;
    },
  };
};
