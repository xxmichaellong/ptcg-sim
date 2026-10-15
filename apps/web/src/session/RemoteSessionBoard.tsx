import { loadBoardRenderer } from '../load-board-renderer.js';
import { useBoardParallax } from '../motion/useBoardParallax.js';
import type {
  RemoteGameSession,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState, PlayerId, ViewCardId } from '@ptcgsim/game-core';
import {
  BoardDepthProjection,
  CARD_IMAGE_RETRY_EVENT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  tableVerticalLayout,
  type BoardIntent,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type BoardPreferences,
  type BoardRendererStatus,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { CoinIcon } from '@phosphor-icons/react/dist/csr/Coin';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react';

import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';
import type { BoardSessionControllerState } from '../board/BoardSessionController.js';
import { CoinFlipOverlay } from '../board/CoinFlipOverlay.js';
import {
  LegacyBoardChrome,
  type LegacyBoardChromeRail,
} from '../board/LegacyBoardChrome.js';
import type { RailAction } from '../board/rail/TableRail.js';
import {
  CardHoverStore,
  CardInspector,
} from '../board/inspector/CardInspector.js';
import { TurnBanner } from '../board/banner/TurnBanner.js';
import { TouchCardBar } from '../board/TouchCardBar.js';
import {
  TableZoneAffordances,
  type TableZoneAffordancesProps,
} from '../board/TableZoneAffordances.js';
import { BoardSessionRuntime } from '../board/BoardSessionRuntime.js';
import { LegacyBoardKeyboardShortcuts } from '../board/LegacyBoardKeyboardShortcuts.js';
import type { LegacyBoardShortcutActionRequest } from '../board/resolveLegacyBoardShortcutAction.js';
import { refusalNotice } from '../board/refusal-notice.js';
import { resolveBoardDrop } from '../board/resolveBoardDrop.js';
import { resolvePublicCardVisibilityAction } from '../board/resolvePublicVisibilityAction.js';
import {
  boardViewSettings,
  hiddenPhysicalSideFor,
  oncePerGameMarkerCount,
  type BoardViewSettings,
} from '../board/view/board-view-settings.js';
import {
  LegacyBoardOverlays,
  type LegacyBoardOverlayActions,
} from '../board/overlays/LegacyBoardOverlays.js';
import type { RendererKind } from '../renderer-spike-handle.js';
import type { CoinFlipSnapshot } from '../presentation/CoinFlipController.js';
import type { PresentationStateSource } from '../presentation/PresentationRuntime.js';
import type { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import { useReplaySession } from '../replay/useReplaySession.js';
import { applyHandSortDisplay } from './hand-sort-display.js';
import { applySoloOpponentHandVisibility } from './solo-opponent-hand-visibility.js';
import { useHotkeyHints } from '../hotkeys/hotkey-preferences.js';
import {
  POINTER_SEAM_BAND_PX,
  TOUCH_SEAM_BAND_PX,
} from '../board/table-seam.js';
import type { DockSlide } from './shell/dock-slide.js';
import type { ActionMenuEntry } from '../ui/ActionMenu.js';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../ui/breakpoints.js';
import { toast } from '../ui/toast.js';

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
  view: NonNullable<
    ReturnType<ReplaySessionCoordinator['getSnapshot']>['view']
  >,
  boardView: BoardViewSettings,
  sidePanel: number,
  seamBandPx: number | undefined
): BoardLayoutState => {
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  if (!firstPlayerId || !secondPlayerId || view.playerOrder.length !== 2) {
    throw new Error('Projected match must have exactly two board players');
  }
  const hiddenPhysicalSide = hiddenPhysicalSideFor(boardView.show);
  // The room plays on the play-mat table (geometry v2, ADR-027), split and
  // shown as the player's table settings ask. It fills the window, less a
  // docked activity log (ADR-030).
  return {
    geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
    viewport: currentViewport(),
    playerIds: [firstPlayerId, secondPlayerId],
    bottomPlayerId:
      view.viewer.kind === 'player' ? view.viewer.playerId : firstPlayerId,
    shellMode: sidePanel > 0 ? 'sidebar' : 'fullscreen',
    ...(sidePanel > 0 && sidePanel < 1 ? { sidePanelReveal: sidePanel } : {}),
    vertical: tableVerticalLayout(boardView.split),
    ...(hiddenPhysicalSide ? { hiddenPhysicalSide } : {}),
    ...(boardView.lostZone ? {} : { hideEmptyLostZone: true }),
    ...(seamBandPx ? { seamBandPx } : {}),
    ...(oncePerGameMarkerCount(boardView) > 0
      ? { oncePerGameMarkers: oncePerGameMarkerCount(boardView) }
      : {}),
    ...(boardView.opponentCardsUpright ? { farCardsUpright: true } : {}),
  };
};

/**
 * Which rail actions keep their place on a short rail (a phone): what the
 * table is waiting for, then the turn, the coin and undo; the
 * announcements and Flip go into More first.
 */
export const RAIL_PRIORITY = {
  lead: 0,
  turn: 1,
  coin: 2,
  undo: 3,
  attack: 4,
  pass: 5,
  switchSide: 6,
} as const;

/** The table actions the board itself owns, for a route to place. */
export interface BoardOwnRailActions {
  /** Start turn, for a live seat at the table. */
  readonly turn?: RailAction;
  /** Flip a coin; it waits on the room's answer. */
  readonly coin?: RailAction;
  /** Turn the table around: Solo, spectators, and coaching. */
  readonly switchSide?: RailAction;
  /** Announce a mulligan. */
  readonly mulligan?: ActionMenuEntry;
}

/** What a route puts on the table rail (ADR-030). */
export interface BoardRailModel {
  /** At the left end: the app menu. */
  readonly start?: ReactNode;
  /** At the right end: the activity log. */
  readonly end?: ReactNode;
  /** Whose seat the actions act for (the other one, turned around). */
  readonly seat?: 'you' | 'opponent';
  /** Orders the board's own actions among the route's. */
  readonly compose: (own: BoardOwnRailActions) => {
    readonly actions: readonly RailAction[];
    readonly more?: readonly ActionMenuEntry[];
  };
}

/** What a route's menu can ask of the table. */
export interface BoardCommands {
  /** Retry every card image that has not loaded. */
  readonly refreshImages: () => void;
  readonly flipBoard: () => void;
  /** Whether turning the table around is allowed here. */
  readonly canFlipBoard: () => boolean;
}

/** How long the Coin control may say it is waiting if no answer arrives. */
const COIN_PENDING_CEILING_MS = 4_000;

/**
 * v1 flipBoard runs in Solo, for spectators, and in a room where both
 * players enabled "board flip" (coaching mode); a flipped player then acts
 * for the seat at the bottom.
 */
const boardFlipAllowed = (
  roomMode: 'solo' | 'multiplayer',
  view: ReturnType<ReplaySessionCoordinator['getSnapshot']>['view']
): boolean => {
  if (roomMode === 'solo' || view?.viewer.kind === 'spectator') return true;
  if (!view || view.viewer.kind !== 'player') return false;
  return view.playerOrder.every(
    (playerId) => view.players[playerId]?.coachingConsent === true
  );
};

/**
 * True when the card is in the viewer's own hand, which is the only case v1
 * follows a reveal with its "press OK to stop revealing" modal.
 */
const revealedOwnHandCardId = (
  view: MatchViewState | undefined,
  cardId: string
): boolean => {
  if (!view || view.viewer.kind !== 'player') return false;
  const viewerPlayerId = view.viewer.playerId;
  const hand = Object.values(view.zones).find(
    (zone) => zone.kind === 'hand' && zone.ownerId === viewerPlayerId
  );
  return hand?.cards.some((card) => card.id === cardId) === true;
};

/** The seat the viewer would see at the bottom before any flip. */
const ownPlayerIdOf = (
  view: NonNullable<ReturnType<ReplaySessionCoordinator['getSnapshot']>['view']>
): string | undefined =>
  view.viewer.kind === 'player' ? view.viewer.playerId : view.playerOrder[0];

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
  preferences: basePreferences = ROOM_DEFAULT_PREFERENCES,
  roomMode = 'multiplayer',
  hideOpponentHand = false,
  onPerspectiveChange,
  coinFlip,
  rail,
  commandsRef,
  sidePanel = false,
  sidePanelSlide,
  keysSuspended = false,
  loadDeck,
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
  /**
   * Reports the table's perspective: whether it is flipped and which seat
   * now sits at the bottom and takes the sidebar's actions (v1's initiator).
   */
  readonly onPerspectiveChange?: (perspective: {
    readonly flipped: boolean;
    readonly actingPlayerId: string | undefined;
  }) => void;
  /** The presentation runtime's coin, tossed over the table. */
  readonly coinFlip?: PresentationStateSource<CoinFlipSnapshot>;
  /** The table rail's ends and the route's actions on it. */
  readonly rail?: BoardRailModel;
  /** Lets the route's menu reach the table. */
  readonly commandsRef?: Ref<BoardCommands>;
  /** The activity log is docked at the right; the table keeps clear of it. */
  readonly sidePanel?: boolean;
  /**
   * How far the docked log has slid in; while given, the table makes room
   * as it moves rather than at once.
   */
  readonly sidePanelSlide?: DockSlide;
  /** Something over the whole table (the deck screen) owns the keyboard. */
  readonly keysSuspended?: boolean;
  /** The seats whose empty deck shows a `+`, and what it opens. */
  readonly loadDeck?: TableZoneAffordancesProps['loadDeck'];
}) => {
  const replayState = useReplaySession(replay);
  const identity = viewIdentity(replayState.view);
  const hostRef = useRef<HTMLDivElement>(null);
  const boardViewStore = boardViewSettings();
  const boardView = useSyncExternalStore(
    boardViewStore.subscribe,
    boardViewStore.getSnapshot
  );
  const boardViewRef = useRef(boardView);
  boardViewRef.current = boardView;
  const markerCount = oncePerGameMarkerCount(boardView);
  const preferences = useBoardParallax(hostRef, basePreferences);
  const runtimeRef = useRef<BoardSessionRuntime | null>(null);
  // The hovered card, for the inspector; never part of game state.
  const hoverStore = useMemo(() => new CardHoverStore(), []);
  const [sortedHandPlayerIds, setSortedHandPlayerIds] = useState<
    ReadonlySet<PlayerId>
  >(() => new Set());
  const displayPolicyRef = useRef<{
    roomMode: 'solo' | 'multiplayer';
    hideOpponentHand: boolean;
    sortedHandPlayerIds: ReadonlySet<PlayerId>;
    /** The seat at the bottom of the board; its hand is never the hidden one. */
    actingPlayerId: string | undefined;
  }>({
    roomMode,
    hideOpponentHand,
    sortedHandPlayerIds,
    actingPlayerId: undefined,
  });
  const sidePanelReveal = (): number =>
    sidePanelSlide ? sidePanelSlide.value() : sidePanel ? 1 : 0;
  const sidePanelRef = useRef(sidePanelReveal);
  sidePanelRef.current = sidePanelReveal;
  // The seam opens to fit the rail's buttons: 40px, 44px under a finger.
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY);
  const seamBandPx = coarsePointer ? TOUCH_SEAM_BAND_PX : POINTER_SEAM_BAND_PX;
  const seamBandRef = useRef(seamBandPx);
  seamBandRef.current = seamBandPx;
  const preferencesRef = useRef(preferences);
  const onIntentRef = useRef(onIntent);
  const onSubmissionRef = useRef(onSubmission);
  const onPerspectiveChangeRef = useRef(onPerspectiveChange);
  displayPolicyRef.current = {
    ...displayPolicyRef.current,
    roomMode,
    hideOpponentHand,
    sortedHandPlayerIds,
  };
  preferencesRef.current = preferences;
  onIntentRef.current = onIntent;
  onSubmissionRef.current = onSubmission;
  onPerspectiveChangeRef.current = onPerspectiveChange;
  const [boardState, setBoardState] = useState<
    BoardSessionControllerState | undefined
  >();
  const [rendererStatus, setRendererStatus] = useState<BoardRendererStatus>({
    kind: 'mounting',
  });
  const [layout, setLayout] = useState<BoardLayoutSnapshot>();
  // Only the room rolls the coin, so the face cannot be predicted the way
  // every other command is. The control says it is waiting instead, which is
  // what the delay actually is.
  const [coinPending, setCoinPending] = useState(false);
  const coinPendingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Whether the last press on the table was a finger's: a tapped card then
  // gets the touch bar, since a finger has no right-click or double-click.
  const [touchInput, setTouchInput] = useState(false);
  // v1 reveal-and-hide.js: revealing a card from your own hand in a room
  // opens a modal that ends the reveal when it is acknowledged.
  const [revealNotice, setRevealNotice] = useState<ViewCardId | null>(null);
  useEffect(() => () => clearTimeout(coinPendingTimerRef.current), []);

  // Touch (ADR-030): tapping a card that is already selected reads it, the
  // way a double-click does with a mouse.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let tap:
      | {
          readonly pointerId: number;
          readonly cardId: string;
          readonly wasSelected: boolean;
          readonly x: number;
          readonly y: number;
        }
      | undefined;
    const cardIdAt = (target: EventTarget | null): string | undefined =>
      target instanceof Element
        ? (target.closest<HTMLElement>('[data-card-id]')?.dataset.cardId ??
          undefined)
        : undefined;
    const handleDown = (event: PointerEvent): void => {
      const touch = event.pointerType === 'touch';
      setTouchInput(touch);
      tap = undefined;
      if (!touch) return;
      const cardId = cardIdAt(event.target);
      if (!cardId) return;
      tap = {
        pointerId: event.pointerId,
        cardId,
        wasSelected:
          runtimeRef.current?.getBoardSnapshot()?.presentation
            .selectedCardId === cardId,
        x: event.clientX,
        y: event.clientY,
      };
    };
    const handleUp = (event: PointerEvent): void => {
      const pressed = tap;
      tap = undefined;
      if (
        !pressed ||
        !pressed.wasSelected ||
        pressed.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10 ||
        cardIdAt(event.target) !== pressed.cardId
      ) {
        return;
      }
      // After the renderer's own click has been handled.
      setTimeout(() => {
        runtimeRef.current?.emitIntent({
          kind: 'CardPreviewRequested',
          cardId: pressed.cardId as ViewCardId,
        });
      }, 0);
    };
    host.addEventListener('pointerdown', handleDown, { capture: true });
    host.addEventListener('pointerup', handleUp, { capture: true });
    return () => {
      host.removeEventListener('pointerdown', handleDown, { capture: true });
      host.removeEventListener('pointerup', handleUp, { capture: true });
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const view = replayState.view;
    if (!host) return;
    if (!view || !identity) {
      setBoardState(undefined);
      setLayout(undefined);
      setRendererStatus({ kind: 'mounting' });
      return;
    }
    let disposed = false;
    let runtime: BoardSessionRuntime | undefined;
    let unsubscribeBoard: (() => void) | undefined;
    let unsubscribeLayout: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let resolutionQuery: MediaQueryList | undefined;
    let resolutionMedia: string | undefined;

    setBoardState(undefined);
    setLayout(undefined);
    setRendererStatus({ kind: 'mounting' });

    let actualRendererKind = rendererKind;
    let publishedRevision: number | undefined;
    let publishedPerspective:
      | {
          readonly flipped: boolean;
          readonly actingPlayerId: string | undefined;
        }
      | undefined;
    const publish = (): void => {
      if (disposed || !runtime) return;
      const snapshot = runtime.getBoardSnapshot();
      // The room answers a coin with a new revision. Hover, selection and
      // predicted commands publish too, but none of them advance it.
      const revision = snapshot?.view?.revision;
      if (revision !== publishedRevision) {
        publishedRevision = revision;
        setCoinPending(false);
      }
      setBoardState(snapshot);
      const renderer = runtime.getRenderer();
      if (!snapshot?.scene || !renderer) {
        if (window.__PTCG_RENDERER_SPIKE__?.renderer === renderer) {
          delete window.__PTCG_RENDERER_SPIKE__;
        }
        return;
      }
      window.__PTCG_RENDERER_SPIKE__ = {
        rendererKind: actualRendererKind,
        renderer,
        scene: snapshot.scene,
      };
    };
    const synchronizeViewport = (): void => {
      if (disposed || !runtime) return;
      runtime.setViewport(currentViewport());
    };
    const publishLayout = (): void => {
      if (disposed || !runtime) return;
      setLayout(runtime.getCharacterizedLayoutSnapshot());
      // v1 recolours the sidebar buttons when the board is flipped; the
      // viewer's own seat is at the bottom unless they turned it around.
      const own = ownPlayerIdOf(view);
      const bottom = runtime.getLayoutState().bottomPlayerId;
      const flipped = own !== undefined && bottom !== own;
      const actingPlayerId = view.viewer.kind === 'player' ? bottom : undefined;
      displayPolicyRef.current = {
        ...displayPolicyRef.current,
        actingPlayerId,
      };
      // The layout changes on every frame of a sliding log; the perspective
      // only when the table turns. Telling the route each time re-rendered
      // all of it -- the hidden deck screen too -- frame after frame.
      if (
        publishedPerspective?.flipped === flipped &&
        publishedPerspective.actingPlayerId === actingPlayerId
      ) {
        return;
      }
      publishedPerspective = { flipped, actingPlayerId };
      onPerspectiveChangeRef.current?.(publishedPerspective);
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
        const loaded = await loadBoardRenderer(rendererKind);
        const { createRenderer } = loaded;
        actualRendererKind = loaded.kind;
        if (disposed) return;
        runtime = new BoardSessionRuntime({
          live: session,
          replay,
          layout: layoutFor(
            view,
            boardViewRef.current,
            sidePanelRef.current(),
            seamBandRef.current
          ),
          createRenderer,
          preferences: preferencesRef.current,
          transformView: (sourceView, source) => {
            const policy = displayPolicyRef.current;
            const covered =
              source.kind === 'live' && policy.roomMode === 'solo'
                ? applySoloOpponentHandVisibility(
                    sourceView,
                    policy.hideOpponentHand,
                    policy.actingPlayerId
                  )
                : sourceView;
            return applyHandSortDisplay(covered, policy.sortedHandPlayerIds);
          },
          onIntent: (intent) => onIntentRef.current(intent),
          // Solo's player moves cards out of either seat's window.
          resolveDrop: (dropView, scene, intent) =>
            resolveBoardDrop(dropView, scene, intent, {
              eitherSeatsWindows: displayPolicyRef.current.roomMode === 'solo',
            }),
          onSubmission: (command, result) => {
            onSubmissionRef.current?.(command, result);
            if (
              result.queued &&
              command.type === 'SetPublicReveal' &&
              command.revealed &&
              displayPolicyRef.current.roomMode === 'multiplayer' &&
              revealedOwnHandCardId(
                runtimeRef.current?.getBoardSnapshot()?.view,
                command.cardId
              )
            ) {
              setRevealNotice(command.cardId as ViewCardId);
            }
          },
          // The card has already gone back; say why.
          onCommandRefused: (completed) => {
            if (!disposed) toast(refusalNotice(completed.code));
          },
          reportError: (error) => console.error('[board-session]', error),
          reportRendererStatus: (status) => {
            if (!disposed) setRendererStatus(status);
          },
          onCardHover: hoverStore.set,
        });
        runtimeRef.current = runtime;
        await runtime.mount(host);
        if (disposed) {
          runtime.dispose();
          return;
        }
        unsubscribeBoard = runtime.subscribeBoard(publish);
        unsubscribeLayout = runtime.subscribeLayout(publishLayout);
        publish();
        publishLayout();
        observeCurrentResolution();
        resizeObserver = new ResizeObserver(scheduleViewportSynchronization);
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleViewportSynchronization);
        document.addEventListener('visibilitychange', handleVisibilityChange);
      } catch (error) {
        unsubscribeBoard?.();
        unsubscribeLayout?.();
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
      unsubscribeLayout?.();
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

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.synchronizeSources();
  }, [hideOpponentHand, roomMode, sortedHandPlayerIds]);

  useEffect(() => {
    const apply = (immediate: boolean): void => {
      const reveal = sidePanelRef.current();
      runtimeRef.current?.setShellMode(
        reveal > 0 ? 'sidebar' : 'fullscreen',
        reveal,
        { immediate }
      );
    };
    apply(false);
    // Each frame of the slide paints the table in that frame, beside the
    // log as it is drawn there. A jump (instant motion) can come from a
    // React effect, where a synchronous paint is refused, so it waits.
    return sidePanelSlide?.subscribe((inFrame) => apply(inFrame));
  }, [sidePanel, sidePanelSlide]);

  useEffect(() => {
    const hiddenPhysicalSide = hiddenPhysicalSideFor(boardView.show);
    runtimeRef.current?.setTableView({
      lowerShare: boardView.split,
      ...(hiddenPhysicalSide ? { hiddenPhysicalSide } : {}),
      hideEmptyLostZone: !boardView.lostZone,
      ...(seamBandPx ? { seamBandPx } : {}),
      oncePerGameMarkers: markerCount,
      farCardsUpright: boardView.opponentCardsUpright,
    });
  }, [
    boardView.split,
    boardView.show,
    boardView.lostZone,
    boardView.opponentCardsUpright,
    markerCount,
    seamBandPx,
  ]);

  const overlayActions = useMemo<LegacyBoardOverlayActions>(
    () => ({
      emitOpenedZoneCardIntent: (intent) => {
        runtimeRef.current?.emitOpenedZoneCardIntent(intent);
      },
      updateDrag: (drag) => {
        runtimeRef.current?.emitOverlayDrag(drag);
      },
      emitCardIntent: (intent) => {
        runtimeRef.current?.emitIntent(intent);
      },
      invokeWorkAreaAction: (source, action, targetPlayerId) => {
        runtimeRef.current?.emitLegacyOverlayAction({
          kind: 'workArea',
          ...(targetPlayerId ? { targetPlayerId } : {}),
          source,
          action,
        });
      },
      beginCardAssembly: (cardId) => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        const opened = runtime.getBoardSnapshot()?.presentation.openedZoneId;
        if (opened)
          runtime.emitOpenedZoneCardIntent({ kind: 'CardSelected', cardId });
        else runtime.emitIntent({ kind: 'CardSelected', cardId });
        runtime.emitLegacyShortcutAction({
          action: 'beginAttachOrEvolve',
          cardId,
        });
      },
      separateCard: (cardId) => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.emitIntent({ kind: 'CardSelected', cardId });
        if (
          runtime.emitLegacyShortcutAction({
            action: 'moveCardToZone',
            destination: 'hand',
            cardId,
          })
        )
          runtime.dismissLocalPresentation('all');
      },
      previewCard: (cardId) => {
        runtimeRef.current?.emitIntent({
          kind: 'CardPreviewRequested',
          cardId,
          single: true,
        });
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
  // Card art retries by itself when it fails (the renderer's own retry);
  // this asks every failed image to try again now.
  const refreshImages = useCallback((): void => {
    document.dispatchEvent(new Event(CARD_IMAGE_RETRY_EVENT));
  }, []);
  const keyboardActions = useMemo(
    () => ({
      onRequest: (request: LegacyBoardShortcutActionRequest): void => {
        runtimeRef.current?.emitLegacyShortcutAction(request);
      },
      onLocalIntent: (intent: BoardIntent): void => {
        runtimeRef.current?.emitBoardIntent(intent);
      },
      onRefreshScene: (): void => {
        refreshImages();
      },
      onFlipBoard: (): void => {
        runtimeRef.current?.flipBoard();
      },
      onDismissPresentation: (): void => {
        runtimeRef.current?.dismissLocalPresentation();
      },
      // v1 declares for `systemState.initiator`: the seat at the bottom.
      onDeclareMulligan: (): void => {
        runtimeRef.current?.declareMulligan(
          displayPolicyRef.current.actingPlayerId
        );
      },
      onDeclareDeckView: (): void => {
        runtimeRef.current?.declareDeckView(
          displayPolicyRef.current.actingPlayerId
        );
      },
    }),
    [refreshImages]
  );
  const chromeActions = useMemo(
    () => ({
      toggleHandSort: (playerId: PlayerId, sorted: boolean): void => {
        setSortedHandPlayerIds((current) => {
          if (current.has(playerId) === sorted) return current;
          const next = new Set(current);
          if (sorted) next.add(playerId);
          else next.delete(playerId);
          return next;
        });
      },
      toggleOncePerGame: (
        playerId: Parameters<BoardSessionRuntime['emitOncePerGameAction']>[0],
        marker: 'gx' | 'vstar'
      ): void => {
        runtimeRef.current?.emitOncePerGameAction(playerId, {
          type: 'toggle',
          marker,
        });
      },
    }),
    []
  );
  const tableActions = useMemo(
    () => ({
      takeTurn: (): void => {
        runtimeRef.current?.emitLegacyShortcutAction({
          action: 'startOwnTurn',
        });
      },
      flipCoin: (): void => {
        const submitted = runtimeRef.current?.emitLegacyShortcutAction({
          action: 'flipCoin',
        });
        if (submitted === false) return;
        setCoinPending(true);
        clearTimeout(coinPendingTimerRef.current);
        // The publication that carries the result clears this; the ceiling is
        // only here so a rejected or lost command cannot leave it spinning.
        coinPendingTimerRef.current = setTimeout(
          () => setCoinPending(false),
          COIN_PENDING_CEILING_MS
        );
      },
      flipBoard: (): void => {
        runtimeRef.current?.flipBoard();
      },
    }),
    []
  );
  const flipAllowedRef = useRef(false);
  useImperativeHandle(
    commandsRef,
    (): BoardCommands => ({
      refreshImages,
      flipBoard: tableActions.flipBoard,
      canFlipBoard: () => flipAllowedRef.current,
    }),
    [refreshImages, tableActions]
  );
  const visibleStatus =
    identity && replayState.sessionPhase === 'ready'
      ? rendererStatus.kind
      : replayState.sessionPhase;
  const depthProjection = useMemo(
    () =>
      boardState?.scene &&
      preferences.depth?.mode &&
      preferences.depth.mode !== 'flat'
        ? new BoardDepthProjection(boardState.scene, preferences)
        : undefined,
    [boardState?.scene, preferences]
  );
  const showBoardComposition =
    boardState?.scene !== undefined &&
    rendererStatus.kind !== 'failed' &&
    rendererStatus.kind !== 'destroyed';
  const coveredByPopup =
    boardState !== undefined &&
    (boardState.presentation.openedZoneId !== null ||
      (boardState.scene?.zones.some(
        (zone) =>
          (zone.kind === 'inspection' ||
            zone.kind === 'attachmentResolution') &&
          zone.count > 0
      ) ??
        false));
  const lostZoneControl = useMemo(
    () => ({
      shown: boardView.lostZone,
      onShownChange: (lostZone: boolean) => boardViewStore.update({ lostZone }),
    }),
    [boardView.lostZone, boardViewStore]
  );
  // The once-per-game markers, off by default and kept on this device.
  const markerControl = useMemo(
    () => ({
      vstar: boardView.vstarMarker,
      gx: boardView.gxMarker,
      onShownChange: (marker: 'vstar' | 'gx', shown: boolean) =>
        boardViewStore.update(
          marker === 'vstar' ? { vstarMarker: shown } : { gxMarker: shown }
        ),
      onToggle: chromeActions.toggleOncePerGame,
    }),
    [boardView.vstarMarker, boardView.gxMarker, boardViewStore, chromeActions]
  );
  const shownMarkers = useMemo(
    () =>
      (['vstar', 'gx'] as const).filter((marker) =>
        marker === 'vstar' ? boardView.vstarMarker : boardView.gxMarker
      ),
    [boardView.vstarMarker, boardView.gxMarker]
  );
  const playerActions =
    boardState?.source?.kind === 'live' &&
    boardState.canSubmitCommands &&
    boardState.view?.viewer.kind === 'player';
  const flipAllowed = boardFlipAllowed(roomMode, boardState?.view);
  flipAllowedRef.current = flipAllowed;
  const hint = useHotkeyHints();
  const chromeRail = useMemo((): LegacyBoardChromeRail | undefined => {
    if (!rail) return undefined;
    const own: BoardOwnRailActions = {
      ...(playerActions
        ? {
            turn: {
              id: 'turnButton',
              label: 'Turn',
              title: 'Start turn',
              icon: PlayIcon,
              priority: RAIL_PRIORITY.turn,
              hint: hint('table.startTurn'),
              onSelect: tableActions.takeTurn,
            },
            coin: {
              id: 'flipCoinButton',
              label: 'Coin',
              title: 'Flip a coin',
              icon: CoinIcon,
              priority: RAIL_PRIORITY.coin,
              pending: coinPending,
              hint: hint('table.flipCoin'),
              onSelect: tableActions.flipCoin,
            },
            mulligan: {
              id: 'mulliganButton',
              label: 'Announce mulligan',
              icon: ShuffleIcon,
              hint: hint('table.mulligan'),
              onSelect: () => {
                runtimeRef.current?.declareMulligan(
                  displayPolicyRef.current.actingPlayerId
                );
              },
            },
          }
        : {}),
      ...(flipAllowed
        ? {
            switchSide: {
              id: 'flipBoardButton',
              label: 'Flip',
              title: 'Flip the table',
              icon: ArrowsDownUpIcon,
              priority: RAIL_PRIORITY.switchSide,
              hint: hint('table.flipBoard'),
              onSelect: tableActions.flipBoard,
            },
          }
        : {}),
    };
    const composed = rail.compose(own);
    return {
      ...(rail.start ? { start: rail.start } : {}),
      ...(rail.end ? { end: rail.end } : {}),
      ...(rail.seat ? { seat: rail.seat } : {}),
      actions: composed.actions,
      ...(composed.more ? { more: composed.more } : {}),
    };
  }, [rail, playerActions, flipAllowed, coinPending, hint, tableActions]);

  // Each hand's count, where the table shows it: the chrome draws it as a
  // pill with that hand's Sort.
  const handCounts = useMemo(() => {
    const scene = boardState?.scene;
    if (!scene) return undefined;
    return scene.counts.flatMap((node) => {
      if (node.kind !== 'hand') return [];
      const playerId = scene.zones.find(
        (zone) => zone.id === node.zoneId
      )?.playerId;
      return playerId ? [{ node, playerId }] : [];
    });
  }, [boardState?.scene]);

  return (
    <div className="board-spike-host" data-geometry={layout?.geometryVersion}>
      <div className="renderer-surface-host" ref={hostRef} />
      {showBoardComposition && boardState?.scene ? (
        <>
          {layout ? (
            <LegacyBoardChrome
              {...(depthProjection ? { depth: depthProjection } : {})}
              layout={layout}
              localPlayerId={
                boardState.view?.viewer.kind === 'player'
                  ? boardState.view.viewer.playerId
                  : boardState.scene.bottomPlayerId
              }
              players={boardState.view?.players ?? {}}
              darkMode={preferences.darkMode}
              actions={chromeActions}
              {...(chromeRail ? { rail: chromeRail } : {})}
              sortedHandPlayerIds={sortedHandPlayerIds}
              coveredByPopup={coveredByPopup}
              oncePerGameMarkers={shownMarkers}
              handCounts={handCounts}
            />
          ) : null}
          {layout ? (
            <TableZoneAffordances
              layout={layout}
              scene={boardState.scene}
              view={boardState.view}
              {...(depthProjection ? { depth: depthProjection } : {})}
              {...(loadDeck && boardState.source?.kind === 'live'
                ? { loadDeck }
                : {})}
              lostZone={lostZoneControl}
              markers={markerControl}
              covered={coveredByPopup}
            />
          ) : null}
          {layout ? (
            <CoinFlipOverlay
              {...(coinFlip ? { source: coinFlip } : {})}
              layout={layout}
              pending={coinPending}
              pendingPlayerId={
                displayPolicyRef.current.actingPlayerId ??
                (boardState.view?.viewer.kind === 'player'
                  ? boardState.view.viewer.playerId
                  : undefined)
              }
              // At "instant" the coin shows its result without a toss.
              reducedMotion={
                preferences.reducedMotion || preferences.animationSpeed === 0
              }
            />
          ) : null}
          {layout &&
          touchInput &&
          boardState.presentation.selectedCardId !== null &&
          boardState.presentation.drag === null &&
          boardState.presentation.openedZoneId === null &&
          boardState.overlays.contextMenuCardId === null &&
          boardState.overlays.preview === null &&
          boardState.overlays.input === null ? (
            <TouchCardBar
              scene={boardState.scene}
              cardId={boardState.presentation.selectedCardId}
              {...(depthProjection ? { depth: depthProjection } : {})}
              viewport={layout.viewport}
              onRead={() => {
                const cardId =
                  runtimeRef.current?.getBoardSnapshot()?.presentation
                    .selectedCardId;
                if (cardId) {
                  runtimeRef.current?.emitIntent({
                    kind: 'CardPreviewRequested',
                    cardId,
                  });
                }
              }}
              onActions={() => {
                const cardId =
                  runtimeRef.current?.getBoardSnapshot()?.presentation
                    .selectedCardId;
                if (cardId) {
                  runtimeRef.current?.emitIntent({
                    kind: 'CardContextRequested',
                    cardId,
                  });
                }
              }}
              onDismiss={() =>
                runtimeRef.current?.dismissLocalPresentation('selection')
              }
            />
          ) : null}
          <LegacyBoardOverlays
            {...(depthProjection ? { depth: depthProjection } : {})}
            allowOpponentResolution={roomMode === 'solo'}
            state={boardState}
            darkMode={preferences.darkMode}
            actions={overlayActions}
          />
          <TurnBanner
            view={boardState.view}
            bottomPlayerId={boardState.scene.bottomPlayerId}
          />
          {boardView.hoverPreview ? (
            <CardInspector
              store={hoverStore}
              view={boardState.view}
              scene={boardState.scene}
              reducedMotion={preferences.reducedMotion}
              suppressed={
                boardState.presentation.openedZoneId !== null ||
                boardState.overlays.preview !== null
              }
            />
          ) : null}
          <LegacyBoardKeyboardShortcuts
            state={boardState}
            {...(roomMode === 'solo'
              ? { undoSeat: 'acting' as const }
              : roomMode === 'multiplayer'
                ? { undoSeat: 'own' as const }
                : {})}
            boardFlipEnabled={flipAllowed}
            suspended={keysSuspended}
            {...keyboardActions}
          />
        </>
      ) : null}
      {revealNotice !== null && (
        <div className="custom-popup" data-legacy-popup="reveal">
          <div className="popup-content">
            Press OK to stop revealing card to opponent
            <button
              type="button"
              className="popup-button"
              autoFocus
              onClick={() => {
                const view = runtimeRef.current?.getBoardSnapshot()?.view;
                const resolution = view
                  ? resolvePublicCardVisibilityAction(view, revealNotice, false)
                  : { ok: false as const };
                if (resolution.ok) session.submit(resolution.command);
                setRevealNotice(null);
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
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
