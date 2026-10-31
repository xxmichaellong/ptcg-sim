import type { ClientSessionState } from '@ptcgsim/client-session';
import type { ServerMessage } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from './PresentationEffects.js';
import { SessionChatDispatcher } from './SessionChatDispatcher.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

const chat = (index: number): ChatMessage => ({
  type: 'ChatMessage',
  protocolVersion: 2,
  messageId: `chat-${index}`,
  playerId: 'blue',
  displayName: 'Blue',
  message: `Message ${index}`,
  createdAtMs: index,
});

const state = (chatMessages: readonly ChatMessage[]): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: 'blue',
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages,
  presence: [],
  notices: [] as Extract<ServerMessage, { type: 'ServerNotice' }>[],
  replayLoading: false,
  reconnectAttempt: 0,
});

class FakeChatSource implements SessionPresentationSource {
  private value: ClientSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(messages: readonly ChatMessage[] = []) {
    this.value = state(messages);
  }

  getSnapshot = (): ClientSessionState => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(messages: readonly ChatMessage[]): void {
    this.value = state(messages);
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('SessionChatDispatcher', () => {
  it('consumes initial history and delivers new bounded objects once', () => {
    const first = chat(1);
    const second = chat(2);
    const third = chat(3);
    const source = new FakeChatSource([first]);
    const sink = vi.fn();
    const dispatcher = new SessionChatDispatcher(source, sink);

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
    source.publish([third, chat(4)]);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('serializes reentrant publications and isolates sink diagnostics', () => {
    const first = chat(1);
    const second = chat(2);
    const third = chat(3);
    const source = new FakeChatSource();
    const failure = new Error('chat sink failed');
    const reportFailure = vi.fn(() => {
      throw new Error('chat diagnostics failed');
    });
    const delivered: ChatMessage[] = [];
    const sink = vi.fn((message: ChatMessage) => {
      delivered.push(message);
      if (message === first) source.publish([second, third]);
      if (message === second) throw failure;
    });
    const dispatcher = new SessionChatDispatcher(source, sink, reportFailure);

    source.publish([first, second]);

    expect(delivered).toEqual([first, second, third]);
    expect(reportFailure).toHaveBeenCalledWith(failure, second);
    expect(sink).toHaveBeenCalledTimes(3);
    dispatcher.dispose();
  });
});
