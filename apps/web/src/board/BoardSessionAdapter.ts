import type {
  ClientSessionState,
  RemoteGameSession,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import type {
  BoardIntent,
  BoardPresentationUpdate,
  BoardScene,
} from '@ptcgsim/renderer-contract';

import type {
  ReplaySessionCoordinator,
  ReplaySessionCoordinatorState,
} from '../replay/ReplaySessionCoordinator.js';
import {
  BoardSessionController,
  type BoardProjectionBoundary,
  type BoardProjectionFrame,
  type BoardProjectionSource,
  type BoardSessionControllerEffect,
  type BoardSessionControllerState,
} from './BoardSessionController.js';

export type BoardSessionLiveSource = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'submit'
>;

export type BoardSessionReplaySource = Pick<
  ReplaySessionCoordinator,
  'getSnapshot' | 'subscribe'
>;

export type BoardSessionRendererEffect = Exclude<
  BoardSessionControllerEffect,
  { readonly kind: 'SubmitCommand' }
>;

export interface BoardSessionAdapterOptions {
  readonly live: BoardSessionLiveSource;
  readonly replay: BoardSessionReplaySource;
  readonly createScene: (view: MatchViewState) => BoardScene;
  readonly emitRendererEffect: (effect: BoardSessionRendererEffect) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: SubmitCommandResult
  ) => void;
  readonly reportEffectFailure?: (
    error: unknown,
    effect: BoardSessionControllerEffect
  ) => void;
}

const viewerKey = (view: MatchViewState | undefined): string | undefined =>
  view
    ? JSON.stringify([
        view.matchId,
        view.viewer.kind,
        view.viewer.kind === 'player' ? view.viewer.playerId : null,
      ])
    : undefined;

const replayReady = (
  state: ReplaySessionCoordinatorState
): state is ReplaySessionCoordinatorState & {
  readonly mode: 'replay';
  readonly playback: Extract<
    ReplaySessionCoordinatorState['playback'],
    { readonly phase: 'ready' }
  >;
} => state.mode === 'replay' && state.playback.phase === 'ready';

const sourceFor = (
  state: ReplaySessionCoordinatorState
): BoardProjectionSource =>
  replayReady(state)
    ? {
        kind: 'replay',
        replayId: state.playback.replayId,
        playbackGeneration: state.playback.generation,
        frameIndex: state.playback.frameIndex,
      }
    : { kind: 'live' };

const sameSource = (
  left: BoardProjectionSource,
  right: BoardProjectionSource
): boolean =>
  left.kind === right.kind &&
  (left.kind === 'live' ||
    (right.kind === 'replay' && left.replayId === right.replayId));

const viewFor = (
  state: ReplaySessionCoordinatorState,
  live: ClientSessionState
): MatchViewState | undefined => {
  if (replayReady(state)) return state.view;
  return live.phase === 'ready' ? state.view : undefined;
};

/**
 * Additive application adapter over public live/replay snapshots. Protocol
 * presentation facts remain exclusively owned by GamePresentationCoordinator.
 */
export class BoardSessionAdapter {
  private readonly controller: BoardSessionController;
  private readonly unsubscribeReplay: () => void;
  private disposed = false;

  constructor(private readonly options: BoardSessionAdapterOptions) {
    this.controller = new BoardSessionController({
      createScene: options.createScene,
      emitEffect: this.handleControllerEffect,
      ...(options.reportEffectFailure
        ? { reportEffectFailure: options.reportEffectFailure }
        : {}),
    });
    this.synchronize();
    const unsubscribe = options.replay.subscribe(this.synchronize);
    if (this.disposed) unsubscribe();
    this.unsubscribeReplay = unsubscribe;
  }

  getSnapshot = (): BoardSessionControllerState =>
    this.controller.getSnapshot();

  subscribe = (listener: () => void): (() => void) =>
    this.controller.subscribe(listener);

  emitIntent(intent: BoardIntent): boolean {
    return this.controller.dispatch({ kind: 'RendererIntent', intent });
  }

  refreshScene(): boolean {
    return this.controller.dispatch({ kind: 'RefreshScene' });
  }

  emitPresentationUpdate(update: BoardPresentationUpdate): boolean {
    return this.controller.dispatch({
      kind: 'RendererPresentationUpdated',
      update,
    });
  }

  setHoveredCard(cardId: ViewCardId | null): boolean {
    return this.controller.dispatch({ kind: 'HoverChanged', cardId });
  }

  dismissLocalPresentation(
    scope: 'all' | 'selection' | 'context' | 'preview' | 'zone' = 'all'
  ): boolean {
    return this.controller.dispatch({
      kind: 'DismissLocalPresentation',
      scope,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.unsubscribeReplay();
    } finally {
      this.controller.dispose();
    }
  }

  synchronize = (): boolean => {
    if (this.disposed) return false;
    const replayState = this.options.replay.getSnapshot();
    const liveState = this.options.live.getSnapshot();
    const source = sourceFor(replayState);
    const view = viewFor(replayState, liveState);
    const boundary = this.boundaryFor(replayState, source, view);
    const frame: BoardProjectionFrame = {
      frameToken: replayState.generation,
      source,
      boundary,
      sessionPhase: liveState.phase,
      ...(view ? { view } : {}),
      submissionsBlocked:
        source.kind === 'replay' ||
        replayState.requestPhase !== 'idle' ||
        liveState.phase !== 'ready' ||
        view?.viewer.kind !== 'player',
    };
    return this.controller.dispatch({ kind: 'FrameReceived', frame });
  };

  private boundaryFor(
    current: ReplaySessionCoordinatorState,
    source: BoardProjectionSource,
    view: MatchViewState | undefined
  ): BoardProjectionBoundary {
    const accepted = this.controller.getSnapshot();
    if (!accepted.cursor || !accepted.source) return 'resync';
    if (!sameSource(accepted.source, source)) return 'resync';
    if (source.kind === 'replay' && replayReady(current)) {
      if (accepted.source.kind !== 'replay') return 'resync';
      if (
        current.playback.generation > accepted.source.playbackGeneration &&
        current.playback.frameIndex === accepted.source.frameIndex
      ) {
        return 'resync';
      }
      return current.playback.frameIndex < accepted.source.frameIndex
        ? 'seek'
        : 'advance';
    }
    if (current.sessionPhase === 'ready' && accepted.sessionPhase !== 'ready') {
      return 'resync';
    }
    if (viewerKey(accepted.view) !== viewerKey(view)) return 'resync';
    return 'advance';
  }

  private readonly handleControllerEffect = (
    effect: BoardSessionControllerEffect
  ): void => {
    if (effect.kind !== 'SubmitCommand') {
      this.options.emitRendererEffect(effect);
      return;
    }
    const result = this.submitIfStillAllowed(effect.command);
    this.options.onSubmission?.(effect.command, result);
    if (!result.queued) {
      this.controller.dispatch({ kind: 'SubmissionRejected' });
    }
  };

  private submitIfStillAllowed(command: WireGameCommand): SubmitCommandResult {
    const replay = this.options.replay.getSnapshot();
    const live = this.options.live.getSnapshot();
    if (
      replay.mode !== 'live' ||
      replay.requestPhase !== 'idle' ||
      live.phase !== 'ready'
    ) {
      return { queued: false, reason: 'not_ready' };
    }
    if (live.view?.viewer.kind !== 'player') {
      return { queued: false, reason: 'spectator' };
    }
    // Only the real validated session submitter is reachable in this adapter;
    // the pure reducer's resolver override remains a unit-test seam.
    return this.options.live.submit(command);
  }
}
