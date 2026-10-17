import type { ClientSessionState } from '@ptcgsim/client-session';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';
import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import {
  COIN_FADE_MS,
  COIN_RESULT_LINGER_MS,
  COIN_SPIN_MS,
  CoinFlipController,
} from './CoinFlipController.js';
import { LegacyGamePresentationRuntime } from './LegacyGamePresentationRuntime.js';
import type {
  PresentationStateSource,
  QueuedPresentationAnimation,
} from './PresentationRuntime.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

const entry = (
  id: number,
  result: 'heads' | 'tails' = 'heads',
  playerId = 'blue'
): QueuedPresentationAnimation => ({
  id,
  effect: {
    kind: 'animation',
    revision: id,
    eventType: 'CoinFlipped',
    animation: { kind: 'coinFlip', playerId, result },
  },
});

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

describe('CoinFlipController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tosses, lands, lingers on the result and fades, holding the queue only while in the air', async () => {
    const controller = new CoinFlipController();
    const changes: unknown[] = [];
    controller.subscribe(() => changes.push(controller.getSnapshot().flip));
    let finished = false;
    const done = Promise.resolve(
      controller.animate(entry(7, 'tails'), new AbortController().signal)
    ).then(() => {
      finished = true;
    });

    expect(controller.getSnapshot().flip).toEqual({
      id: 7,
      playerId: 'blue',
      result: 'tails',
      motion: 'spin',
      phase: 'spinning',
      spinMs: COIN_SPIN_MS,
    });
    // A real toss: between 0.9 s and 1.2 s.
    expect(COIN_SPIN_MS).toBeGreaterThanOrEqual(900);
    expect(COIN_SPIN_MS).toBeLessThanOrEqual(1_200);

    vi.advanceTimersByTime(COIN_SPIN_MS - 1);
    await settle();
    expect(finished).toBe(false);
    vi.advanceTimersByTime(1);
    await done;
    expect(finished).toBe(true);
    expect(controller.getSnapshot().flip?.phase).toBe('landed');

    vi.advanceTimersByTime(COIN_RESULT_LINGER_MS);
    expect(controller.getSnapshot().flip?.phase).toBe('fading');
    vi.advanceTimersByTime(COIN_FADE_MS);
    expect(controller.getSnapshot().flip).toBeNull();
    expect(
      changes.map((flip) =>
        flip === null ? null : (flip as { phase: string }).phase
      )
    ).toEqual(['spinning', 'landed', 'fading', null]);
  });

  it('scales the toss with the animation speed and skips it at instant', async () => {
    let scale = 1.35;
    const controller = new CoinFlipController({ durationScale: () => scale });
    const relaxed = controller.animate(entry(1), new AbortController().signal);
    expect(controller.getSnapshot().flip?.spinMs).toBeCloseTo(
      COIN_SPIN_MS * 1.35,
      6
    );
    vi.advanceTimersByTime(COIN_SPIN_MS * 1.35);
    await relaxed;

    scale = 0;
    expect(
      controller.animate(entry(2), new AbortController().signal)
    ).toBeUndefined();
    expect(controller.getSnapshot().flip).toMatchObject({
      id: 2,
      motion: 'static',
      phase: 'landed',
    });
  });

  it('shows only the result without motion, then clears it', () => {
    const controller = new CoinFlipController();
    expect(
      controller.presentWithoutMotion(
        entry(3, 'heads', 'red'),
        new AbortController().signal
      )
    ).toBeUndefined();
    expect(controller.getSnapshot().flip).toEqual({
      id: 3,
      playerId: 'red',
      result: 'heads',
      motion: 'static',
      phase: 'landed',
      spinMs: 0,
    });
    vi.advanceTimersByTime(COIN_RESULT_LINGER_MS);
    expect(controller.getSnapshot().flip).toBeNull();
  });

  it('lets a new flip replace a lingering result at once', async () => {
    const controller = new CoinFlipController();
    const first = controller.animate(entry(1), new AbortController().signal);
    vi.advanceTimersByTime(COIN_SPIN_MS);
    await first;
    expect(controller.getSnapshot().flip?.phase).toBe('landed');

    void controller.animate(entry(2, 'tails'), new AbortController().signal);
    expect(controller.getSnapshot().flip).toMatchObject({
      id: 2,
      phase: 'spinning',
    });
    // The first flip's linger timer was cancelled with it.
    vi.advanceTimersByTime(COIN_RESULT_LINGER_MS - COIN_SPIN_MS + 1);
    expect(controller.getSnapshot().flip).toMatchObject({ id: 2 });
  });

  it('drops a coin in the air when its animation is aborted', async () => {
    const controller = new CoinFlipController();
    const abort = new AbortController();
    const running = controller.animate(entry(4), abort.signal);
    abort.abort();
    await running;
    expect(controller.getSnapshot().flip).toBeNull();
    vi.runAllTimers();
    expect(controller.getSnapshot().flip).toBeNull();
    // Already aborted work never shows a coin.
    expect(controller.animate(entry(5), abort.signal)).toBeUndefined();
    expect(controller.getSnapshot().flip).toBeNull();
  });

  it('stops publishing once disposed', () => {
    const controller = new CoinFlipController();
    const listener = vi.fn();
    controller.subscribe(listener);
    void controller.animate(entry(1), new AbortController().signal);
    controller.dispose();
    // Disposing takes the coin off the table, then nothing more is heard.
    expect(controller.getSnapshot().flip).toBeNull();
    listener.mockClear();
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
  });
});

