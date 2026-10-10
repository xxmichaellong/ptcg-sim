import { describe, expect, it, vi } from 'vitest';

import type { AnimationPresentationEffect } from './PresentationEffects.js';
import { PresentationAnimationExecutor } from './PresentationAnimationExecutor.js';
import {
  PresentationRuntime,
  type PresentationStateSource,
} from './PresentationRuntime.js';

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

const deferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

class BooleanSource implements PresentationStateSource<boolean> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: boolean) {}

  readonly getSnapshot = (): boolean => this.value;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: boolean): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('PresentationAnimationExecutor', () => {
  it('serializes animations and acknowledges only after each completion', async () => {
    const runtime = new PresentationRuntime();
    const first = deferred();
    const second = deferred();
    const delivered: number[] = [];
    const executor = new PresentationAnimationExecutor({
      source: runtime.animation,
      acknowledge: runtime.acknowledgeAnimation,
      animate: (entry) => {
        delivered.push(entry.effect.revision);
        return entry.effect.revision === 1 ? first.promise : second.promise;
      },
    });

    runtime.adapters.presentAnimation?.(animation(1));
    runtime.adapters.presentAnimation?.(animation(2));
    expect(delivered).toEqual([1]);

    first.resolve();
    await flush();
    expect(delivered).toEqual([1, 2]);
    expect(
      runtime.animation
        .getSnapshot()
        .animations.map((entry) => entry.effect.revision)
    ).toEqual([2]);

    second.resolve();
    await flush();
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    executor.dispose();
  });

  it('never enters the animated path under reduced motion', async () => {
    const runtime = new PresentationRuntime();
    const preference = new BooleanSource(true);
    const animate = vi.fn();
    const presentWithoutMotion = vi.fn();
    const executor = new PresentationAnimationExecutor({
      source: runtime.animation,
      acknowledge: runtime.acknowledgeAnimation,
      animate,
      presentWithoutMotion,
      reducedMotion: preference,
    });

    runtime.adapters.presentAnimation?.(animation(1));
    await flush();

    expect(animate).not.toHaveBeenCalled();
    expect(presentWithoutMotion).toHaveBeenCalledWith(
      expect.objectContaining({ effect: animation(1) }),
      expect.any(AbortSignal)
    );
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    executor.dispose();
    expect(preference.listenerCount).toBe(0);
  });

  it('cancels and settles the current result when reduced motion turns on', async () => {
    const runtime = new PresentationRuntime();
    const preference = new BooleanSource(false);
    const pending = deferred();
    let animatedSignal: AbortSignal | undefined;
    const animate = vi.fn((_entry, signal: AbortSignal) => {
      animatedSignal = signal;
      return pending.promise;
    });
    const presentWithoutMotion = vi.fn();
    const executor = new PresentationAnimationExecutor({
      source: runtime.animation,
      acknowledge: runtime.acknowledgeAnimation,
      animate,
      presentWithoutMotion,
      reducedMotion: preference,
    });

    runtime.adapters.presentAnimation?.(animation(1));
    preference.set(false);
    expect(animate).toHaveBeenCalledOnce();
    expect(animatedSignal?.aborted).toBe(false);

    preference.set(true);
    expect(animatedSignal?.aborted).toBe(true);
    expect(presentWithoutMotion).toHaveBeenCalledOnce();
    await flush();
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    pending.resolve();
    await flush();
    expect(presentWithoutMotion).toHaveBeenCalledOnce();
    executor.dispose();
  });

  it('isolates animation and diagnostic failures before continuing', async () => {
    const runtime = new PresentationRuntime();
    const failure = new Error('renderer animation failed');
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const delivered: number[] = [];
    const executor = new PresentationAnimationExecutor({
      source: runtime.animation,
      acknowledge: runtime.acknowledgeAnimation,
      animate: (entry) => {
        delivered.push(entry.effect.revision);
        if (entry.effect.revision === 1) return Promise.reject(failure);
      },
      reportFailure,
    });

    runtime.adapters.presentAnimation?.(animation(1));
    runtime.adapters.presentAnimation?.(animation(2));
    await flush();
    await flush();

    expect(delivered).toEqual([1, 2]);
    expect(reportFailure).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ effect: animation(1) })
    );
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    executor.dispose();
  });
});
