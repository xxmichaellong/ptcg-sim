import {
  type ClientSessionState,
  type ProjectedReplayArtifact,
} from '@ptcgsim/client-session';
import {
  hydrateMatchViewState,
  PROTOCOL_VERSION,
  type PresentationEvent,
  type SerializedMatchViewState,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  ReplaySessionCoordinator,
  type ReplaySessionSource,
} from './ReplaySessionCoordinator.js';

const view = (
  revision: number,
  matchId = 'coordinator-match'
): SerializedMatchViewState => ({
  matchId,
  revision,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: 'blue' },
  playerOrder: ['blue', 'red'],
  players: {
    blue: {
      id: 'blue',
      displayName: 'Blue',
      cardBackUrl: '/blue.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    red: {
      id: 'red',
      displayName: 'Red',
      cardBackUrl: '/red.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {},
  zones: {},
  boards: {
    blue: { activeStackId: null, benchStackIds: [] },
    red: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    blue: { inspection: null, attachmentResolution: null },
    red: { inspection: null, attachmentResolution: null },
  },
  privateInspections: [],
  turn: { number: revision, currentPlayerId: 'blue' },
});

const coin = (revision: number): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  playerId: 'blue',
  result: revision % 2 === 0 ? 'tails' : 'heads',
});

const artifact = (
  replayId: string,
  startRevision = 0,
  matchId = 'coordinator-match'
): ProjectedReplayArtifact => ({
  replayId,
  viewer: { kind: 'player', playerId: 'blue' },
  startRevision,
  endRevision: startRevision + 2,
  truncated: startRevision > 0,
  frames: [
    {
      snapshot: hydrateMatchViewState(view(startRevision, matchId)),
      presentationEvents: [],
    },
    {
      snapshot: hydrateMatchViewState(view(startRevision + 1, matchId)),
      presentationEvents: [coin(startRevision + 1)],
    },
    {
      snapshot: hydrateMatchViewState(view(startRevision + 2, matchId)),
      presentationEvents: [coin(startRevision + 2)],
    },
  ],
});

const initialState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: 'blue',
  view: hydrateMatchViewState(view(10)),
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

class FakeReplaySession implements ReplaySessionSource {
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  requestAccepted = true;
  readonly requestReplay = vi.fn((): boolean => {
    if (
      !this.requestAccepted ||
      this.state.phase !== 'ready' ||
      this.state.replayLoading
    ) {
      return false;
    }
    this.publish({ ...this.state, replayLoading: true });
    return true;
  });

  constructor(state: ClientSessionState = initialState()) {
    this.state = state;
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(state: ClientSessionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  completeReplay(replayArtifact: ProjectedReplayArtifact): void {
    this.publish({ ...this.state, replayLoading: false, replayArtifact });
  }

  makeUnavailable(message = 'Replay is not available'): void {
    this.publish({
      ...this.state,
      replayLoading: false,
      notices: [
        ...this.state.notices,
        {
          type: 'ServerNotice',
          protocolVersion: PROTOCOL_VERSION,
          code: 'replay_unavailable',
          message,
          retryable: false,
        },
      ],
    });
  }

  beginReconnect(): void {
    // RemoteGameSession clears its transfer before publishing reconnecting.
    this.publish({ ...this.state, replayLoading: false });
    this.publish({
      ...this.state,
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

const enterReplay = (
  coordinator: ReplaySessionCoordinator,
  session: FakeReplaySession,
  value: ProjectedReplayArtifact
): void => {
  expect(coordinator.requestReplay()).toBe(true);
  session.completeReplay(value);
  expect(coordinator.getSnapshot().mode).toBe('replay');
};

describe('ReplaySessionCoordinator', () => {
  it('adopts only a fresh completed artifact and never rewinds live state', () => {
    const stale = artifact('stale');
    const session = new FakeReplaySession({
      ...initialState(),
      replayArtifact: stale,
    });
    const coordinator = new ReplaySessionCoordinator(session);
    const originalLiveView = session.getSnapshot().view;

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      canRequest: true,
      canExit: false,
      liveRevision: 10,
      view: { revision: 10 },
      playback: { phase: 'empty' },
    });
    expect(coordinator.requestReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'loading',
      canRequest: false,
      canExit: true,
      view: { revision: 10 },
    });

    session.completeReplay(artifact('fresh'));
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      canRequest: true,
      canExit: true,
      liveRevision: 10,
      view: { revision: 0 },
      playback: { phase: 'ready', replayId: 'fresh', frameIndex: 0 },
    });
    expect(coordinator.stepNext()).toBe(true);
    expect(coordinator.getSnapshot().view?.revision).toBe(1);
    expect(session.getSnapshot().view).toBe(originalLiveView);

    session.publish({
      ...session.getSnapshot(),
      view: hydrateMatchViewState(view(11)),
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      liveRevision: 11,
      view: { revision: 1 },
    });

    expect(coordinator.exitReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      view: { revision: 11 },
      playback: { phase: 'empty' },
    });
  });

  it('keeps active playback visible while atomically refreshing it', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('first'));
    coordinator.stepNext();

    expect(coordinator.requestReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'loading',
      view: { revision: 1 },
      playback: { replayId: 'first', frameIndex: 1 },
    });

