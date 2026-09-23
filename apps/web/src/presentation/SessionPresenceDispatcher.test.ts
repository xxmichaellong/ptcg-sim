import type { ClientSessionState } from '@ptcgsim/client-session';
import type { ServerMessage } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { PresenceMessage } from './PresentationEffects.js';
import { SessionPresenceDispatcher } from './SessionPresenceDispatcher.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

const presence = (index: number): PresenceMessage => ({
  type: 'Presence',
  protocolVersion: 2,
  displayName: `Viewer ${index}`,
  status: index % 2 === 0 ? 'reconnected' : 'disconnected',
});

const state = (entries: readonly PresenceMessage[]): ClientSessionState => ({
  phase: 'ready',
  role: 'spectator',
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages: [],
  presence: entries,
  notices: [] as Extract<ServerMessage, { type: 'ServerNotice' }>[],
  replayLoading: false,
  reconnectAttempt: 0,
});

class FakePresenceSource implements SessionPresentationSource {
  private value: ClientSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(entries: readonly PresenceMessage[] = []) {
    this.value = state(entries);
  }

  getSnapshot = (): ClientSessionState => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(entries: readonly PresenceMessage[]): void {
    this.value = state(entries);
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('SessionPresenceDispatcher', () => {
  it('consumes initial history and delivers new bounded objects once', () => {
    const first = presence(1);
    const second = presence(2);
    const third = presence(3);
    const source = new FakePresenceSource([first]);
    const sink = vi.fn();
    const dispatcher = new SessionPresenceDispatcher(source, sink);

    expect(sink).not.toHaveBeenCalled();
    source.publish([first, second]);
    source.publish([second, third]);
    source.publish([second, third]);
    expect(sink.mock.calls.map(([message]) => message)).toEqual([
      second,
      third,
    ]);

    dispatcher.dispose();
    dispatcher.dispose();
    expect(source.listenerCount()).toBe(0);
    source.publish([third, presence(4)]);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('serializes reentrant publications and isolates sink diagnostics', () => {
    const first = presence(1);
    const second = presence(2);
    const third = presence(3);
    const source = new FakePresenceSource();
    const failure = new Error('presence sink failed');
    const reportFailure = vi.fn(() => {
      throw new Error('presence diagnostics failed');
    });
    const delivered: PresenceMessage[] = [];
    const sink = vi.fn((message: PresenceMessage) => {
      delivered.push(message);
      if (message === first) source.publish([second, third]);
      if (message === second) throw failure;
    });
    const dispatcher = new SessionPresenceDispatcher(
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
