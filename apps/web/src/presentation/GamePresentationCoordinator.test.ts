import type { ClientSessionState } from '@ptcgsim/client-session';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';
import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import { GamePresentationCoordinator } from './GamePresentationCoordinator.js';
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
  enteredPresentationEvents: readonly PresentationEvent[] = []
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
      replayId: 'presentation-replay',
      frameIndex: generation - 1,
      frameCount: generation,
      startRevision: 0,
      endRevision: enteredPresentationEvents.at(-1)?.revision ?? view.revision,
      truncated: false,
      view,
      atStart: generation === 1,
      atEnd: true,
      timelinePresentationEvents: enteredPresentationEvents,
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

  listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeReplaySource implements ReplayPresentationSource {
  private state = coordinatorState(0, 'live');
  private readonly listeners = new Set<() => void>();

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
    const coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) => {
          activity.push(effect.revision);
          replay.publish(coordinatorState(2, 'live'));
        },
      },
    });

    replay.publish(
      coordinatorState(1, 'replay', [coin(8, 'heads'), coin(9, 'tails')])
    );

    expect(activity).toEqual([8]);
    coordinator.dispose();
  });
});
