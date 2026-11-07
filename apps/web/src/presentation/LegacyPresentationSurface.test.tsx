// @vitest-environment happy-dom

import { i18n } from '@lingui/core';
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
  activityRows,
  legacyActivityClassName,
  LegacyPresentationSurface,
} from './LegacyPresentationSurface.js';
import { presentationText } from './presentation-message.js';
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
    const mulligan: PresentationEvent = {
      type: 'MulliganDeclared',
      revision: 3,
      playerId: 'spike-blue',
    };
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
    // The log and the announcement are unchanged; the table also tosses a
    // coin onto the room's result, which this surface does not paint.
    expect(runtime.coinFlip.getSnapshot().flip).toMatchObject({
      playerId: 'spike-blue',
      result: 'heads',
      motion: 'spin',
      phase: 'spinning',
    });
    expect(host.querySelector('.coin-flip')).toBeNull();

    await act(async () => {
      live.publish([first, mulligan]);
      await flushConsumers();
    });
    expect(
      [...feed.querySelectorAll('p')].map((row) => [
        row.className,
        row.textContent,
      ])
    ).toEqual([
      ['self-text', 'Blue flipped heads'],
      ['announcement', 'Blue mulligans'],
    ]);

    feed.scrollTop = 0;
    await act(async () => {
      live.publish([first, mulligan, second]);
      await flushConsumers();
    });
    expect(
      [...feed.querySelectorAll('p')].map((row) => [
        row.className,
        row.textContent,
      ])
    ).toEqual([
      ['self-text', 'Blue flipped heads'],
      ['announcement', 'Blue mulligans'],
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
      'Blue mulligans'
    );
    expect(scheduler.pendingCount).toBe(1);

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

  it('paints the intro above the entries and wipes it with Clear battle log like v1', async () => {
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
        <LegacyPresentationSurface
          runtime={runtime}
          perspective={view}
          intro={<strong>Welcome to PTCG-sim!</strong>}
        />
      )
    );
    const feed = host.querySelector('#chatbox') as HTMLDivElement;
    expect(feed.firstElementChild?.getAttribute('data-activity-intro')).toBe(
      'true'
    );
    expect(feed.textContent).toBe('Welcome to PTCG-sim!');

    await act(async () => {
      live.publish([coin(2, 'spike-blue', 'heads')]);
      await flushConsumers();
    });
    // Entries append below the intro; the intro is not an entry.
    expect(feed.firstElementChild?.getAttribute('data-activity-intro')).toBe(
      'true'
    );
    expect(feed.querySelectorAll('p')).toHaveLength(1);
    expect(feed.textContent).toBe('Welcome to PTCG-sim!Blue flipped heads');

    // v1's Clear battle log sets the whole panel's innerHTML to '' -- the
    // welcome goes with the entries and does not come back.
    await act(async () => {
      runtime.clearActivity();
    });
    expect(feed.textContent).toBe('');
    await act(async () => {
      live.publish([
        coin(2, 'spike-blue', 'heads'),
        coin(3, 'spike-red', 'tails'),
      ]);
      await flushConsumers();
    });
    expect(feed.querySelector('[data-activity-intro]')).toBeNull();
    expect(feed.textContent).toContain('Red flipped tails');

    await act(async () => root.unmount());
    runtime.dispose();
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
        effect: expect.objectContaining({
          message: expect.objectContaining({
            values: { name: 'Blue', result: 'heads' },
          }),
        }),
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
    expect(
      legacyActivityClassName({ ...item, category: 'message' }, view)
    ).toBe('self-message');
    expect(
      legacyActivityClassName(
        { ...item, category: 'message', playerId: 'spike-red' },
        view
      )
    ).toBe('opp-message');
    expect(
      legacyActivityClassName(
        {
          id: 2,
          revision: 1,
          eventType: 'ChatMessage',
          category: 'spectator',
          message: 'Watcher: Safe display text',
        },
        view
      )
    ).toBe('spectator-message');
  });
});

