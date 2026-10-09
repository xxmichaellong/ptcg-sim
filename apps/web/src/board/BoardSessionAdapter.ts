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
  type BoardPresentationDismissScope,
  type OpenedZoneCardIntent,
  type BoardSessionControllerEffect,
  type BoardSessionControllerState,
} from './BoardSessionController.js';
import type { LegacyBoardOverlayActionRequest } from './resolveLegacyBoardOverlayAction.js';
import { predictWireCommand } from './predictWireCommand.js';
import type { LegacyBoardShortcutActionRequest } from './resolveLegacyBoardShortcutAction.js';
import type { OncePerGameAction } from './resolveOncePerGameAction.js';

export type BoardSessionLiveSource = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'submit'
> &
  Partial<Pick<RemoteGameSession, 'declareMulligan' | 'declareDeckView'>>;

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
  /** Applies only recipient-safe, page-local display policy before scene creation. */
  readonly transformView?: (
    view: MatchViewState,
    source: BoardProjectionSource
  ) => MatchViewState;
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
  private readonly unsubscribeLive: () => void;
  private nextFrameToken = 0;
  private disposed = false;
  private lastPendingCommandIds: readonly string[] = [];
  private synchronizeWhenIdle = false;

  constructor(private readonly options: BoardSessionAdapterOptions) {
    this.controller = new BoardSessionController({
      createScene: options.createScene,
      emitEffect: this.handleControllerEffect,
      onIdle: () => {
        if (!this.synchronizeWhenIdle) return;
        this.synchronizeWhenIdle = false;
        this.synchronize();
      },
      ...(options.reportEffectFailure
        ? { reportEffectFailure: options.reportEffectFailure }
        : {}),
    });
    this.synchronize();
    const unsubscribe = options.replay.subscribe(this.synchronize);
    if (this.disposed) unsubscribe();
    this.unsubscribeReplay = unsubscribe;
    // The replay coordinator collapses live changes that leave the view
    // alone, but a command completing without changing the view is exactly
    // what releases a settling card, so watch the queue directly.
    const unsubscribeLive = options.live.subscribe(this.synchronizePending);
    if (this.disposed) unsubscribeLive();
    this.unsubscribeLive = unsubscribeLive;
  }

  private readonly synchronizePending = (): void => {
    if (this.disposed) return;
    const pending = this.options.live
      .getSnapshot()
      .pendingCommands.map((item) => item.commandId);
    if (
      pending.length === this.lastPendingCommandIds.length &&
      pending.every((id, index) => this.lastPendingCommandIds[index] === id)
    ) {
      return;
    }
    this.synchronize();
  };

  getSnapshot = (): BoardSessionControllerState =>
    this.controller.getSnapshot();

  subscribe = (listener: () => void): (() => void) =>
    this.controller.subscribe(listener);

  emitIntent(intent: BoardIntent): boolean {
    return this.controller.dispatch({ kind: 'RendererIntent', intent });
  }

  /** Accepts only cards that belong to the recipient-safe, currently open zone. */
  emitOpenedZoneCardIntent(intent: OpenedZoneCardIntent): boolean {
    return this.controller.dispatch({ kind: 'OpenedZoneCardIntent', intent });
  }

  emitLegacyOverlayAction(request: LegacyBoardOverlayActionRequest): boolean {
    return this.controller.dispatch({
      kind: 'LegacyOverlayActionRequested',
      request,
    });
  }

  emitLegacyShortcutAction(request: LegacyBoardShortcutActionRequest): boolean {
    return this.controller.dispatch({
      kind: 'LegacyShortcutActionRequested',
      request,
    });
  }

  emitOncePerGameAction(
    targetPlayerId: string,
    action: OncePerGameAction
  ): boolean {
    return this.controller.dispatch({
      kind: 'OncePerGameActionRequested',
      targetPlayerId,
      action,
    });
  }

  /** Sends an ephemeral room declaration only from a writable live player view. */
  declareMulligan(actingPlayerId?: string): boolean {
    return this.declareFromLivePlayer('declareMulligan', actingPlayerId);
  }

  /** Sends an ephemeral room declaration only from a writable live player view. */
  declareDeckView(actingPlayerId?: string): boolean {
    return this.declareFromLivePlayer('declareDeckView', actingPlayerId);
  }

  private declareFromLivePlayer(
    declaration: 'declareMulligan' | 'declareDeckView',
    actingPlayerId?: string
  ): boolean {
    if (this.disposed) return false;
    const replay = this.options.replay.getSnapshot();
    const live = this.options.live.getSnapshot();
    if (
      replay.mode !== 'live' ||
      replay.requestPhase !== 'idle' ||
      live.phase !== 'ready' ||
      live.view?.viewer.kind !== 'player'
    ) {
      return false;
    }
    return this.options.live[declaration]?.(actingPlayerId) ?? false;
  }

  refreshScene(cause: 'layout' | 'flip' = 'layout'): boolean {
    return this.controller.dispatch({ kind: 'RefreshScene', cause });
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
    scope: BoardPresentationDismissScope = 'all'
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
      this.unsubscribeLive();
    } finally {
      this.controller.dispose();
    }
  }

  synchronize = (): boolean => {
    if (this.disposed) return false;
    // A session change inside a dispatch (a submission's queue update, say)
    // waits for the dispatch to drain. A frame built now would measure its
    // boundary against a state the queued frames are about to replace, and
    // two quick changes -- a prediction shown, then withdrawn -- could leave
    // the first one standing. One synchronize afterwards reads both.
    if (this.controller.isDispatching()) {
      this.synchronizeWhenIdle = true;
      return true;
    }
    const replayState = this.options.replay.getSnapshot();
    const liveState = this.options.live.getSnapshot();
    const source = sourceFor(replayState);
    const sourceView = viewFor(replayState, liveState);
    // Only live views carry predictions, and only for commands still in the
    // session's queue -- whichever control submitted them. A prediction that
    // no longer applies (its card moved, or the publication already shows the
    // effect) returns null and is simply not shown. A command whose
    // publication has landed is skipped outright: a draw has no precondition
    // that fails once applied, and would otherwise be shown twice.
    const predictedView =
      sourceView && source.kind === 'live'
        ? liveState.pendingCommands.reduce<MatchViewState>(
            (current, pending) =>
              pending.published
                ? current
                : (predictWireCommand(current, pending.command) ?? current),
            sourceView
          )
        : sourceView;
    const view = predictedView
      ? (this.options.transformView?.(predictedView, source) ?? predictedView)
      : undefined;
    const boundary = this.boundaryFor(replayState, source, view);
    const motionHint =
      source.kind === 'live' && boundary === 'refresh'
        ? this.queueMotionHint(liveState)
        : undefined;
    const frame: BoardProjectionFrame = {
      // The adapter may intentionally reproject one upstream generation after
      // a route-local display policy or layout change. Keep controller
      // observation ordering monotonic without pretending authority advanced.
      frameToken: ++this.nextFrameToken,
      source,
      boundary,
      sessionPhase: liveState.phase,
      ...(view ? { view } : {}),
      ...(replayReady(replayState) && replayState.playback.localDisclosure
        ? {
            replayLocalDisclosure: replayState.playback.localDisclosure,
          }
        : {}),
      submissionsBlocked:
        source.kind === 'replay' ||
        replayState.requestPhase !== 'idle' ||
        liveState.phase !== 'ready' ||
        view?.viewer.kind !== 'player',
      pendingCommandIds: liveState.pendingCommands.map(
        (pending) => pending.commandId
      ),
      ...(motionHint ? { motionHint } : {}),
    };
    this.lastPendingCommandIds = frame.pendingCommandIds ?? [];
    return this.controller.dispatch({ kind: 'FrameReceived', frame });
  };

  /**
   * A same-revision live frame changed because this client's own queue did:
   * a command the room refused has left it (its prediction is withdrawn), or
   * a new one joined it (its prediction is shown).
   */
  private queueMotionHint(
    liveState: ReturnType<BoardSessionAdapterOptions['live']['getSnapshot']>
  ): 'predict' | 'rollback' | undefined {
    const current = new Set(
      liveState.pendingCommands.map((pending) => pending.commandId)
    );
    const previous = new Set(this.lastPendingCommandIds);
    const refused = this.lastPendingCommandIds.some(
      (commandId) =>
        !current.has(commandId) &&
        liveState.completedCommands.some(
          (completed) =>
            completed.commandId === commandId && !completed.accepted
        )
    );
    if (refused) return 'rollback';
    const queued = liveState.pendingCommands.some(
      (pending) => !previous.has(pending.commandId)
    );
    return queued ? 'predict' : undefined;
  }

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
    if (
      source.kind === 'live' &&
      accepted.view &&
      view &&
      accepted.view !== view &&
      accepted.view.revision === view.revision
    ) {
      return 'refresh';
    }
    return 'advance';
  }

  private readonly handleControllerEffect = (
    effect: BoardSessionControllerEffect
  ): void => {
    if (effect.kind !== 'SubmitCommand') {
      this.options.emitRendererEffect(effect);
      return;
    }
    // Decide the prediction against the view the command was built from,
    // before the session republishes its queue and this adapter resyncs.
    const predicted =
      this.options.replay.getSnapshot().mode === 'live' &&
      predictWireCommand(
        this.options.live.getSnapshot().view ??
          this.controller.getSnapshot().view!,
        effect.command
      ) !== null;
    const result = this.submitIfStillAllowed(effect.command);
    this.options.onSubmission?.(effect.command, result);
    if (result.queued) {
      this.controller.dispatch({
        kind: 'SubmissionQueued',
        commandId: result.commandId,
        predicted,
      });
      // The queue republish that submit() triggered arrived before the
      // prediction was recorded; project it now.
      if (predicted) this.synchronize();
    } else {
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
