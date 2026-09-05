// @vitest-environment happy-dom

import type { ClientSessionState } from '@ptcgsim/client-session';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGameSession, type GameSessionStore } from './useGameSession.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialState = (): ClientSessionState => ({
  phase: 'idle',
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

class FakeSessionStore implements GameSessionStore {
  private state = initialState();
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(state: ClientSessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('useGameSession', () => {
  beforeEach(() => document.body.replaceChildren());

  it('publishes immutable session snapshots and releases its subscription', async () => {
    const store = new FakeSessionStore();
    const phases: string[] = [];
    const Probe = () => {
      const state = useGameSession(store);
      useEffect(() => {
        phases.push(state.phase);
      }, [state.phase]);
      return <output>{state.phase}</output>;
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe('idle');
    expect(store.listenerCount()).toBe(1);

    await act(async () =>
      store.publish({ ...store.getSnapshot(), phase: 'connecting' })
    );
    expect(host.textContent).toBe('connecting');
    expect(phases).toEqual(['idle', 'connecting']);

    await act(async () => root.unmount());
    expect(store.listenerCount()).toBe(0);
  });
});