describe('activity rows', () => {
  let next = 0;
  // A line's message by its English (as a test catalog id), with no values.
  const line = (
    text: string,
    category: ActivityFeedItem['category'] = 'player',
    playerId: string | undefined = 'spike-blue',
    eventType: ActivityFeedItem['eventType'] = 'UndoApplied'
  ): ActivityFeedItem => ({
    id: (next += 1),
    revision: next,
    eventType,
    category,
    message: { id: text, message: text },
    ...(playerId ? { playerId } : {}),
  });

  it('folds the same game line said again and again into one row with a count', () => {
    const undo = () =>
      line('Blue took back their last move', 'announcement', undefined);
    const items = [
      line('Blue passed', 'player', 'spike-blue', 'PassDeclared'),
      undo(),
      undo(),
      undo(),
      line('Blue passed', 'player', 'spike-blue', 'PassDeclared'),
      undo(),
      // Chat is what someone said each time, so it is never folded.
      line('Blue: gg', 'message', 'spike-blue', 'ChatMessage'),
      line('Blue: gg', 'message', 'spike-blue', 'ChatMessage'),
      // The same words from the other seat are another line.
      line('Draw', 'player', 'spike-blue', 'CardsMoved'),
      line('Draw', 'player', 'spike-red', 'CardsMoved'),
    ];
    const rows = activityRows(items);
    expect(
      rows.map(({ item, count }) => [presentationText(item.message), count])
    ).toEqual([
      ['Blue passed', 1],
      ['Blue took back their last move', 3],
      ['Blue passed', 1],
      ['Blue took back their last move', 1],
      ['Blue: gg', 1],
      ['Blue: gg', 1],
      ['Draw', 1],
      ['Draw', 1],
    ]);
    // A row keeps its first line's identity, so it stays put as it grows,
    // and carries its newest line's revision.
    expect(rows[1]!.first).toBe(items[1]);
    expect(rows[1]!.item).toBe(items[3]);
  });

  it('folds by message and values, never by the words shown', () => {
    const drew = (name: string, count: number): ActivityFeedItem => ({
      id: (next += 1),
      revision: next,
      eventType: 'CardsDrawn',
      category: 'player',
      playerId: 'spike-blue',
      message: {
        id: 'drew',
        message: '{name} drew {count, plural, one {a card} other {# cards}}',
        values: { name, count },
      },
    });
    expect(
      activityRows([
        drew('Blue', 2),
        drew('Blue', 2),
        drew('Blue', 3),
        drew('Red', 3),
      ]).map(({ item, count }) => [presentationText(item.message), count])
    ).toEqual([
      ['Blue drew 2 cards', 2],
      ['Blue drew 3 cards', 1],
      ['Red drew 3 cards', 1],
    ]);
  });
});

describe('a language change', () => {
  beforeEach(() => document.body.replaceChildren());

  it('re-words the lines already in the Log', async () => {
    const live = new FakeLiveSource();
    const replay = new FakeReplaySource();
    const runtime = new LegacyGamePresentationRuntime({
      live,
      replay,
      scheduleAnnouncementClear: () => () => undefined,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <LegacyPresentationSurface
          runtime={runtime}
          perspective={view}
          announcer={false}
        />
      )
    );
    await act(async () => {
      live.publish([coin(2, 'spike-blue', 'heads')]);
      await flushConsumers();
    });
    const feed = host.querySelector('#chatbox') as HTMLDivElement;
    expect(feed.textContent).toBe('Blue flipped heads');
    const [item] = runtime.activityFeed.getSnapshot().items;

    try {
      await act(async () =>
        i18n.loadAndActivate({
          locale: 'xx',
          messages: {
            [item!.message.id]:
              '{name} a obtenu {result, select, heads {face} other {pile}}',
          },
        })
      );
      // No new line: the one already there is worded again.
      expect(feed.textContent).toBe('Blue a obtenu face');
      expect(runtime.activityFeed.getSnapshot().items).toHaveLength(1);
    } finally {
      await act(async () =>
        i18n.loadAndActivate({ locale: 'en', messages: {} })
      );
    }
    expect(feed.textContent).toBe('Blue flipped heads');
    await act(async () => root.unmount());
    runtime.dispose();
  });
});
