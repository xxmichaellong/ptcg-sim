import { loadBoardRenderer } from './load-board-renderer.js';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardScene,
  createBoardLayoutSnapshot,
  createLayoutSnapshotFor,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  tableVerticalLayout,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  DEFAULT_BOARD_PRESENTATION,
  LEGACY_BOARD_SHELL_V1,
  type BoardIntent,
  type BoardLayoutSnapshot,
  type BoardPreferences,
  type BoardPresentation,
  type BoardPresentationUpdate,
  type BoardRenderer,
  type BoardRendererStatus,
  type BoardViewport,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { submitBoardDrop } from './board/resolveBoardDrop.js';
import type { BoardRendererFactory } from './renderer-spike-handle.js';

/** The play-mat table (geometry v2) filling the window, split as given. */
export interface SpikeTableLayout {
  readonly lowerShare: number;
  /** The least height of the clear band at the centre line. */
  readonly seamBandPx?: number;
  /** The app bar's corner, kept clear (ADR-036). */
  readonly appBarPx?: { readonly width: number; readonly height: number };
  /** The optional Lost Zone is off: an empty one is not on the table. */
  readonly hideEmptyLostZone?: boolean;
  /** How many once-per-game markers lie beside each player's prizes. */
  readonly oncePerGameMarkers?: number;
}

const sceneForHost = (
  host: HTMLElement,
  view: MatchViewState,
  table?: SpikeTableLayout
) => {
  const outerViewport = {
    width: Math.max(
      1,
      window.innerWidth ||
        host.clientWidth / LEGACY_BOARD_SHELL_V1.playAreaWidthRatio ||
        1600
    ),
    height: Math.max(1, window.innerHeight || host.clientHeight || 900),
    devicePixelRatio: Math.max(1, window.devicePixelRatio),
  };
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  if (!firstPlayerId || !secondPlayerId || view.playerOrder.length !== 2) {
    throw new Error('Projected match must have exactly two board players');
  }
  const bottomPlayerId =
    view.viewer.kind === 'player' ? view.viewer.playerId : firstPlayerId;
  const layout = table
    ? createLayoutSnapshotFor({
        geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
        viewport: {
          ...outerViewport,
          width: Math.max(1, window.innerWidth || host.clientWidth || 1600),
        },
        playerIds: [firstPlayerId, secondPlayerId],
        bottomPlayerId,
        shellMode: 'fullscreen',
        vertical: tableVerticalLayout(table.lowerShare),
        ...(table.seamBandPx ? { seamBandPx: table.seamBandPx } : {}),
        ...(table.appBarPx ? { appBarPx: table.appBarPx } : {}),
        ...(table.hideEmptyLostZone ? { hideEmptyLostZone: true } : {}),
        ...(table.oncePerGameMarkers
          ? { oncePerGameMarkers: table.oncePerGameMarkers }
          : {}),
      })
    : createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: outerViewport,
        playerIds: [firstPlayerId, secondPlayerId],
        bottomPlayerId,
        shellMode: 'sidebar',
        vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
      });
  const scene = createBoardScene(view, layout);
  return {
    viewport: scene.viewport,
    scene,
    layout,
  };
};

const sameOuterViewport = (
  left: BoardViewport,
  right: BoardViewport
): boolean =>
  left.width === right.width &&
  left.height === right.height &&
  left.devicePixelRatio === right.devicePixelRatio;

