import type { ClientSessionState } from '@ptcgsim/client-session';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  SessionPresentationDispatcher,
  type SessionPresentationSource,
} from './SessionPresentationDispatcher.js';

const coin = (revision: number): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  playerId: 'blue',
  result: revision % 2 === 0 ? 'tails' : 'heads',
});

const state = (
  presentationEvents: readonly PresentationEvent[]
): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: 'blue',
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

class FakeSessionPresentationSource implements SessionPresentationSource {
  private value: ClientSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(events: readonly PresentationEvent[] = []) {
    this.value = state(events);
  }

  getSnapshot = (): ClientSessionState => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(events: readonly PresentationEvent[]): void {
    this.value = state(events);
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('SessionPresentationDispatcher', () => {
  it('delivers newly appended bounded events once and releases its source', () => {
    const first = coin(1);
    const second = coin(2);
    const third = coin(3);
    const source = new FakeSessionPresentationSource([first]);
    const sink = vi.fn();
    const dispatcher = new SessionPresentationDispatcher(source, sink);

    expect(source.listenerCount()).toBe(1);
    expect(sink).not.toHaveBeenCalled();

    source.publish([first, second]);
    expect(sink.mock.calls.map(([event]) => event)).toEqual([second]);

    // The bounded session log dropped its head while preserving event objects.
    source.publish([second, third]);
    expect(sink.mock.calls.map(([event]) => event)).toEqual([second, third]);
    source.publish([second, third]);
    expect(sink).toHaveBeenCalledTimes(2);

    dispatcher.dispose();
    dispatcher.dispose();
    expect(source.listenerCount()).toBe(0);
    source.publish([third, coin(4)]);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('serializes reentrant publications and isolates sink/report failures', () => {
    const first = coin(1);
    const second = coin(2);
    const third = coin(3);
    const source = new FakeSessionPresentationSource();
    const failure = new Error('presentation sink failed');
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const delivered: PresentationEvent[] = [];
    const sink = vi.fn((event: PresentationEvent) => {
      delivered.push(event);
      if (event === first) source.publish([second, third]);
      if (event === second) throw failure;
    });
    const dispatcher = new SessionPresentationDispatcher(
      source,
      sink,
      reportFailure
    );

    source.publish([first, second]);

    expect(delivered).toEqual([first, second, third]);
    expect(reportFailure).toHaveBeenCalledWith(failure, second);
    expect(sink).toHaveBeenCalledTimes(3);
    dispatcher.dispose();
  });
});
