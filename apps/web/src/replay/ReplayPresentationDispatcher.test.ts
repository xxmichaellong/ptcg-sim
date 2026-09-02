import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from './ReplaySessionCoordinator.js';
import {
  ReplayPresentationDispatcher,
  type ReplayPresentationSource,
} from './ReplayPresentationDispatcher.js';

const coin = (revision: number): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  result: revision % 2 === 0 ? 'tails' : 'heads',
});

const liveState = (generation = 0): ReplaySessionCoordinatorState => ({
  generation,
  mode: 'live',
  requestPhase: 'idle',
  sessionPhase: 'ready',
  canRequest: true,
  canExit: false,
  liveRevision: 20,
  playback: { phase: 'empty', generation: 0 },
});

const replayState = (
  playbackGeneration: number,
  enteredPresentationEvents: readonly PresentationEvent[],
  coordinatorGeneration = playbackGeneration,
  replayId = 'projected-replay'
): ReplaySessionCoordinatorState => {
  const baseView = createRendererSpikeView();
  const revision =
    enteredPresentationEvents.at(-1)?.revision ?? baseView.revision;
  const view = { ...baseView, revision };
  return {
    generation: coordinatorGeneration,
    mode: 'replay',
    requestPhase: 'idle',
    sessionPhase: 'ready',
    canRequest: true,
    canExit: true,
    liveRevision: 20,
    view,
    playback: {
      phase: 'ready',
      generation: playbackGeneration,
      replayId,
      frameIndex: 2,
      frameCount: 3,
      startRevision: 0,
      endRevision: revision,
      truncated: false,
      view,
      atStart: false,
      atEnd: true,
      timelinePresentationEvents: enteredPresentationEvents,
      enteredPresentationEvents,
    },
  };
};

class FakePresentationSource implements ReplayPresentationSource {
  private state: ReplaySessionCoordinatorState;
  private readonly listeners = new Set<() => void>();

  constructor(state: ReplaySessionCoordinatorState = liveState()) {
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

describe('ReplayPresentationDispatcher', () => {
  it('delivers each later playback generation once in recorded order', () => {
    const alreadyCrossed = coin(3);
    const source = new FakePresentationSource(replayState(3, [alreadyCrossed]));
    const sink = vi.fn();
    const dispatcher = new ReplayPresentationDispatcher(source, sink);

    expect(source.listenerCount()).toBe(1);
    expect(sink).not.toHaveBeenCalled();

    // An unrelated coordinator publication keeps the playback generation.
    source.publish(replayState(3, [alreadyCrossed], 4));
    expect(sink).not.toHaveBeenCalled();

    const fastForwardEvents = [coin(4), coin(5), coin(6)];
    source.publish(replayState(4, fastForwardEvents, 5));
    expect(sink.mock.calls.map(([event]) => event)).toEqual(fastForwardEvents);

    source.publish(replayState(4, fastForwardEvents, 6));
    expect(sink).toHaveBeenCalledTimes(3);
    source.publish(replayState(3, [alreadyCrossed], 7));
    expect(sink).toHaveBeenCalledTimes(3);

    // Rewind/restart crosses no presentation facts; a later forward step may
    // legitimately present the same recorded fact again.
    source.publish(replayState(5, [], 8));
    source.publish(replayState(6, [coin(5)], 9));
    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      ...fastForwardEvents,
      coin(5),
    ]);

    dispatcher.dispose();
    dispatcher.dispose();
    expect(source.listenerCount()).toBe(0);
    source.publish(replayState(7, [coin(7)], 10));
    expect(sink).toHaveBeenCalledTimes(4);
  });

  it('serializes reentrant generations and isolates sink/reporting failures', () => {
    const source = new FakePresentationSource();
    const failure = new Error('animation adapter failed');
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const delivered: PresentationEvent[] = [];
    const sink = vi.fn((event: PresentationEvent) => {
      delivered.push(event);
      if (event.revision === 1) {
        source.publish(replayState(2, [coin(3)], 2));
      }
      if (event.revision === 2) throw failure;
    });
    const dispatcher = new ReplayPresentationDispatcher(
      source,
      sink,
      reportFailure
    );

    source.publish(replayState(1, [coin(1), coin(2)], 1));

    expect(delivered).toEqual([coin(1), coin(2), coin(3)]);
    expect(reportFailure).toHaveBeenCalledWith(failure, coin(2));
    expect(sink).toHaveBeenCalledTimes(3);
    dispatcher.dispose();
  });
});
