import type {
  RemoteGameSession,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardIntent,
  type BoardLayoutState,
  type BoardPreferences,
  type BoardRendererStatus,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BoardSessionControllerState } from '../board/BoardSessionController.js';
import { BoardSessionRuntime } from '../board/BoardSessionRuntime.js';
import { LegacyBoardKeyboardShortcuts } from '../board/LegacyBoardKeyboardShortcuts.js';
import type { LegacyBoardShortcutActionRequest } from '../board/resolveLegacyBoardShortcutAction.js';
import {
  LegacyBoardOverlays,
  type LegacyBoardOverlayActions,
} from '../board/overlays/LegacyBoardOverlays.js';
import type {
  BoardRendererFactory,
  RendererKind,
} from '../renderer-spike-handle.js';
import type { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import { useReplaySession } from '../replay/useReplaySession.js';
import { applySoloOpponentHandVisibility } from './solo-opponent-hand-visibility.js';

export type RemoteBoardSubmissionResult = SubmitCommandResult;

export type RemoteBoardSession = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'submit'
> &
  Partial<Pick<RemoteGameSession, 'declareMulligan' | 'declareDeckView'>>;

const currentViewport = (): BoardLayoutState['viewport'] => ({
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
  devicePixelRatio: Math.max(1, window.devicePixelRatio),
});

const layoutFor = (
  view: NonNullable<ReturnType<ReplaySessionCoordinator['getSnapshot']>['view']>
): BoardLayoutState => {
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  if (!firstPlayerId || !secondPlayerId || view.playerOrder.length !== 2) {
    throw new Error('Projected match must have exactly two board players');
  }
  return {
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: currentViewport(),
    playerIds: [firstPlayerId, secondPlayerId],
    bottomPlayerId:
      view.viewer.kind === 'player' ? view.viewer.playerId : firstPlayerId,
    shellMode: 'sidebar',
    vertical: {
      lowerFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerFrame },
      upperFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperFrame },
      lowerHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerHandle },
      upperHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperHandle },
      sharedPlacement: DEFAULT_BOARD_VERTICAL_LAYOUT_V1.sharedPlacement,
    },
  };
};

const viewIdentity = (
  view: ReturnType<ReplaySessionCoordinator['getSnapshot']>['view']
): string | undefined =>
  view
    ? `${view.matchId}:${view.viewer.kind === 'player' ? `player:${view.viewer.playerId}` : 'spectator'}`
    : undefined;

/**
 * Production-shaped route binding for the already-characterized controller,
 * renderer runtime, overlays, and keyboard bridge. It borrows one live/replay
 * owner and never creates a second authority or presentation coordinator.
 */
