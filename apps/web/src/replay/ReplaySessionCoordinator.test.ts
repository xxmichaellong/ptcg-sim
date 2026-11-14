import {
  type ClientSessionState,
  type ProjectedReplayArtifact,
  serializeProjectedReplayFile,
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
  it('atomically imports inert replay bytes without requesting authority data', async () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    const imported = artifact('imported-file', 4, 'shared-offline-match');
    const canonicalFile = await serializeProjectedReplayFile(imported);
    const operation = coordinator.importReplayFileBytes(
      new TextEncoder().encode(canonicalFile)
    );

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'importing',
      canRequest: false,
      canExit: true,
      view: { matchId: 'coordinator-match', revision: 10 },
    });
    expect(session.requestReplay).not.toHaveBeenCalled();
    await expect(operation).resolves.toBe(true);
    expect(session.requestReplay).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      view: { matchId: 'shared-offline-match', revision: 4 },
      playback: { replayId: 'imported-file', frameIndex: 0 },
    });
    await expect(
      serializeProjectedReplayFile(coordinator.getReplayArtifact()!)
    ).resolves.toBe(canonicalFile);

    session.publish({
      ...session.getSnapshot(),
      view: hydrateMatchViewState(view(11)),
    });
    expect(coordinator.getSnapshot().view?.matchId).toBe(
      'shared-offline-match'
    );
    expect(coordinator.exitReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      view: { matchId: 'coordinator-match', revision: 11 },
    });
  });

  it('keeps active playback atomic when imported bytes are invalid', async () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('stable-before-import'));
    coordinator.stepNext();
    const before = coordinator.getReplayArtifact();

    await expect(
      coordinator.importReplayFileBytes(new TextEncoder().encode('{'))
    ).resolves.toBe(false);
    expect(session.requestReplay).toHaveBeenCalledTimes(1);
    expect(coordinator.getReplayArtifact()).toBe(before);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      view: { revision: 1 },
      playback: { replayId: 'stable-before-import', frameIndex: 1 },
      failure: { code: 'invalid_artifact' },
    });
  });

  it('atomically replaces active playback only after a valid file completes', async () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('old-active-replay'));
    coordinator.stepNext();
    session.publish({
      ...session.getSnapshot(),
      view: hydrateMatchViewState(view(11)),
    });
    const replacement = artifact('replacement-file', 6, 'imported-match');
    const operation = coordinator.importReplayFileBytes(
      new TextEncoder().encode(await serializeProjectedReplayFile(replacement))
    );

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'importing',
      view: { matchId: 'coordinator-match', revision: 1 },
      playback: { replayId: 'old-active-replay', frameIndex: 1 },
    });
    await expect(operation).resolves.toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      view: { matchId: 'imported-match', revision: 6 },
      playback: { replayId: 'replacement-file', frameIndex: 0 },
    });
    expect(coordinator.exitReplay()).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      view: { matchId: 'coordinator-match', revision: 11 },
    });
  });

  it('serializes imports against authority requests and other imports', async () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    const bytes = new TextEncoder().encode(
      await serializeProjectedReplayFile(artifact('exclusive-import'))
    );
    const first = coordinator.importReplayFileBytes(bytes);

    expect(coordinator.requestReplay()).toBe(false);
    await expect(coordinator.requestReplayArtifact()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'unavailable' },
    });
    await expect(coordinator.importReplayFileBytes(bytes)).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(session.requestReplay).not.toHaveBeenCalled();

    expect(coordinator.requestReplay()).toBe(true);
    await expect(coordinator.importReplayFileBytes(bytes)).resolves.toBe(false);
  });

  it('cannot install a late file after identity change, cancellation, or disposal', async () => {
    const bytes = new TextEncoder().encode(
      await serializeProjectedReplayFile(artifact('late-import'))
    );

    const changedSession = new FakeReplaySession();
    const changed = new ReplaySessionCoordinator(changedSession);
    const changedOperation = changed.importReplayFileBytes(bytes);
    changedSession.publish({
      ...changedSession.getSnapshot(),
      view: hydrateMatchViewState(view(0, 'replacement-live-match')),
    });
    await expect(changedOperation).resolves.toBe(false);
    expect(changed.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      view: { matchId: 'replacement-live-match' },
      playback: { phase: 'empty' },
    });

    const cancelledSession = new FakeReplaySession();
    const cancelled = new ReplaySessionCoordinator(cancelledSession);
    const cancelledOperation = cancelled.importReplayFileBytes(bytes);
    expect(cancelled.exitReplay()).toBe(true);
    await expect(cancelledOperation).resolves.toBe(false);
    expect(cancelled.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      playback: { phase: 'empty' },
    });

    const disposedSession = new FakeReplaySession();
    const disposed = new ReplaySessionCoordinator(disposedSession);
    const disposedOperation = disposed.importReplayFileBytes(bytes);
    disposed.dispose();
    await expect(disposedOperation).resolves.toBe(false);
    expect(disposed.getSnapshot()).toMatchObject({
      mode: 'live',
      canRequest: false,
      playback: { phase: 'empty' },
    });
  });

  it('cancels imports on transient non-ready or authority-loading state', async () => {
    const bytes = new TextEncoder().encode(
      await serializeProjectedReplayFile(artifact('transient-import'))
    );
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    enterReplay(coordinator, session, artifact('preserved-replay'));
    coordinator.stepNext();
    const operation = coordinator.importReplayFileBytes(bytes);

    session.publish({
      ...session.getSnapshot(),
      phase: 'reconnecting',
      replayLoading: false,
    });
    session.publish({
      ...session.getSnapshot(),
      phase: 'ready',
    });
    await expect(operation).resolves.toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'replay',
      requestPhase: 'idle',
      playback: { replayId: 'preserved-replay', frameIndex: 1 },
      failure: { code: 'interrupted' },
    });
    expect(session.requestReplay).toHaveBeenCalledTimes(1);

    const authoritySession = new FakeReplaySession();
    const authorityCoordinator = new ReplaySessionCoordinator(authoritySession);
    const authorityOperation =
      authorityCoordinator.importReplayFileBytes(bytes);
    authoritySession.publish({
      ...authoritySession.getSnapshot(),
      replayLoading: true,
    });
    authoritySession.publish({
      ...authoritySession.getSnapshot(),
      replayLoading: false,
    });
    await expect(authorityOperation).resolves.toBe(false);
    expect(authorityCoordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      playback: { phase: 'empty' },
      failure: { code: 'interrupted' },
    });
    expect(authoritySession.requestReplay).not.toHaveBeenCalled();

    const notReadySession = new FakeReplaySession({
      ...initialState(),
      phase: 'reconnecting',
    });
    const notReady = new ReplaySessionCoordinator(notReadySession);
    await expect(notReady.importReplayFileBytes(bytes)).resolves.toBe(false);
    expect(notReady.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      sessionPhase: 'reconnecting',
    });
    expect(notReadySession.requestReplay).not.toHaveBeenCalled();
  });

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
    expect(coordinator.getReplayArtifact()?.replayId).toBe('fresh');
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
    expect(coordinator.getReplayArtifact()).toBeUndefined();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      view: { revision: 11 },
      playback: { phase: 'empty' },
    });
  });

  it('returns a fresh export artifact without entering or rewinding replay mode', async () => {
    const stale = artifact('stale-export');
    const session = new FakeReplaySession({
      ...initialState(),
      replayArtifact: stale,
    });
    const coordinator = new ReplaySessionCoordinator(session);
    const resultPromise = coordinator.requestReplayArtifact();

    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'loading',
      canRequest: false,
      canExit: false,
      view: { revision: 10 },
      playback: { phase: 'empty' },
    });
    expect(coordinator.getReplayArtifact()).toBeUndefined();

    const fresh = artifact('fresh-export', 4);
    session.completeReplay(fresh);
    await expect(resultPromise).resolves.toEqual({ ok: true, artifact: fresh });
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      canRequest: true,
      canExit: false,
      view: { revision: 10 },
      playback: { phase: 'empty' },
    });
    expect(coordinator.getReplayArtifact()).toBeUndefined();
  });

  it('settles export requests on authority refusal and route teardown', async () => {
    const session = new FakeReplaySession();
    const coordinator = new ReplaySessionCoordinator(session);
    const unavailable = coordinator.requestReplayArtifact();
    session.makeUnavailable('No safe replay is retained');
    await expect(unavailable).resolves.toEqual({
      ok: false,
      failure: {
        code: 'unavailable',
        message: 'No safe replay is retained',
      },
    });

    coordinator.dismissFailure();
    const interrupted = coordinator.requestReplayArtifact();
    coordinator.dispose();
    await expect(interrupted).resolves.toEqual({
      ok: false,
      failure: {
        code: 'interrupted',
        message: 'The replay export was interrupted by route teardown',
      },
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