    session.completeReplay(artifact('replacement', 5));
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      view: { revision: 5 },
      playback: { replayId: 'replacement', frameIndex: 0 },
    });
  });

  it('discards an in-flight result after exit and never adopts it as stale state', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);

    expect(coordinator.requestReplay()).toBe(true);
    expect(coordinator.exitReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'discarding',
      canExit: false,
      playback: { phase: 'empty' },
    });

    session.completeReplay(artifact('discarded'));
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      view: { revision: 10 },
      playback: { phase: 'empty' },
    });

    expect(coordinator.requestReplay()).toBe(true);
    session.completeReplay(artifact('accepted-after-discard'));
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      playback: { replayId: 'accepted-after-discard' },
    });
  });

  it('retains active playback when a refresh is unavailable or malformed', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('stable'));
    coordinator.stepNext();

    coordinator.requestReplay();
    session.makeUnavailable('No retained replay exists');
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      view: { revision: 1 },
      playback: { replayId: 'stable', frameIndex: 1 },
      failure: { code: 'unavailable', message: 'No retained replay exists' },
    });
    expect(coordinator.dismissFailure()).toBe(true);

    const candidate = artifact('malformed');
    const malformed: ProjectedReplayArtifact = {
      ...candidate,
      frames: candidate.frames.map((frame, index) =>
        index === 1
          ? { ...frame, snapshot: hydrateMatchViewState(view(99)) }
          : frame
      ),
    };
    coordinator.requestReplay();
    session.completeReplay(malformed);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      view: { revision: 1 },
      playback: { replayId: 'stable', frameIndex: 1 },
      failure: { code: 'invalid_artifact' },
    });
  });

  it('reports interrupted loading but preserves completed playback across reconnect', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);

    coordinator.requestReplay();
    session.beginReconnect();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      sessionPhase: 'reconnecting',
      canRequest: false,
      failure: { code: 'interrupted' },
    });

    session.publish({
      ...session.getSnapshot(),
      phase: 'ready',
      reconnectAttempt: 0,
    });
    expect(coordinator.requestReplay()).toBe(true);
    session.completeReplay(artifact('after-reconnect'));
    session.publish({
      ...session.getSnapshot(),
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      sessionPhase: 'reconnecting',
      canRequest: false,
      view: { revision: 0 },
      playback: { replayId: 'after-reconnect' },
    });
  });

  it('clears replay on a new live identity or terminal session failure', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('first-room'));

    session.publish({
      ...session.getSnapshot(),
      view: hydrateMatchViewState(view(3, 'another-match')),
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      view: { matchId: 'another-match', revision: 3 },
      playback: { phase: 'empty' },
    });

    enterReplay(
      coordinator,
      session,
      artifact('second-room', 0, 'another-match')
    );
    session.publish({
      ...session.getSnapshot(),
      phase: 'failed',
      failure: { code: 'inconsistent_replay', message: 'Replay stream failed' },
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      sessionPhase: 'failed',
      playback: { phase: 'empty' },
      failure: { code: 'session_failed', message: 'Replay stream failed' },
    });
  });

  it('preserves failures when the underlying session rejects a request', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    coordinator.requestReplay();
    session.makeUnavailable();
    const before = coordinator.getSnapshot();
    session.requestAccepted = false;

    expect(coordinator.requestReplay()).toBe(false);
    expect(coordinator.getSnapshot()).toBe(before);
  });

  it('settles a response with no fresh artifact without adopting stale state', async () => {
    const stale = artifact('already-installed-in-session');
    const session = new FakeReplaySession({
      ...initialState(),
      replayArtifact: stale,
    });
    const coordinator = new ReplaySessionCoordinator(session);
    coordinator.requestReplay();

    session.publish({ ...session.getSnapshot(), replayLoading: false });
    await new Promise<void>((resolve) => globalThis.queueMicrotask(resolve));
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      playback: { phase: 'empty' },
      failure: { code: 'unavailable' },
    });
  });

  it('disposes its session subscription and clears retained playback', () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('dispose-me'));
    const listener = vi.fn();
    coordinator.subscribe(listener);
    expect(session.listenerCount()).toBe(1);

    coordinator.dispose();
    expect(session.listenerCount()).toBe(0);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      canRequest: false,
      playback: { phase: 'empty' },
    });
    expect(coordinator.requestReplay()).toBe(false);
    expect(coordinator.stepNext()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    session.publish({ ...session.getSnapshot(), phase: 'reconnecting' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
