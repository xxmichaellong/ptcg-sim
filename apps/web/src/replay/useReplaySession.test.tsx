// @vitest-environment happy-dom

import type { ReplayPlaybackState } from '@ptcgsim/client-session';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ReplaySessionCoordinatorState } from './ReplaySessionCoordinator.js';
import {
  useReplaySession,
  type ReplaySessionStore,
} from './useReplaySession.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const emptyPlayback: ReplayPlaybackState = { phase: 'empty', generation: 0 };

const state = (
  generation: number,
  requestPhase: ReplaySessionCoordinatorState['requestPhase']
): ReplaySessionCoordinatorState => ({
  generation,
  mode: 'live',
  requestPhase,
  sessionPhase: 'ready',
  canRequest: requestPhase === 'idle',
  canExit: requestPhase === 'loading',
  playback: emptyPlayback,
});

class FakeReplayStore implements ReplaySessionStore {
  private value = state(0, 'idle');
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): ReplaySessionCoordinatorState => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(value: ReplaySessionCoordinatorState): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('useReplaySession', () => {
  beforeEach(() => document.body.replaceChildren());

  it('publishes coordinator state and releases its subscription', async () => {
    const store = new FakeReplayStore();
    const Probe = () => {
      const replay = useReplaySession(store);
      return <output>{`${replay.mode}:${replay.requestPhase}`}</output>;
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe('live:idle');
    expect(store.listenerCount()).toBe(1);

    await act(async () => store.publish(state(1, 'loading')));
    expect(host.textContent).toBe('live:loading');

    await act(async () => root.unmount());
    expect(store.listenerCount()).toBe(0);
  });
});
