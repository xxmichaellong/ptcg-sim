import {
  InvalidProjectedReplayError,
  ReplayPlaybackController,
  type ClientSessionPhase,
  type ClientSessionState,
  type ProjectedReplayArtifact,
  type RemoteGameSession,
  type ReplayPlaybackAction,
  type ReplayPlaybackState,
} from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';

export type ReplaySessionSource = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'requestReplay'
>;

export type ReplaySessionMode = 'live' | 'replay';
export type ReplayRequestPhase = 'idle' | 'loading' | 'discarding';

export interface ReplaySessionFailure {
  readonly code:
    'unavailable' | 'interrupted' | 'invalid_artifact' | 'session_failed';
  readonly message: string;
}

export interface ReplaySessionCoordinatorState {
  readonly generation: number;
  readonly mode: ReplaySessionMode;
  readonly requestPhase: ReplayRequestPhase;
  readonly sessionPhase: ClientSessionPhase;
  readonly canRequest: boolean;
  readonly canExit: boolean;
  readonly liveRevision?: number;
  /** Effective recipient-safe view: live unless replay mode is active. */
  readonly view?: MatchViewState;
  readonly playback: ReplayPlaybackState;
  readonly failure?: ReplaySessionFailure;
}

interface ReplayRequestContext {
  readonly baselineArtifact?: ProjectedReplayArtifact;
  readonly baselineNotices: ClientSessionState['notices'];
  cancelled: boolean;
}

interface LiveIdentity {
  readonly matchId: string;
  readonly viewer: string;
}

const viewerKey = (viewer: MatchViewState['viewer']): string =>
  viewer.kind === 'player' ? `player:${viewer.playerId}` : 'spectator';

const liveIdentity = (state: ClientSessionState): LiveIdentity | undefined =>
  state.view
    ? { matchId: state.view.matchId, viewer: viewerKey(state.view.viewer) }
    : undefined;

const sameIdentity = (left: LiveIdentity, right: LiveIdentity): boolean =>
  left.matchId === right.matchId && left.viewer === right.viewer;

const terminalSession = (phase: ClientSessionPhase): boolean =>
  phase === 'closed' || phase === 'failed' || phase === 'superseded';

const sameFailure = (
  left: ReplaySessionFailure | undefined,
  right: ReplaySessionFailure | undefined
): boolean => left?.code === right?.code && left?.message === right?.message;

/**
 * Application boundary between one live remote session and isolated projected
 * replay playback. The live session remains authoritative and is never rewound.
 */
export class ReplaySessionCoordinator {
  private readonly listeners = new Set<() => void>();
  private readonly playback = new ReplayPlaybackController();
  private readonly unsubscribeSession: () => void;
  private request?: ReplayRequestContext;
  private identity?: LiveIdentity;
  private mode: ReplaySessionMode = 'live';
  private failure?: ReplaySessionFailure;
  private disposed = false;
  private readonly scheduledCompletionChecks =
    new WeakSet<ReplayRequestContext>();
  private state: ReplaySessionCoordinatorState;

  constructor(private readonly session: ReplaySessionSource) {
    const sessionState = session.getSnapshot();
    this.identity = liveIdentity(sessionState);
    this.state = this.createState(sessionState, 0);
    this.unsubscribeSession = session.subscribe(this.handleSessionChange);
  }

  getSnapshot = (): ReplaySessionCoordinatorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  requestReplay(): boolean {
    if (this.disposed || this.request) return false;
    const sessionState = this.session.getSnapshot();
    if (sessionState.phase !== 'ready' || sessionState.replayLoading) {
      return false;
    }

    const previousFailure = this.failure;
    const context: ReplayRequestContext = {
      ...(sessionState.replayArtifact
        ? { baselineArtifact: sessionState.replayArtifact }
        : {}),
      baselineNotices: sessionState.notices,
      cancelled: false,
    };
    this.request = context;
    this.failure = undefined;
    const accepted = this.session.requestReplay();
    if (!accepted) {
      if (this.request === context) {
        this.request = undefined;
        this.failure = previousFailure;
        this.publish(this.session.getSnapshot());
      }
      return false;
    }
    this.publish(this.session.getSnapshot());
    return true;
  }

  exitReplay(): boolean {
    if (this.disposed) return false;
    const wasActive = this.mode === 'replay';
    const wasLoading = Boolean(this.request && !this.request.cancelled);
    if (!wasActive && !wasLoading) return false;

    if (this.request) this.request.cancelled = true;
    this.mode = 'live';
    this.failure = undefined;
    this.playback.clear();
    this.publish(this.session.getSnapshot());
    return true;
  }

  dismissFailure(): boolean {
    if (this.disposed || !this.failure) return false;
    this.failure = undefined;
    this.publish(this.session.getSnapshot());
    return true;
  }

  dispatch(action: ReplayPlaybackAction): boolean {
    if (this.disposed || this.mode !== 'replay') return false;
    const changed = this.playback.dispatch(action);
    if (changed) this.publish(this.session.getSnapshot());
    return changed;
  }

  restart(): boolean {
    return this.dispatch('restart');
  }

  stepPrevious(): boolean {
    return this.dispatch('previous');
  }

  stepNext(): boolean {
    return this.dispatch('next');
  }

