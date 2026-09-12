import { describe, expect, it, vi } from 'vitest';

import type {
  AccessibilityPresentationEffect,
  ActivityPresentationEffect,
  AnimationPresentationEffect,
} from './PresentationEffects.js';
import {
  MAX_PRESENTATION_RUNTIME_ENTRIES,
  PresentationRuntime,
  type PresentationRuntimePolicy,
} from './PresentationRuntime.js';

const activity = (
  revision: number,
  message = `activity ${revision}`
): ActivityPresentationEffect => ({
  kind: 'activity',
  revision,
  eventType: 'PlayerReset',
  category: 'player',
  playerId: 'blue',
  message,
});

const accessibility = (revision: number): AccessibilityPresentationEffect => ({
  kind: 'accessibility',
  revision,
  eventType: 'PlayerReset',
  message: `announcement ${revision}`,
  politeness: 'polite',
});

const animation = (revision: number): AnimationPresentationEffect => ({
  kind: 'animation',
  revision,
  eventType: 'CoinFlipped',
  animation: {
    kind: 'coinFlip',
    playerId: 'blue',
    result: revision % 2 === 0 ? 'tails' : 'heads',
  },
});

describe('PresentationRuntime', () => {
  it.each([
    ['maximumActivityEntries', -1],
    ['maximumAccessibilityAnnouncements', 1.5],
    ['maximumQueuedAnimations', Number.NaN],
    ['maximumActivityEntries', MAX_PRESENTATION_RUNTIME_ENTRIES + 1],
  ] as const)('rejects invalid %s policy values', (key, value) => {
    expect(() => new PresentationRuntime({ [key]: value })).toThrowError(
      `Invalid presentation runtime policy: ${key}`
    );
  });

  it('bounds independent channels and gives every retained effect a local identity', () => {
    const runtime = new PresentationRuntime({
      maximumActivityEntries: 2,
      maximumAccessibilityAnnouncements: 2,
      maximumQueuedAnimations: 1,
    });
    const activityChanged = vi.fn();
    const accessibilityChanged = vi.fn();
    const animationChanged = vi.fn();
    runtime.activity.subscribe(activityChanged);
    runtime.accessibility.subscribe(accessibilityChanged);
    runtime.animation.subscribe(animationChanged);

    runtime.adapters.appendActivity?.(activity(1));
    runtime.adapters.appendActivity?.(activity(2));
    runtime.adapters.appendActivity?.(activity(3));
    runtime.adapters.announceAccessibility?.(accessibility(4));
    runtime.adapters.announceAccessibility?.(accessibility(5));
    runtime.adapters.presentAnimation?.(animation(6));
    runtime.adapters.presentAnimation?.(animation(7));

    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([2, 3]);
    expect(
      runtime.accessibility
        .getSnapshot()
        .announcements.map((entry) => entry.effect.revision)
    ).toEqual([4, 5]);
    expect(
      runtime.animation
        .getSnapshot()
        .animations.map((entry) => entry.effect.revision)
    ).toEqual([7]);
    const retainedIds = [
      ...runtime.activity.getSnapshot().entries,
      ...runtime.accessibility.getSnapshot().announcements,
      ...runtime.animation.getSnapshot().animations,
    ].map((entry) => entry.id);
    expect(new Set(retainedIds).size).toBe(retainedIds.length);
    expect(activityChanged).toHaveBeenCalledTimes(3);
    expect(accessibilityChanged).toHaveBeenCalledTimes(2);
    expect(animationChanged).toHaveBeenCalledTimes(2);
  });

  it('acknowledges transient work in FIFO order and clears both queues atomically', () => {
    const runtime = new PresentationRuntime();
    runtime.adapters.announceAccessibility?.(accessibility(1));
    runtime.adapters.announceAccessibility?.(accessibility(2));
    runtime.adapters.presentAnimation?.(animation(3));
    runtime.adapters.presentAnimation?.(animation(4));
    const announcements = runtime.accessibility.getSnapshot().announcements;
    const animations = runtime.animation.getSnapshot().animations;
    const accessibilityChanged = vi.fn(() => {
      expect(runtime.animation.getSnapshot().animations).toEqual([]);
      runtime.adapters.announceAccessibility?.(accessibility(99));
      runtime.adapters.presentAnimation?.(animation(99));
    });
    const animationChanged = vi.fn(() => {
      expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    });

    expect(runtime.acknowledgeAccessibility(announcements[1]!.id)).toBe(false);
    expect(runtime.acknowledgeAnimation(animations[1]!.id)).toBe(false);
    expect(runtime.acknowledgeAccessibility(announcements[0]!.id)).toBe(true);
    expect(
      runtime.accessibility.getSnapshot().announcements.map((entry) => entry.id)
    ).toEqual([announcements[1]!.id]);

    runtime.accessibility.subscribe(accessibilityChanged);
    runtime.animation.subscribe(animationChanged);
    expect(runtime.clearTransientEffects()).toBe(true);
    expect(accessibilityChanged).toHaveBeenCalledOnce();
    expect(animationChanged).toHaveBeenCalledOnce();
    expect(runtime.clearTransientEffects()).toBe(false);
  });

  it('replaces seekable activity without duplicate publications and supports reentrant updates', () => {
    const runtime = new PresentationRuntime({ maximumActivityEntries: 2 });
    const observed: number[][] = [];
    runtime.activity.subscribe(() => {
      const revisions = runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision);
      observed.push(revisions);
      if (revisions.length === 1 && revisions[0] === 1) {
        runtime.adapters.appendActivity?.(activity(2));
      }
    });

    runtime.adapters.appendActivity?.(activity(1));
    expect(observed).toEqual([[1], [1, 2]]);

    expect(
      runtime.replaceActivity([activity(3), activity(4), activity(5)])
    ).toBe(true);
    const replaced = runtime.activity.getSnapshot();
    expect(replaced.entries.map((entry) => entry.effect.revision)).toEqual([
      4, 5,
    ]);
    expect(runtime.replaceActivity([activity(4), activity(5)])).toBe(false);
    expect(runtime.activity.getSnapshot()).toBe(replaced);
    expect(runtime.replaceActivity([])).toBe(true);
    expect(runtime.clearActivity()).toBe(false);
  });

  it('resets all state before notifying and rejects stale work after disposal', () => {
    const runtime = new PresentationRuntime();
    runtime.adapters.appendActivity?.(activity(1));
    runtime.adapters.announceAccessibility?.(accessibility(2));
    runtime.adapters.presentAnimation?.(animation(3));
    const activityChanged = vi.fn(() => {
      expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
      expect(runtime.animation.getSnapshot().animations).toEqual([]);
      if (runtime.activity.getSnapshot().entries.length === 0) {
        runtime.adapters.appendActivity?.(activity(99));
        runtime.adapters.announceAccessibility?.(accessibility(99));
        runtime.adapters.presentAnimation?.(animation(99));
      }
    });
    runtime.activity.subscribe(activityChanged);

    expect(runtime.reset()).toBe(true);
    expect(activityChanged).toHaveBeenCalledOnce();
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    runtime.adapters.appendActivity?.(activity(4));
    runtime.adapters.announceAccessibility?.(accessibility(5));
    runtime.adapters.presentAnimation?.(animation(6));
    runtime.dispose();
    runtime.dispose();
    const disposedActivity = runtime.activity.getSnapshot();
    const disposedAccessibility = runtime.accessibility.getSnapshot();
    const disposedAnimation = runtime.animation.getSnapshot();

    runtime.adapters.appendActivity?.(activity(7));
    runtime.adapters.announceAccessibility?.(accessibility(8));
    runtime.adapters.presentAnimation?.(animation(9));
    expect(runtime.activity.getSnapshot()).toBe(disposedActivity);
    expect(runtime.accessibility.getSnapshot()).toBe(disposedAccessibility);
    expect(runtime.animation.getSnapshot()).toBe(disposedAnimation);
    expect(runtime.replaceActivity([activity(10)])).toBe(false);
    expect(runtime.reset()).toBe(false);
  });

  it('allows channels to be explicitly disabled with zero bounds', () => {
    const disabled: Partial<PresentationRuntimePolicy> = {
      maximumActivityEntries: 0,
      maximumAccessibilityAnnouncements: 0,
      maximumQueuedAnimations: 0,
    };
    const runtime = new PresentationRuntime(disabled);
    runtime.adapters.appendActivity?.(activity(1));
    runtime.adapters.announceAccessibility?.(accessibility(2));
    runtime.adapters.presentAnimation?.(animation(3));

    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    expect(runtime.replaceActivity([activity(4)])).toBe(false);
  });

  it('retains one bound identity across remounts and purges identity changes', () => {
    const runtime = new PresentationRuntime();
    expect(runtime.bindIdentity('match-a:player-blue')).toBe(true);
    runtime.adapters.appendActivity?.(activity(1));
    runtime.adapters.announceAccessibility?.(accessibility(2));
    runtime.adapters.presentAnimation?.(animation(3));

    expect(runtime.bindIdentity('match-a:player-blue')).toBe(false);
    expect(runtime.activity.getSnapshot().entries).toHaveLength(1);
    expect(runtime.bindIdentity('match-b:player-blue')).toBe(true);
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    runtime.adapters.appendActivity?.(activity(4));
    expect(runtime.bindIdentity(undefined)).toBe(true);
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.bindIdentity(undefined)).toBe(false);
  });
});