export const RemoteSessionBoard = ({
  session,
  replay,
  rendererKind,
  onIntent,
  onSubmission,
  preferences = DEFAULT_BOARD_PREFERENCES,
  roomMode = 'multiplayer',
  hideOpponentHand = false,
}: {
  readonly session: RemoteBoardSession;
  readonly replay: ReplaySessionCoordinator;
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly preferences?: BoardPreferences;
  readonly roomMode?: 'solo' | 'multiplayer';
  readonly hideOpponentHand?: boolean;
}) => {
  const replayState = useReplaySession(replay);
  const identity = viewIdentity(replayState.view);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<BoardSessionRuntime | null>(null);
  const displayPolicyRef = useRef({ roomMode, hideOpponentHand });
  const preferencesRef = useRef(preferences);
  const onIntentRef = useRef(onIntent);
  const onSubmissionRef = useRef(onSubmission);
  displayPolicyRef.current = { roomMode, hideOpponentHand };
  preferencesRef.current = preferences;
  onIntentRef.current = onIntent;
  onSubmissionRef.current = onSubmission;
  const [boardState, setBoardState] = useState<
    BoardSessionControllerState | undefined
  >();
  const [rendererStatus, setRendererStatus] = useState<BoardRendererStatus>({
    kind: 'mounting',
  });

  useEffect(() => {
    const host = hostRef.current;
    const view = replayState.view;
    if (!host) return;
    if (!view || !identity) {
      setBoardState(undefined);
      setRendererStatus({ kind: 'mounting' });
      return;
    }
    let disposed = false;
    let runtime: BoardSessionRuntime | undefined;
    let unsubscribeBoard: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let resolutionQuery: MediaQueryList | undefined;
    let resolutionMedia: string | undefined;

    setBoardState(undefined);
    setRendererStatus({ kind: 'mounting' });

    const publish = (): void => {
      if (disposed || !runtime) return;
      const snapshot = runtime.getBoardSnapshot();
      setBoardState(snapshot);
      const renderer = runtime.getRenderer();
      if (!snapshot?.scene || !renderer) {
        if (window.__PTCG_RENDERER_SPIKE__?.renderer === renderer) {
          delete window.__PTCG_RENDERER_SPIKE__;
        }
        return;
      }
      window.__PTCG_RENDERER_SPIKE__ = {
        rendererKind,
        renderer,
        scene: snapshot.scene,
      };
    };
    const synchronizeViewport = (): void => {
      if (disposed || !runtime) return;
      runtime.setViewport(currentViewport());
    };
    const scheduleViewportSynchronization = (): void => {
      if (disposed || resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        synchronizeViewport();
        observeCurrentResolution();
      });
    };
    const observeCurrentResolution = (): void => {
      const media = `(resolution: ${Math.max(1, window.devicePixelRatio)}dppx)`;
      if (media === resolutionMedia) return;
      resolutionQuery?.removeEventListener(
        'change',
        scheduleViewportSynchronization
      );
      resolutionQuery = window.matchMedia(media);
      resolutionMedia = media;
      resolutionQuery.addEventListener(
        'change',
        scheduleViewportSynchronization
      );
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        scheduleViewportSynchronization();
      }
    };

    const mount = async (): Promise<void> => {
      try {
        const createRenderer: BoardRendererFactory =
          rendererKind === 'pixi'
            ? (await import('@ptcgsim/renderer-pixi')).createPixiBoardRenderer
            : (await import('@ptcgsim/renderer-dom'))
                .createReactDomBoardRenderer;
        if (disposed) return;
        runtime = new BoardSessionRuntime({
          live: session,
          replay,
          layout: layoutFor(view),
          createRenderer,
          preferences: preferencesRef.current,
          transformView: (sourceView, source) => {
            const policy = displayPolicyRef.current;
            return source.kind === 'live' && policy.roomMode === 'solo'
              ? applySoloOpponentHandVisibility(
                  sourceView,
                  policy.hideOpponentHand
                )
              : sourceView;
          },
          onIntent: (intent) => onIntentRef.current(intent),
          onSubmission: (command, result) =>
            onSubmissionRef.current?.(command, result),
          reportError: (error) => console.error('[board-session]', error),
          reportRendererStatus: (status) => {
            if (!disposed) setRendererStatus(status);
          },
        });
        runtimeRef.current = runtime;
        await runtime.mount(host);
        if (disposed) {
          runtime.dispose();
          return;
        }
        unsubscribeBoard = runtime.subscribeBoard(publish);
        publish();
        observeCurrentResolution();
        resizeObserver = new ResizeObserver(scheduleViewportSynchronization);
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleViewportSynchronization);
        document.addEventListener('visibilitychange', handleVisibilityChange);
      } catch (error) {
        if (runtimeRef.current === runtime) runtimeRef.current = null;
        runtime?.dispose();
        if (!disposed) {
          console.error('[board-session] mount failed', error);
          setRendererStatus({ kind: 'failed', error });
        }
      }
    };
    void mount();

    return () => {
      disposed = true;
      unsubscribeBoard?.();
      resizeObserver?.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', scheduleViewportSynchronization);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resolutionQuery?.removeEventListener(
        'change',
        scheduleViewportSynchronization
      );
      const renderer = runtime?.getRenderer();
      if (window.__PTCG_RENDERER_SPIKE__?.renderer === renderer) {
        delete window.__PTCG_RENDERER_SPIKE__;
      }
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      runtime?.dispose();
    };
  }, [identity, rendererKind, replay, session]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.synchronizeSources();
  }, [hideOpponentHand, roomMode]);

  const overlayActions = useMemo<LegacyBoardOverlayActions>(
    () => ({
      emitOpenedZoneCardIntent: (intent) => {
        runtimeRef.current?.emitOpenedZoneCardIntent(intent);
      },
      dismiss: (scope) => {
        runtimeRef.current?.dismissLocalPresentation(scope);
      },
      invokeContextAction: (action, cardId) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action,
          cardId,
        });
      },
      invokeZoneAction: (action, zoneId) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'zone',
          action,
          zoneId,
        });
      },
      submitDamageInput: (cardId, value) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action: 'setDamage',
          cardId,
          value,
        });
      },
      submitSpecialConditionInput: (cardId, value) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action: 'setSpecialCondition',
          cardId,
          value,
        });
      },
      submitCountInput: (action, cardId, value) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action,
          cardId,
          value,
        });
      },
      submitShortcutCountInput: (action, value) => {
        const request: LegacyBoardShortcutActionRequest = { action, value };
        runtimeRef.current?.emitLegacyShortcutAction(request);
      },
      submitCategoryChoice: (cardId, category) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action: 'changeCardType',
          cardId,
          category,
        });
      },
      submitMoveChoice: (cardId, destination) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'context',
          action: 'moveCard',
          cardId,
          destination,
        });
      },
    }),
    []
  );
  const keyboardActions = useMemo(
    () => ({
      onRequest: (request: LegacyBoardShortcutActionRequest): void => {
        runtimeRef.current?.emitLegacyShortcutAction(request);
      },
      onLocalIntent: (intent: BoardIntent): void => {
        runtimeRef.current?.emitBoardIntent(intent);
      },
      onRefreshScene: (): void => {
        runtimeRef.current?.refreshScene();
      },
      onFlipBoard: (): void => {
        runtimeRef.current?.flipBoard();
      },
      onDismissPresentation: (): void => {
        runtimeRef.current?.dismissLocalPresentation();
      },
      onDeclareMulligan: (): void => {
        runtimeRef.current?.declareMulligan();
      },
      onDeclareDeckView: (): void => {
        runtimeRef.current?.declareDeckView();
      },
    }),
    []
  );
  const visibleStatus =
    identity && replayState.sessionPhase === 'ready'
      ? rendererStatus.kind
      : replayState.sessionPhase;

  return (
    <div className="board-spike-host">
      <div className="renderer-surface-host" ref={hostRef} />
      {boardState?.scene ? (
        <>
          <LegacyBoardOverlays
            state={boardState}
            darkMode={preferences.darkMode}
            actions={overlayActions}
          />
          <LegacyBoardKeyboardShortcuts
            state={boardState}
            darkMode={preferences.darkMode}
            soloUndoEnabled={roomMode === 'solo'}
            boardFlipEnabled={
              roomMode === 'solo' ||
              boardState.view?.viewer.kind === 'spectator'
            }
            {...keyboardActions}
          />
        </>
      ) : null}
      <span
        className="renderer-status"
        role="status"
        data-renderer-status={rendererStatus.kind}
        data-renderer-generation={
          rendererStatus.kind === 'ready'
            ? rendererStatus.generation
            : undefined
        }
        data-session-phase={identity ? undefined : replayState.sessionPhase}
      >
        {visibleStatus}
      </span>
    </div>
  );
};
