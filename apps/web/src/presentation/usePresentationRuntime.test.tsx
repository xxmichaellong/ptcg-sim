// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AccessibilityPresentationEffect,
  ActivityPresentationEffect,
  AnimationPresentationEffect,
} from './PresentationEffects.js';
import { PresentationRuntime } from './PresentationRuntime.js';
import {
  useAccessibilityPresentation,
  useActivityPresentation,
  useAnimationPresentation,
} from './usePresentationRuntime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const activity: ActivityPresentationEffect = {
  kind: 'activity',
  revision: 1,
  eventType: 'PlayerReset',
  category: 'player',
  playerId: 'blue',
  message: 'Blue reset',
};

const accessibility: AccessibilityPresentationEffect = {
  kind: 'accessibility',
  revision: 1,
  eventType: 'PlayerReset',
  message: 'Blue reset',
  politeness: 'polite',
};

const animation: AnimationPresentationEffect = {
  kind: 'animation',
  revision: 2,
  eventType: 'CoinFlipped',
  animation: { kind: 'coinFlip', playerId: 'blue', result: 'heads' },
};

describe('presentation runtime React bindings', () => {
  beforeEach(() => document.body.replaceChildren());

  it('subscribes each surface only to its own channel and releases on unmount', async () => {
    const runtime = new PresentationRuntime();
    const renders = { activity: 0, accessibility: 0, animation: 0 };
    const ActivityProbe = () => {
      renders.activity += 1;
      const snapshot = useActivityPresentation(runtime.activity);
      return <output id="activity">{snapshot.entries.length}</output>;
    };
    const AccessibilityProbe = () => {
      renders.accessibility += 1;
      const snapshot = useAccessibilityPresentation(runtime.accessibility);
      return (
        <output id="accessibility">{snapshot.announcements.length}</output>
      );
    };
    const AnimationProbe = () => {
      renders.animation += 1;
      const snapshot = useAnimationPresentation(runtime.animation);
      return <output id="animation">{snapshot.animations.length}</output>;
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <>
          <ActivityProbe />
          <AccessibilityProbe />
          <AnimationProbe />
        </>
      )
    );
    expect(renders).toEqual({ activity: 1, accessibility: 1, animation: 1 });

    await act(async () => runtime.adapters.appendActivity?.(activity));
    expect(renders).toEqual({ activity: 2, accessibility: 1, animation: 1 });
    expect(host.querySelector('#activity')?.textContent).toBe('1');

    await act(async () =>
      runtime.adapters.announceAccessibility?.(accessibility)
    );
    expect(renders).toEqual({ activity: 2, accessibility: 2, animation: 1 });

    await act(async () => runtime.adapters.presentAnimation?.(animation));
    expect(renders).toEqual({ activity: 2, accessibility: 2, animation: 2 });

    await act(async () => root.unmount());
    runtime.adapters.appendActivity?.(activity);
    runtime.adapters.announceAccessibility?.(accessibility);
    runtime.adapters.presentAnimation?.(animation);
    expect(renders).toEqual({ activity: 2, accessibility: 2, animation: 2 });
    runtime.dispose();
  });
});