const view = createRendererSpikeView();

const liveState = (
  presentationEvents: readonly PresentationEvent[]
): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: 'spike-blue',
  view,
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents,
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

class FakeLiveSource implements SessionPresentationSource {
  private state = liveState([]);
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): ClientSessionState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish(events: readonly PresentationEvent[]): void {
    this.state = liveState(events);
    for (const listener of [...this.listeners]) listener();
  }
}

const liveReplay: ReplaySessionCoordinatorState = {
  generation: 0,
  mode: 'live',
  requestPhase: 'idle',
  sessionPhase: 'ready',
  canRequest: true,
  canExit: false,
  liveRevision: view.revision,
  view,
  playback: { phase: 'empty', generation: 0 },
};

const replay: ReplayPresentationSource = {
  getSnapshot: () => liveReplay,
  subscribe: () => () => undefined,
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
}

describe('LegacyGamePresentationRuntime coin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const coin = (revision: number): PresentationEvent => ({
    type: 'CoinFlipped',
    revision,
    playerId: 'spike-red',
    result: 'tails',
  });

  it('tosses the coin the room rolled, and only shows it under reduced motion', async () => {
    const reducedMotion = new BooleanSource(false);
    const live = new FakeLiveSource();
    const runtime = new LegacyGamePresentationRuntime({
      live,
      replay,
      reducedMotion,
    });

    live.publish([coin(2)]);
    await settle();
    expect(runtime.coinFlip.getSnapshot().flip).toMatchObject({
      playerId: 'spike-red',
      result: 'tails',
      motion: 'spin',
      phase: 'spinning',
    });
    // The log line is untouched by the toss.
    expect(
      runtime.activityFeed.getSnapshot().items.map((item) => item.message)
    ).toEqual(['Red flipped tails']);

    // Switching motion off mid-toss re-presents the same flip as a result.
    reducedMotion.set(true);
    await settle();
    expect(runtime.coinFlip.getSnapshot().flip).toMatchObject({
      motion: 'static',
      phase: 'landed',
      result: 'tails',
    });

    live.publish([coin(2), coin(3)]);
    await settle();
    expect(runtime.coinFlip.getSnapshot().flip).toMatchObject({
      motion: 'static',
    });
    expect(runtime.game.animation.getSnapshot().animations).toEqual([]);
    runtime.dispose();
    expect(runtime.coinFlip.getSnapshot().flip).toBeNull();
  });
});
