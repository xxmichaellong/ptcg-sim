import type { ClientSessionState } from '@ptcgsim/client-session';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';
import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import { GamePresentationCoordinator } from './GamePresentationCoordinator.js';
import { GamePresentationRuntime } from './GamePresentationRuntime.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

const coin = (
  revision: number,
  result: 'heads' | 'tails'
): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  playerId: 'spike-blue',
  result,
});

const liveState = (
  presentationEvents: readonly PresentationEvent[]
): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: 'spike-blue',
  view: createRendererSpikeView(),
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

const coordinatorState = (
  generation: number,
  mode: ReplaySessionCoordinatorState['mode'],
  enteredPresentationEvents: readonly PresentationEvent[] = [],
  timelinePresentationEvents = enteredPresentationEvents,
  frameIndex = generation - 1,
  replayId = 'presentation-replay'
): ReplaySessionCoordinatorState => {
  const view = createRendererSpikeView();
  if (mode === 'live') {
    return {
      generation,
      mode,
      requestPhase: 'idle',
      sessionPhase: 'ready',
      canRequest: true,
      canExit: false,
      liveRevision: view.revision,
      view,
      playback: { phase: 'empty', generation },
    };
  }
  return {
    generation,
    mode,
    requestPhase: 'idle',
    sessionPhase: 'ready',
    canRequest: true,
    canExit: true,
    liveRevision: view.revision + 10,
    view,
    playback: {
      phase: 'ready',
      generation,
      replayId,
      frameIndex,
      frameCount: Math.max(generation, frameIndex + 1),
      startRevision: 0,
      endRevision: timelinePresentationEvents.at(-1)?.revision ?? view.revision,
      truncated: false,
      view,
      atStart: frameIndex === 0,
      atEnd: true,
      timelinePresentationEvents,
      enteredPresentationEvents,
    },
  };
};

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

  publishState(state: ClientSessionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeReplaySource implements ReplayPresentationSource {
  private state: ReplaySessionCoordinatorState;
  private readonly listeners = new Set<() => void>();

  constructor(state = coordinatorState(0, 'live')) {
    this.state = state;
  }

  getSnapshot = (): ReplaySessionCoordinatorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(state: ReplaySessionCoordinatorState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('GamePresentationCoordinator', () => {
  it('shows only the effective mode and never replays suppressed live facts', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const activity: string[] = [];
    const accessibility: string[] = [];
    const animations: string[] = [];
    const coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) =>
          activity.push(`${effect.revision}:${effect.message}`),
        announceAccessibility: (effect) =>
          accessibility.push(`${effect.revision}:${effect.message}`),
        presentAnimation: (effect) =>
          animations.push(`${effect.revision}:${effect.animation.result}`),
      },
    });
    const liveBeforeReplay = coin(1, 'heads');
    const suppressedLive = coin(2, 'tails');
    const replayEffect = coin(8, 'tails');
    const liveAfterReplay = coin(3, 'heads');

    expect(live.listenerCount()).toBe(1);
    expect(replay.listenerCount()).toBe(1);
    live.publish([liveBeforeReplay]);

    replay.publish(coordinatorState(1, 'replay'));
    live.publish([liveBeforeReplay, suppressedLive]);
    replay.publish(coordinatorState(2, 'replay', [replayEffect]));

    replay.publish(coordinatorState(3, 'live'));
    live.publish([suppressedLive]);
    live.publish([suppressedLive, liveAfterReplay]);

    expect(activity).toEqual([
      '1:Blue flipped heads',
      '8:Blue flipped tails',
      '3:Blue flipped heads',
    ]);
    expect(accessibility).toEqual(activity);
    expect(animations).toEqual(['1:heads', '8:tails', '3:heads']);

    coordinator.dispose();
    coordinator.dispose();
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
    live.publish([suppressedLive, liveAfterReplay, coin(4, 'tails')]);
    replay.publish(coordinatorState(4, 'replay', [coin(9, 'heads')]));
    expect(activity).toHaveLength(3);
  });

  it('labels effect failures with their source event', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const reportFailure = vi.fn();
    const coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: () => {
          throw new Error('activity failed');
        },
      },
      reportFailure,
    });
    const event = coin(1, 'heads');

    live.publish([event]);

    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'activity failed' }),
      expect.objectContaining({ stage: 'effect', source: 'live', event })
    );
    coordinator.dispose();
  });

  it('suppresses the rest of a replay batch after a reentrant exit', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const activity: number[] = [];
    const accessibility: number[] = [];
    const animations: number[] = [];
    const coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) => {
          activity.push(effect.revision);
          replay.publish(coordinatorState(2, 'live'));
        },
        announceAccessibility: (effect) => accessibility.push(effect.revision),
        presentAnimation: (effect) => animations.push(effect.revision),
      },
    });

    replay.publish(
      coordinatorState(1, 'replay', [coin(8, 'heads'), coin(9, 'tails')])
    );

    expect(activity).toEqual([8]);
    expect(accessibility).toEqual([]);
    expect(animations).toEqual([]);
    coordinator.dispose();
  });

  it('rebuilds replay activity on rewind while queueing only crossed one-shot effects', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const runtime = new GamePresentationRuntime({ live, replay });
    const liveEffect = coin(1, 'heads');
    const replayEffect = coin(8, 'tails');
    const replacementReplayEffect = coin(9, 'heads');
    const laterLiveEffect = coin(2, 'tails');

    expect(live.listenerCount()).toBe(2);
    expect(replay.listenerCount()).toBe(2);
    live.publish([liveEffect]);
    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([1]);
    expect(runtime.accessibility.getSnapshot().announcements).toHaveLength(1);
    expect(runtime.animation.getSnapshot().animations).toHaveLength(1);

    replay.publish(coordinatorState(1, 'replay', [], [], 0));
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    replay.publish(
      coordinatorState(2, 'replay', [replayEffect], [replayEffect], 1)
    );
    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([8]);
    expect(
      runtime.accessibility
        .getSnapshot()
        .announcements.map((entry) => entry.effect.revision)
    ).toEqual([8]);
    expect(
      runtime.animation
        .getSnapshot()
        .animations.map((entry) => entry.effect.revision)
    ).toEqual([8]);

    replay.publish(
      coordinatorState(
        3,
        'replay',
        [replacementReplayEffect],
        [replacementReplayEffect],
        1,
        'replacement-replay'
      )
    );
    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([9]);
    expect(
      runtime.accessibility
        .getSnapshot()
        .announcements.map((entry) => entry.effect.revision)
    ).toEqual([9]);
    expect(
      runtime.animation
        .getSnapshot()
        .animations.map((entry) => entry.effect.revision)
    ).toEqual([9]);

    replay.publish(
      coordinatorState(4, 'replay', [], [], 0, 'replacement-replay')
    );
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    replay.publish(
      coordinatorState(
        5,
        'replay',
        [replacementReplayEffect],
        [replacementReplayEffect],
        1,
        'replacement-replay'
      )
    );
    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([9]);
    expect(runtime.accessibility.getSnapshot().announcements).toHaveLength(1);
    expect(runtime.animation.getSnapshot().animations).toHaveLength(1);

    replay.publish(coordinatorState(6, 'live'));
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);
    live.publish([liveEffect, laterLiveEffect]);
    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([9, 2]);

    runtime.dispose();
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
  });

  it('isolates replay timeline, lifecycle, and diagnostic failures', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const announcement = vi.fn();
    const replaceReplayActivity = vi.fn(() => {
      throw new Error('timeline failed');
    });
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: { announceAccessibility: announcement },
      replaceReplayActivity,
      clearTransientEffects: () => {
        throw new Error('lifecycle failed');
      },
      reportFailure,
    });
    const event = coin(8, 'heads');

    const replayState = coordinatorState(1, 'replay', [event], [event], 0);
    replay.publish(replayState);
    replay.publish(replayState);

    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'lifecycle failed' }),
      expect.objectContaining({
        stage: 'lifecycle',
        reason: 'mode_changed',
      })
    );
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'timeline failed' }),
      expect.objectContaining({ stage: 'timeline', events: [event] })
    );
    expect(replaceReplayActivity).toHaveBeenCalledTimes(2);
    expect(announcement).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('hydrates an already-active replay timeline without replaying one-shot effects', () => {
    const event = coin(8, 'tails');
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource(
      coordinatorState(4, 'replay', [event], [event], 3)
    );
    const runtime = new GamePresentationRuntime({ live, replay });

    expect(
      runtime.activity
        .getSnapshot()
        .entries.map((entry) => entry.effect.revision)
    ).toEqual([8]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    runtime.dispose();
  });

  it('purges local presentation data at changed and terminal identity boundaries', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const runtime = new GamePresentationRuntime({ live, replay });
    const first = coin(1, 'heads');

    live.publish([first]);
    expect(runtime.activity.getSnapshot().entries).toHaveLength(1);
    expect(runtime.accessibility.getSnapshot().announcements).toHaveLength(1);
    expect(runtime.animation.getSnapshot().animations).toHaveLength(1);

    const playerView = live.getSnapshot().view;
    if (!playerView) throw new Error('Missing live player view');
    live.publishState({
      ...live.getSnapshot(),
      view: { ...playerView, viewer: { kind: 'spectator' } },
    });
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    live.publish([first, coin(2, 'tails')]);
    expect(runtime.activity.getSnapshot().entries).toHaveLength(1);
    live.publishState({ ...live.getSnapshot(), phase: 'closed' });
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
    expect(runtime.accessibility.getSnapshot().announcements).toEqual([]);
    expect(runtime.animation.getSnapshot().animations).toEqual([]);

    runtime.dispose();
  });

  it('owns and tears down optional presentation consumers after stopping producers', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const signals: AbortSignal[] = [];
    const never = new Promise<void>(() => undefined);
    const announceAccessibility = vi.fn((_entry, signal: AbortSignal) => {
      signals.push(signal);
      return never;
    });
    const animate = vi.fn((_entry, signal: AbortSignal) => {
      signals.push(signal);
      return never;
    });
    const runtime = new GamePresentationRuntime({
      live,
      replay,
      consumers: { announceAccessibility, animate },
    });

    live.publish([coin(1, 'heads')]);
    expect(runtime.consumers?.activityFeed.getSnapshot().items).toHaveLength(1);
    expect(announceAccessibility).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    runtime.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
    expect(runtime.activity.getSnapshot().entries).toEqual([]);
  });

  it('releases coordinator subscriptions if optional consumer construction fails', () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();

    expect(
      () =>
        new GamePresentationRuntime({
          live,
          replay,
          consumers: {
            animate: () => undefined,
            reducedMotion: {
              getSnapshot: () => false,
              subscribe: () => {
                throw new Error('preference subscription failed');
              },
            },
          },
        })
    ).toThrow('preference subscription failed');
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
  });
});