  fastForward(): boolean {
    return this.dispatch('fastForward');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSession();
    this.request = undefined;
    this.mode = 'live';
    this.failure = undefined;
    this.playback.clear();
    this.state = this.createState(
      this.session.getSnapshot(),
      this.state.generation + 1
    );
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }

  private readonly handleSessionChange = (): void => {
    if (this.disposed) return;
    const sessionState = this.session.getSnapshot();

    if (terminalSession(sessionState.phase)) {
      this.request = undefined;
      this.mode = 'live';
      this.playback.clear();
      this.identity = undefined;
      this.failure =
        sessionState.phase === 'failed'
          ? {
              code: 'session_failed',
              message:
                sessionState.failure?.message ??
                'The live session failed while replay was active',
            }
          : undefined;
      this.publish(sessionState);
      return;
    }

    const nextIdentity = liveIdentity(sessionState);
    if (
      (this.identity && !nextIdentity && sessionState.phase === 'connecting') ||
      (this.identity &&
        nextIdentity &&
        !sameIdentity(this.identity, nextIdentity))
    ) {
      this.resetForLiveIdentityChange();
    }
    if (nextIdentity) this.identity = nextIdentity;

    const request = this.request;
    if (request && !sessionState.replayLoading) {
      if (!this.completeRequest(request, sessionState)) {
        this.scheduleCompletionCheck(request);
      }
    }
    this.publish(sessionState);
  };

  private completeRequest(
    request: ReplayRequestContext,
    sessionState: ClientSessionState
  ): boolean {
    if (this.request !== request) return true;
    if (request.cancelled) {
      this.request = undefined;
      return true;
    }

    const artifact = sessionState.replayArtifact;
    if (artifact && artifact !== request.baselineArtifact) {
      this.request = undefined;
      try {
        this.playback.load(artifact);
        this.mode = 'replay';
        this.failure = undefined;
      } catch (error) {
        this.failure = {
          code: 'invalid_artifact',
          message:
            error instanceof InvalidProjectedReplayError
              ? error.message
              : 'The projected replay could not be installed',
        };
      }
      return true;
    }

    const unavailable = sessionState.notices.find(
      (notice) =>
        notice.code === 'replay_unavailable' &&
        !request.baselineNotices.includes(notice)
    );
    if (unavailable) {
      this.request = undefined;
      this.failure = { code: 'unavailable', message: unavailable.message };
      return true;
    } else if (sessionState.phase !== 'ready') {
      this.request = undefined;
      this.failure = {
        code: 'interrupted',
        message: 'The replay transfer was interrupted by the live session',
      };
      return true;
    }
    return false;
  }

  private scheduleCompletionCheck(request: ReplayRequestContext): void {
    if (this.scheduledCompletionChecks.has(request)) return;
    this.scheduledCompletionChecks.add(request);
    globalThis.queueMicrotask(() => {
      this.scheduledCompletionChecks.delete(request);
      if (this.disposed || this.request !== request) return;
      const sessionState = this.session.getSnapshot();
      if (sessionState.replayLoading) return;
      if (!this.completeRequest(request, sessionState)) {
        this.request = undefined;
        this.failure = {
          code: 'unavailable',
          message: 'The replay request completed without a new artifact',
        };
      }
      this.publish(sessionState);
    });
  }

  private resetForLiveIdentityChange(): void {
    this.request = undefined;
    this.mode = 'live';
    this.failure = undefined;
    this.playback.clear();
    this.identity = undefined;
  }

  private createState(
    sessionState: ClientSessionState,
    generation: number
  ): ReplaySessionCoordinatorState {
    const playback = this.playback.getSnapshot();
    const requestPhase: ReplayRequestPhase = this.request
      ? this.request.cancelled
        ? 'discarding'
        : 'loading'
      : 'idle';
    const replayView =
      this.mode === 'replay' && playback.phase === 'ready'
        ? playback.view
        : undefined;
    const view = replayView ?? sessionState.view;
    return {
      generation,
      mode: this.mode,
      requestPhase,
      sessionPhase: sessionState.phase,
      canRequest:
        !this.disposed &&
        sessionState.phase === 'ready' &&
        !sessionState.replayLoading &&
        !this.request,
      canExit: this.mode === 'replay' || requestPhase === 'loading',
      ...(sessionState.view
        ? { liveRevision: sessionState.view.revision }
        : {}),
      ...(view ? { view } : {}),
      playback,
      ...(this.failure ? { failure: this.failure } : {}),
    };
  }

  private publish(sessionState: ClientSessionState): void {
    const candidate = this.createState(sessionState, this.state.generation);
    if (this.samePublicState(this.state, candidate)) return;
    this.state = {
      ...candidate,
      generation: this.state.generation + 1,
    };
    for (const listener of [...this.listeners]) listener();
  }

  private samePublicState(
    left: ReplaySessionCoordinatorState,
    right: ReplaySessionCoordinatorState
  ): boolean {
    return (
      left.mode === right.mode &&
      left.requestPhase === right.requestPhase &&
      left.sessionPhase === right.sessionPhase &&
      left.canRequest === right.canRequest &&
      left.canExit === right.canExit &&
      left.liveRevision === right.liveRevision &&
      left.view === right.view &&
      left.playback === right.playback &&
      sameFailure(left.failure, right.failure)
    );
  }
}
