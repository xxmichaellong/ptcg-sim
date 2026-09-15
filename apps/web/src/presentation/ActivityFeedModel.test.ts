import { describe, expect, it, vi } from 'vitest';

import {
  activityFeedForPresentation,
  createActivityFeedSource,
} from './ActivityFeedModel.js';
import type { ActivityPresentationEffect } from './PresentationEffects.js';
import { PresentationRuntime } from './PresentationRuntime.js';

const activity = (
  revision: number,
  category: ActivityPresentationEffect['category'] = 'player'
): ActivityPresentationEffect => ({
  kind: 'activity',
  revision,
  eventType: revision % 2 === 0 ? 'DeckLoaded' : 'PlayerReset',
  category,
  message: `safe message ${revision}`,
  ...(category === 'player' ? { playerId: 'blue' } : {}),
});

describe('activity feed model', () => {
  it('projects ordered safe fields and local identities without renderer details', () => {
    const model = activityFeedForPresentation({
      entries: [
        { id: 7, effect: activity(1) },
        { id: 9, effect: activity(2, 'announcement') },
      ],
    });

    expect(model).toEqual({
      items: [
        {
          id: 7,
          revision: 1,
          eventType: 'PlayerReset',
          category: 'player',
          message: 'safe message 1',
          playerId: 'blue',
        },
        {
          id: 9,
          revision: 2,
          eventType: 'DeckLoaded',
          category: 'announcement',
          message: 'safe message 2',
        },
      ],
      newestItemId: 9,
    });
    expect(activityFeedForPresentation({ entries: [] })).toEqual({
      items: [],
      newestItemId: null,
    });
  });

  it('memoizes by immutable activity snapshot and publishes only with that channel', () => {
    const runtime = new PresentationRuntime();
    const source = createActivityFeedSource(runtime.activity);
    const changed = vi.fn();
    source.subscribe(changed);
    const empty = source.getSnapshot();

    runtime.adapters.announceAccessibility?.({
      kind: 'accessibility',
      revision: 1,
      eventType: 'PlayerReset',
      message: 'announcement',
      politeness: 'polite',
    });
    expect(changed).not.toHaveBeenCalled();
    expect(source.getSnapshot()).toBe(empty);

    runtime.adapters.appendActivity?.(activity(2));
    expect(changed).toHaveBeenCalledOnce();
    const populated = source.getSnapshot();
    expect(populated.items.map((item) => item.id)).toEqual([
      runtime.activity.getSnapshot().entries[0]!.id,
    ]);
    expect(source.getSnapshot()).toBe(populated);
  });
});