export const RendererSpikeBoard = ({
  view,
  onIntent,
  submitCommand,
  allowRevisionRegression = false,
  sessionReady = true,
  preferences,
  table,
  chrome,
  onSettledChange,
}: {
  readonly view: MatchViewState;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly submitCommand: (command: WireGameCommand) => unknown;
  /** Replay-only escape hatch; live callers retain monotonic stale protection. */
  readonly allowRevisionRegression?: boolean;
  /** Cancels presentation state retained across a live transport interruption. */
  readonly sessionReady?: boolean;
  /** Optional route-owned local preferences; omitted callers retain defaults. */
  readonly preferences?: BoardPreferences;
  /** Lay out the play-mat table rather than v1's board beside a sidebar. */
  readonly table?: SpikeTableLayout;
  /** Paint over the board, placed by its layout (the table rail). */
  readonly chrome?: (layout: BoardLayoutSnapshot) => ReactNode;
  /**
   * Whether the board is ready to be seen: painted with its chrome, or
   * failed. False again whenever it starts over or leaves the page.
   */
  readonly onSettledChange?: (settled: boolean) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rendererFactoryRef = useRef<BoardRendererFactory | null>(null);
  const viewRef = useRef(view);
  const tableRef = useRef(table);
  tableRef.current = table;
  const [layout, setLayout] = useState<BoardLayoutSnapshot>();
  const onIntentRef = useRef(onIntent);
  const submitCommandRef = useRef(submitCommand);
  const allowRevisionRegressionRef = useRef(allowRevisionRegression);
  const preferencesRef = useRef(preferences ?? DEFAULT_BOARD_PREFERENCES);
  const hasExplicitPreferencesRef = useRef(preferences !== undefined);
  const presentationRef = useRef(DEFAULT_BOARD_PRESENTATION);
  const installedRef = useRef<{
    readonly view: MatchViewState;
    readonly scene: ReturnType<typeof createBoardScene>;
  } | null>(null);
  viewRef.current = view;
  onIntentRef.current = onIntent;
  submitCommandRef.current = submitCommand;
  allowRevisionRegressionRef.current = allowRevisionRegression;
  preferencesRef.current = preferences ?? DEFAULT_BOARD_PREFERENCES;
  hasExplicitPreferencesRef.current = preferences !== undefined;
  const [status, setStatus] = useState<BoardRendererStatus>({
    kind: 'mounting',
  });
  const [presentation, setPresentation] = useState<BoardPresentation>(
    DEFAULT_BOARD_PRESENTATION
  );
  presentationRef.current = presentation;
  const onSettledChangeRef = useRef(onSettledChange);
  onSettledChangeRef.current = onSettledChange;
  const settled =
    status.kind === 'failed' ||
    (status.kind === 'ready' && (chrome === undefined || layout !== undefined));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: BoardRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let resolutionQuery: MediaQueryList | null = null;
    let resolutionMedia: string | null = null;
    let installSize: (() => void) | null = null;
    const scheduleInstallSize = () => {
      if (disposed || resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        installSize?.();
      });
    };
    const handleResolutionChange = () => scheduleInstallSize();
    const observeCurrentResolution = () => {
      const media = `(resolution: ${Math.max(1, window.devicePixelRatio)}dppx)`;
      if (resolutionMedia === media) return;
      resolutionQuery?.removeEventListener('change', handleResolutionChange);
      resolutionQuery = window.matchMedia(media);
      resolutionMedia = media;
      resolutionQuery.addEventListener('change', handleResolutionChange);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleInstallSize();
    };
    setStatus({ kind: 'mounting' });
    const mount = async () => {
      const initial = sceneForHost(host, viewRef.current, tableRef.current);
      installedRef.current = { view: viewRef.current, scene: initial.scene };
      const adapters = {
        emitIntent: (intent: BoardIntent) => {
          onIntentRef.current(intent);
          if (intent.kind === 'CardDropRequested') {
            const installed = installedRef.current;
            if (installed) {
              submitBoardDrop(
                installed.view,
                installed.scene,
                intent,
                submitCommandRef.current
              );
            }
          }
          if (intent.kind === 'CardSelected') {
            setPresentation((current) => ({
              ...current,
              selectedCardId: intent.cardId,
            }));
          }
        },
        emitPresentationUpdate: (update: BoardPresentationUpdate) => {
          if (update.kind === 'DragChanged') {
            setPresentation((current) => ({
              ...current,
              drag: update.drag,
            }));
          }
        },
        reportError: (error: unknown) =>
          console.error('[renderer-spike]', error),
        reportStatus: (next: BoardRendererStatus) => {
          if (!disposed) setStatus(next);
        },
      };
      const createRenderer = await loadBoardRenderer();
      if (disposed) return;
      rendererFactoryRef.current = createRenderer;
      renderer = createRenderer(adapters);
      try {
        // The first paint already wears the route's preferences (the tilt).
        if (hasExplicitPreferencesRef.current) {
          renderer.setPreferences(preferencesRef.current);
        }
        await renderer.mount(host, initial.scene, presentationRef.current);
        if (disposed) return;
        if (hasExplicitPreferencesRef.current) {
          renderer.setPreferences(preferencesRef.current);
        }
        rendererRef.current = renderer;
        installSize = () => {
          if (!renderer || disposed) return;
          const latestView = viewRef.current;
          const next = sceneForHost(host, latestView, tableRef.current);
          setLayout(next.layout);
          const installed = installedRef.current;
          if (
            !installed ||
            installed.view !== latestView ||
            !sameOuterViewport(
              installed.scene.layout.outerViewport,
              next.scene.layout.outerViewport
            )
          ) {
            const mode =
              allowRevisionRegressionRef.current &&
              installed &&
              next.scene.revision < installed.scene.revision
                ? 'replace'
                : 'advance';
            renderer.resize(next.viewport);
            renderer.installScene(next.scene, [], mode);
            installedRef.current = { view: latestView, scene: next.scene };
          }
          const published = installedRef.current;
          if (!published) return;
          window.__PTCG_RENDERER_SPIKE__ = {
            renderer,
            scene: published.scene,
            ...(import.meta.env.DEV ? { createRenderer } : {}),
          };
          observeCurrentResolution();
        };
        installSize();
        resizeObserver = new ResizeObserver(scheduleInstallSize);
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleInstallSize);
        document.addEventListener('visibilitychange', handleVisibilityChange);
      } catch (error) {
        if (!disposed) console.error('[renderer-spike] mount failed', error);
      }
    };
    void mount();
    return () => {
      disposed = true;
      onSettledChangeRef.current?.(false);
      resizeObserver?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', scheduleInstallSize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resolutionQuery?.removeEventListener('change', handleResolutionChange);
      resolutionQuery = null;
      resolutionMedia = null;
      installSize = null;
      renderer?.destroy();
      if (window.__PTCG_RENDERER_SPIKE__?.renderer === renderer) {
        delete window.__PTCG_RENDERER_SPIKE__;
      }
      if (rendererRef.current === renderer) rendererRef.current = null;
      rendererFactoryRef.current = null;
      installedRef.current = null;
    };
  }, []);

  useEffect(() => {
    onSettledChangeRef.current?.(settled);
  }, [settled]);

  useEffect(() => {
    rendererRef.current?.setPreferences(
      preferences ?? DEFAULT_BOARD_PREFERENCES
    );
  }, [preferences]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const createRenderer = rendererFactoryRef.current;
    const host = hostRef.current;
    if (!renderer || !createRenderer || !host) return;
    const next = sceneForHost(host, view, table);
    setLayout(next.layout);
    const installed = installedRef.current;
    const mode =
      allowRevisionRegression &&
      installed &&
      next.scene.revision < installed.scene.revision
        ? 'replace'
        : 'advance';
    renderer.installScene(next.scene, [], mode);
    installedRef.current = { view, scene: next.scene };
    window.__PTCG_RENDERER_SPIKE__ = {
      renderer,
      scene: next.scene,
      ...(import.meta.env.DEV ? { createRenderer } : {}),
    };
  }, [
    allowRevisionRegression,
    view,
    table?.lowerShare,
    table?.seamBandPx,
    table?.appBarPx?.width,
    table?.appBarPx?.height,
    table?.hideEmptyLostZone,
    table?.oncePerGameMarkers,
  ]);

  useEffect(() => {
    rendererRef.current?.installPresentation(presentation);
  }, [presentation]);

  useEffect(() => {
    if (sessionReady) return;
    rendererRef.current?.cancelInteraction();
    setPresentation((current) =>
      current.selectedCardId === null &&
      current.hoveredCardId === null &&
      current.drag === null &&
      current.openedZoneId === null
        ? current
        : DEFAULT_BOARD_PRESENTATION
    );
  }, [sessionReady]);

  return (
    // Laid out in the world, as the room's table is: left to right in
    // Arabic too, the app bar on it the same way round (ADR-034, ADR-036).
    <div className="board-spike-host" dir="ltr">
      <div className="renderer-surface-host" ref={hostRef} />
      {chrome && layout ? chrome(layout) : null}
      <span
        className="renderer-status"
        role="status"
        data-renderer-status={status.kind}
        data-renderer-generation={
          status.kind === 'ready' ? status.generation : undefined
        }
      >
        {status.kind}
      </span>
    </div>
  );
};
