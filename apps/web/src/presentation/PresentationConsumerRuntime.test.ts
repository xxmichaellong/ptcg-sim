import { describe, expect, it, vi } from 'vitest';

import type {
  AccessibilityPresentationEffect,
  ActivityPresentationEffect,
  AnimationPresentationEffect,
} from './PresentationEffects.js';
import { PresentationConsumerRuntime } from './PresentationConsumerRuntime.js';
import { PresentationRuntime } from './PresentationRuntime.js';

const activity: ActivityPresentationEffect = {
  kind: 'activity',
  revision: 1,
  eventType: 'CoinFlipped',
  category: 'player',
  message: 'Blue flipped heads',
  playerId: 'blue',
};
const accessibility: AccessibilityPresentationEffect = {
  kind: 'accessibility',
  revision: 1,
  eventType: 'CoinFlipped',
  message: 'Blue flipped heads',
  politeness: 'polite',
};
const animation: AnimationPresentationEffect = {
  kind: 'animation',
  revision: 1,
  eventType: 'CoinFlipped',
  animation: { kind: 'coinFlip', playerId: 'blue', result: 'heads' },
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('PresentationConsumerRuntime', () => {
  it('owns correct queue wiring while keeping activity independently readable', async () => {
    const runtime = new PresentationRuntime();
    runtime.adapters.appendActivity?.(activity);
    runtime.adapters.announceAccessibility?.(accessibility);
    runtime.adapters.presentAnimation?.(animation);
    const announceAccessibility = vi.fn();
    const animate = vi.fn();
    const consumers = new PresentationConsumerRuntime(runtime, {
      announceAccessibility,
      animate,
    });

    expect(consumers.activityFeed.getSnapshot()).toEqual({
      items: [
        {
          id: runtime.activity.getSnapshot().entries[0]!.id,
          revision: 1,
          eventType: 'CoinFlipped',
          category: 'player',
          message: 'Blue flipped heads',
          playerId: 'blue',
        },
      ],
      newestItemId: runtime.activity.getSnapshot().entries[0]!.id,
    });
    expect(announceAccessibility).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    await flush();
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    expect(runtime.activity.getSnapshot().entries).toHaveLength(1);

    consumers.dispose();
    consumers.dispose();
  });

  it('keeps absent consumers dormant and routes typed failure context', async () => {
    const runtime = new PresentationRuntime();
    const failure = new Error('announcement failed');
    const reportFailure = vi.fn();
    const consumers = new PresentationConsumerRuntime(runtime, {
      announceAccessibility: () => {
        throw failure;
      },
      reportFailure,
    });

    runtime.adapters.announceAccessibility?.(accessibility);
    runtime.adapters.presentAnimation?.(animation);
    await flush();

    expect(reportFailure).toHaveBeenCalledWith(failure, {
      channel: 'accessibility',
      entry: expect.objectContaining({ effect: accessibility }),
    });
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toHaveLength(1);
    consumers.dispose();
  });

  it('aborts an already-started consumer when later construction fails', () => {
    const runtime = new PresentationRuntime();
    runtime.adapters.announceAccessibility?.(accessibility);
    let signal: AbortSignal | undefined;
    const announceAccessibility = vi.fn((_entry, active: AbortSignal) => {
      signal = active;
      return new Promise<void>(() => undefined);
    });
    const invalidPreference = {
      getSnapshot: () => false,
      subscribe: (): (() => void) => {
        throw new Error('preference subscription failed');
      },
    };

    expect(
      () =>
        new PresentationConsumerRuntime(runtime, {
          announceAccessibility,
          animate: () => undefined,
          reducedMotion: invalidPreference,
        })
    ).toThrow('preference subscription failed');
    expect(signal?.aborted).toBe(true);

    runtime.adapters.announceAccessibility?.(accessibility);
    expect(announceAccessibility).toHaveBeenCalledOnce();
  });
});
