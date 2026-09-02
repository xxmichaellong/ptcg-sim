// @vitest-environment happy-dom

import type { ClientSessionState } from '@ptcgsim/client-session';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';
import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import type { ActivityFeedItem } from './ActivityFeedModel.js';
import {
  LegacyGamePresentationRuntime,
  type LegacyAnnouncementScheduler,
} from './LegacyGamePresentationRuntime.js';
import {
  legacyActivityClassName,
  LegacyPresentationSurface,
} from './LegacyPresentationSurface.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const view = createRendererSpikeView();

const coin = (
  revision: number,
  playerId: 'spike-blue' | 'spike-red',
  result: 'heads' | 'tails'
): PresentationEvent => ({ type: 'CoinFlipped', revision, playerId, result });

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

const replayState = (
  generation: number,
  mode: 'live' | 'replay',
  timelinePresentationEvents: readonly PresentationEvent[] = [],
  enteredPresentationEvents: readonly PresentationEvent[] = timelinePresentationEvents,
  frameIndex = Math.max(0, generation - 1)
): ReplaySessionCoordinatorState =>
  mode === 'live'
    ? {
        generation,
        mode,
        requestPhase: 'idle',
        sessionPhase: 'ready',
        canRequest: true,
        canExit: false,
        liveRevision: view.revision,
        view,
        playback: { phase: 'empty', generation },
      }
    : {
        generation,
        mode,
        requestPhase: 'idle',
        sessionPhase: 'ready',
        canRequest: true,
        canExit: true,
        liveRevision: view.revision,
        view,
        playback: {
          phase: 'ready',
          generation,
          replayId: 'surface-replay',
          frameIndex,
          frameCount: 2,
          startRevision: 0,
          endRevision:
            timelinePresentationEvents.at(-1)?.revision ?? view.revision,
          truncated: false,
          view,
          atStart: frameIndex === 0,
          atEnd: frameIndex === 1,
          timelinePresentationEvents,
          enteredPresentationEvents,
        },
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
  private state = replayState(0, 'live');
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

class ControlledAnnouncementScheduler {
  private readonly jobs: Array<{
    readonly complete: () => void;
    cancelled: boolean;
    completed: boolean;
  }> = [];

  readonly schedule: LegacyAnnouncementScheduler = (complete) => {
    const job = { complete, cancelled: false, completed: false };
    this.jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };

  get pendingCount(): number {
    return this.jobs.filter((job) => !job.cancelled && !job.completed).length;
  }

  completeNext(): void {
    const job = this.jobs.find((candidate) => !candidate.cancelled);
    if (!job) throw new Error('No announcement is waiting');
    job.completed = true;
    job.complete();
  }
}

const flushConsumers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('LegacyPresentationSurface', () => {
  beforeEach(() => document.body.replaceChildren());

  it('mounts recipient-safe rows, legacy colors, scrolling, and FIFO announcements', async () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const scheduler = new ControlledAnnouncementScheduler();
    const runtime = new LegacyGamePresentationRuntime({
      live,
      replay,
      scheduleAnnouncementClear: scheduler.schedule,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <LegacyPresentationSurface runtime={runtime} perspective={view} />
      )
    );
    const feed = host.querySelector('#chatbox') as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', {
      configurable: true,
      value: 321,
    });

    const first = coin(2, 'spike-blue', 'heads');
    const second = coin(3, 'spike-red', 'tails');
    await act(async () => {
      live.publish([first]);
      await flushConsumers();
    });
    expect(feed.textContent).toBe('Blue flipped heads');
    expect(feed.querySelector('p')?.className).toBe('self-text');
    expect(feed.querySelector('p')?.dataset.eventType).toBe('CoinFlipped');
    expect(feed.scrollTop).toBe(321);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Blue flipped heads'
    );
    expect(scheduler.pendingCount).toBe(1);
    expect(runtime.game.animation.getSnapshot().animations).toEqual([]);
    expect(host.querySelector('[data-coin-animation]')).toBeNull();

    feed.scrollTop = 0;
    await act(async () => {
      live.publish([first, second]);
      await flushConsumers();
    });
    expect(
      [...feed.querySelectorAll('p')].map((row) => [
        row.className,
        row.textContent,
      ])
    ).toEqual([
      ['self-text', 'Blue flipped heads'],
      ['opp-text', 'Red flipped tails'],
    ]);
    expect(feed.scrollTop).toBe(321);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Blue flipped heads'
    );

    await act(async () => {
      scheduler.completeNext();
      await flushConsumers();
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Red flipped tails'
    );
    expect(scheduler.pendingCount).toBe(1);

    await act(async () => {
      scheduler.completeNext();
      await flushConsumers();
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    expect(runtime.game.accessibility.getSnapshot().announcements).toEqual([]);

    await act(async () => {
      runtime.dispose();
      runtime.dispose();
    });
    expect(feed.childElementCount).toBe(0);
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
    await act(async () => root.unmount());
  });

  it('replaces activity and cancels stale live-region work across replay seek', async () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const scheduler = new ControlledAnnouncementScheduler();
    const runtime = new LegacyGamePresentationRuntime({
      live,
      replay,
      scheduleAnnouncementClear: scheduler.schedule,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <LegacyPresentationSurface runtime={runtime} perspective={view} />
      )
    );

    const liveCoin = coin(2, 'spike-blue', 'heads');
    const replayCoin = coin(8, 'spike-red', 'tails');
    await act(async () => live.publish([liveCoin]));
    expect(host.querySelector('#chatbox')?.textContent).toBe(
      'Blue flipped heads'
    );

    await act(async () => {
      replay.publish(replayState(1, 'replay', [replayCoin], [replayCoin], 1));
      await flushConsumers();
    });
    expect(host.querySelector('#chatbox')?.textContent).toBe(
      'Red flipped tails'
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Red flipped tails'
    );
    expect(scheduler.pendingCount).toBe(1);

    await act(async () => replay.publish(replayState(2, 'replay', [], [], 0)));
    expect(host.querySelector('#chatbox')?.textContent).toBe('');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    expect(scheduler.pendingCount).toBe(0);

    await act(async () => runtime.dispose());
    await act(async () => root.unmount());
  });

  it('clears and reports a live-region scheduling failure without wedging the queue', async () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const failure = new Error('timer unavailable');
    const reportConsumerFailure = vi.fn();
    const runtime = new LegacyGamePresentationRuntime({
      live,
      replay,
      scheduleAnnouncementClear: () => {
        throw failure;
      },
      reportConsumerFailure,
    });

    live.publish([coin(2, 'spike-blue', 'heads')]);
    await flushConsumers();

    expect(runtime.liveRegion.getSnapshot().announcement).toBeNull();
    expect(runtime.game.accessibility.getSnapshot().announcements).toEqual([]);
    expect(reportConsumerFailure).toHaveBeenCalledWith(failure, {
      channel: 'accessibility',
      entry: expect.objectContaining({
        effect: expect.objectContaining({ message: 'Blue flipped heads' }),
      }),
    });
    runtime.dispose();
  });

  it('uses the first seat as the spectator color anchor and neutralizes missing context', () => {
    const item: ActivityFeedItem = {
      id: 1,
      revision: 1,
      eventType: 'CoinFlipped',
      category: 'player',
      message: 'Safe display text',
      playerId: 'spike-blue',
    };
    const spectator = { ...view, viewer: { kind: 'spectator' as const } };

    expect(legacyActivityClassName(item, view)).toBe('self-text');
    expect(legacyActivityClassName(item, spectator)).toBe('self-text');
    expect(
      legacyActivityClassName({ ...item, playerId: 'spike-red' }, spectator)
    ).toBe('opp-text');
    expect(legacyActivityClassName(item, undefined)).toBe('announcement');
    expect(
      legacyActivityClassName({ ...item, category: 'announcement' }, spectator)
    ).toBe('announcement');
  });
});
