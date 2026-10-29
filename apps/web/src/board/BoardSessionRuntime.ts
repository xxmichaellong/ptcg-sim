import { i18n } from '@lingui/core';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createLayoutSnapshotFor,
  createBoardScene,
  DEFAULT_BOARD_PRESENTATION,
  flipBoardLayoutState,
  resizeLayoutStateFor,
  tableVerticalLayout,
  type BoardCardHover,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type BoardIntent,
  type BoardPhysicalSide,
  type BoardPreferences,
  type BoardPresentation,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardRendererStatus,
  type BoardResizeHandleId,
  type BoardScene,
  type BoardShellMode,
  type BoardViewport,
} from '@ptcgsim/renderer-contract';

import { resolveSceneCardBacks } from '../card-backs/card-back-image.js';
import { CARD_BACK_VIEW_PREFERENCES } from '../card-backs/card-back-preferences.js';
import {
  CARD_IMAGE_PREFERENCES,
  localizeSceneCardImages,
} from '../i18n/card-image-language.js';
import { LANGUAGE_PREFERENCES } from '../i18n/language-preference.js';
import { preferences } from '../preferences/preference-store.js';
import {
  BoardSessionAdapter,
  type BoardSessionAdapterOptions,
  type BoardSessionLiveSource,
  type BoardSessionRendererEffect,
  type BoardSessionReplaySource,
} from './BoardSessionAdapter.js';
import type {
  BoardActionOrigin,
  BoardPresentationDismissScope,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from './BoardSessionController.js';
import type { LegacyBoardOverlayActionRequest } from './resolveLegacyBoardOverlayAction.js';
import type { LegacyBoardShortcutActionRequest } from './resolveLegacyBoardShortcutAction.js';
import type { OncePerGameAction } from './resolveOncePerGameAction.js';

export interface BoardSessionRuntimeOptions {
  readonly live: BoardSessionLiveSource;
  readonly replay: BoardSessionReplaySource;
  readonly layout: BoardLayoutState;
  readonly createRenderer: (adapters: BoardRendererAdapters) => BoardRenderer;
  readonly transformView?: BoardSessionAdapterOptions['transformView'];
  readonly preferences?: BoardPreferences;
  /** Optional route observer; controller policy remains authoritative. */
  readonly onIntent?: (intent: BoardIntent) => void;
  readonly onBoardEffect?: (effect: BoardSessionRendererEffect) => void;
  readonly onSubmission?: BoardSessionAdapterOptions['onSubmission'];
  readonly onCommandRefused?: BoardSessionAdapterOptions['onCommandRefused'];
  readonly resolveDrop?: BoardSessionAdapterOptions['resolveDrop'];
  readonly readsEveryHand?: BoardSessionAdapterOptions['readsEveryHand'];
  readonly reportError?: (error: unknown) => void;
  readonly reportRendererStatus?: (status: BoardRendererStatus) => void;
  /** The hovered card, for a route-owned inspector. Presentational only. */
  readonly onCardHover?: (hover: BoardCardHover | null) => void;
  /** Whether the table is moving on its own, each time that changes. */
  readonly onMotion?: (moving: boolean) => void;
}

const copyLayoutState = (state: BoardLayoutState): BoardLayoutState => ({
  ...state,
  viewport: { ...state.viewport },
  playerIds: [...state.playerIds],
  ...(state.zoneScrollPx ? { zoneScrollPx: { ...state.zoneScrollPx } } : {}),
  vertical: {
    lowerFrame: { ...state.vertical.lowerFrame },
    upperFrame: { ...state.vertical.upperFrame },
    lowerHandle: { ...state.vertical.lowerHandle },
    upperHandle: { ...state.vertical.upperHandle },
    sharedPlacement: state.vertical.sharedPlacement,
  },
});

/**
 * The layout as the view finds it: whether some player's Lost Zone holds
 * cards, which lays an optional Lost Zone beside the prizes rather than at
 * the end of the piles' column (`lostZoneInUse`).
 */
const withLostZoneUse = (
  layout: BoardLayoutState,
  view: MatchViewState | undefined
): BoardLayoutState => {
  const inUse =
    view !== undefined &&
    Object.values(view.zones).some(
      (zone) => zone.kind === 'lostZone' && zone.cards.length > 0
    );
  if ((layout.lostZoneInUse ?? false) === inUse) return layout;
  const { lostZoneInUse: _previous, ...rest } = layout;
  return inUse ? { ...rest, lostZoneInUse: true } : rest;
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

const retainLayoutState = (state: BoardLayoutState): BoardLayoutState =>
  deepFreeze(copyLayoutState(state));

const retainLayoutSnapshot = (state: BoardLayoutState): BoardLayoutSnapshot =>
  deepFreeze(createLayoutSnapshotFor(state));

const sameLayoutState = (
  left: BoardLayoutState,
  right: BoardLayoutState
): boolean =>
  left.geometryVersion === right.geometryVersion &&
  left.viewport.width === right.viewport.width &&
  left.viewport.height === right.viewport.height &&
  left.viewport.devicePixelRatio === right.viewport.devicePixelRatio &&
  left.shellMode === right.shellMode &&
  left.bottomPlayerId === right.bottomPlayerId &&
  left.playerIds[0] === right.playerIds[0] &&
  left.playerIds[1] === right.playerIds[1] &&
  left.vertical.lowerFrame.bottomRatio ===
    right.vertical.lowerFrame.bottomRatio &&
  left.vertical.lowerFrame.heightRatio ===
    right.vertical.lowerFrame.heightRatio &&
  left.vertical.upperFrame.bottomRatio ===
    right.vertical.upperFrame.bottomRatio &&
  left.vertical.upperFrame.heightRatio ===
    right.vertical.upperFrame.heightRatio &&
  left.vertical.lowerHandle.bottomRatio ===
    right.vertical.lowerHandle.bottomRatio &&
  left.vertical.lowerHandle.heightRatio ===
    right.vertical.lowerHandle.heightRatio &&
  left.vertical.upperHandle.bottomRatio ===
    right.vertical.upperHandle.bottomRatio &&
  left.vertical.upperHandle.heightRatio ===
    right.vertical.upperHandle.heightRatio &&
  left.vertical.sharedPlacement === right.vertical.sharedPlacement &&
  left.hiddenPhysicalSide === right.hiddenPhysicalSide &&
  (left.hideEmptyLostZone ?? false) === (right.hideEmptyLostZone ?? false) &&
  (left.lostZoneInUse ?? false) === (right.lostZoneInUse ?? false) &&
  (left.hideLostZone ?? false) === (right.hideLostZone ?? false) &&
  (left.seamBandPx ?? 0) === (right.seamBandPx ?? 0) &&
  (left.appBarPx?.width ?? 0) === (right.appBarPx?.width ?? 0) &&
  (left.appBarPx?.height ?? 0) === (right.appBarPx?.height ?? 0) &&
  (left.sidePanelReveal ?? 1) === (right.sidePanelReveal ?? 1) &&
  (left.oncePerGameMarkers ?? 0) === (right.oncePerGameMarkers ?? 0) &&
  (left.farCardsUpright ?? false) === (right.farCardsUpright ?? false) &&
  sameZoneScroll(left.zoneScrollPx, right.zoneScrollPx);

const sameZoneScroll = (
  left: BoardLayoutState['zoneScrollPx'],
  right: BoardLayoutState['zoneScrollPx']
): boolean => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {}),
  ]);
  for (const key of keys) {
    if ((left?.[key] ?? 0) !== (right?.[key] ?? 0)) return false;
  }
  return true;
};

/**
 * Renderer-neutral vertical composition for opt-in board candidates. It owns
 * its renderer, adapter, and subscriptions, while borrowing the live/replay
 * sources supplied by the route. The query-gated room route selects a concrete
 * renderer factory; the thin candidate wrappers remain useful for isolated
 * parity and recovery evidence.
 */
export class BoardSessionRuntime {
  private readonly createRenderer: (
    adapters: BoardRendererAdapters
  ) => BoardRenderer;
  private layoutState: BoardLayoutState;
  private layoutSnapshot: BoardLayoutSnapshot;
  private renderer: BoardRenderer | null = null;
  private adapter: BoardSessionAdapter | null = null;
  private host: HTMLElement | null = null;
  private desiredScene: BoardScene | null = null;
  private desiredSceneMode: 'advance' | 'replace' = 'replace';
  private desiredPresentation: BoardPresentation = DEFAULT_BOARD_PRESENTATION;
  private preferences: BoardPreferences | undefined;
  private rendererReady = false;
  private rendererMountTask: Promise<void> | null = null;
  private rendererMountError: unknown;
  private rendererFailure: Error | null = null;
  private rendererFailureStatusReported = false;
  private attached = false;
  private disposed = false;
  /** Stops rebuilding the scene when the language or card images change. */
  private stopFollowingLanguage: (() => void) | null = null;
  private readonly layoutListeners = new Set<() => void>();
  private readonly abortedMountError = new Error(
    'Board runtime mount was aborted by disposal'
  );

  constructor(private readonly options: BoardSessionRuntimeOptions) {
    this.layoutState = retainLayoutState(options.layout);
    this.layoutSnapshot = retainLayoutSnapshot(this.layoutState);
    this.createRenderer = options.createRenderer;
    this.preferences = options.preferences;
  }

  async mount(host: HTMLElement): Promise<void> {
    if (this.disposed) throw new Error('Cannot mount a disposed board runtime');
    if (this.attached) throw new Error('Board runtime is already mounted');
    this.attached = true;
    this.host = host;
    try {
      this.renderer = this.createRenderer({
        emitIntent: (intent) => {
          try {
            this.options.onIntent?.(intent);
          } catch (error) {
            this.reportError(error);
          }
          this.adapter?.emitIntent(intent);
        },
        emitPresentationUpdate: (update) =>
          this.adapter?.emitPresentationUpdate(update),
        scrollZone: (zoneId, offsetPx) => this.scrollZone(zoneId, offsetPx),
        reportCardHover: (hover) => {
          try {
            this.options.onCardHover?.(hover);
          } catch (error) {
            this.reportError(error);
          }
        },
        reportMotion: (moving) => {
          try {
            this.options.onMotion?.(moving);
          } catch (error) {
            this.reportError(error);
          }
        },
        reportError: this.reportError,
        reportStatus: (status) => {
          if (status.kind === 'failed') {
            this.failRendererAndReport(
              status.error,
              'Board renderer reported a fatal failure'
            );
          } else {
            this.publishRendererStatus(status);
          }
        },
      });
      this.adapter = this.createAdapter();
      // The scene's labels (zone and card names for assistive tech) are
      // worded when it is built, so a new language builds it again.
      // Card faces are asked for in the language the player sees cards in,
      // which follows the page's unless chosen.
      const rebuild = () => {
        if (this.disposed) return;
        try {
          this.adapter?.refreshScene();
        } catch (error) {
          this.reportError(error);
        }
      };
      const stopWording = i18n.on('change', rebuild);
      const stopCardImages = preferences().subscribe(
        CARD_IMAGE_PREFERENCES,
        rebuild
      );
      const stopCardBacks = preferences().subscribe(
        CARD_BACK_VIEW_PREFERENCES,
        rebuild
      );
      const stopPageLanguage = preferences().subscribe(
        LANGUAGE_PREFERENCES,
        rebuild
      );
      this.stopFollowingLanguage = () => {
        stopWording();
        stopCardImages();
        stopCardBacks();
        stopPageLanguage();
      };
      await this.whenSettled();
      if (this.disposed) throw this.abortedMountError;
      if (this.rendererMountError) throw this.rendererMountError;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  getBoardSnapshot(): BoardSessionControllerState | undefined {
    return this.adapter?.getSnapshot();
  }

  /** Read-only route diagnostic used to retain the existing browser evidence seam. */
  getRenderer(): BoardRenderer | undefined {
    return this.renderer ?? undefined;
  }

  /** Route-composition seam for renderer-external menus, dialogs, and status. */
  subscribeBoard(listener: () => void): () => void {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.subscribe(() => {
      try {
        listener();
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  /** Routes DOM-overlay input through the same controller policy as renderer input. */
  emitBoardIntent(intent: BoardIntent): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitIntent(intent);
  }

  /**
   * A card dragged out of an overlay (a pile's viewer, a work area, the stack
   * view) is dragged on the table, exactly as one picked up there: the same
   * held card, lit targets and room made in a row. The controller accepts
   * only a card on the table or in the opened pile.
   */
  emitOverlayDrag(drag: BoardPresentation['drag']): boolean {
    this.assertUsable();
    return (
      this.adapter?.emitPresentationUpdate({ kind: 'DragChanged', drag }) ??
      false
    );
  }

  /** Validates duplicated card input against the currently open safe zone. */
  emitOpenedZoneCardIntent(intent: OpenedZoneCardIntent): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitOpenedZoneCardIntent(intent);
  }

  /** Route-owned overlays emit table intents through the same controller. */
  emitIntent(intent: BoardIntent): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitIntent(intent);
  }

  /** Resolves route-owned overlay controls through the installed safe view. */
  emitLegacyOverlayAction(
    request: LegacyBoardOverlayActionRequest,
    origin?: BoardActionOrigin
  ): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitLegacyOverlayAction(request, origin);
  }

  /** Resolves selected-card shortcuts through the same protected controller. */
  emitLegacyShortcutAction(
    request: LegacyBoardShortcutActionRequest,
    origin?: BoardActionOrigin
  ): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitLegacyShortcutAction(request, origin);
  }

  /** Resolves a player-frame GX/VSTAR control against the installed safe view. */
  emitOncePerGameAction(
    targetPlayerId: string,
    action: OncePerGameAction
  ): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitOncePerGameAction(targetPlayerId, action);
  }

  /** Route-owned keyboard seam for an ephemeral, non-command declaration. */
  declareMulligan(actingPlayerId?: string): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.declareMulligan(actingPlayerId);
  }

  /** Route-owned keyboard seam for an ephemeral deck-view declaration. */
  declareDeckView(actingPlayerId?: string): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.declareDeckView(actingPlayerId);
  }

  /** Reconstructs the current recipient-safe scene without changing game state. */
  refreshScene(): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.refreshScene();
  }

  /** Re-reads borrowed sources after page-local view policy changes. */
  synchronizeSources(): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.synchronize();
  }

  /** Updates renderer-local preferences without replacing authority or renderer. */
  setPreferences(preferences: BoardPreferences): void {
    this.assertUsable();
    if (
      JSON.stringify(this.preferences?.depth) !==
        JSON.stringify(preferences.depth) ||
      this.preferences?.reducedMotion !== preferences.reducedMotion ||
      this.preferences?.animationSpeed !== preferences.animationSpeed
    ) {
      this.renderer?.cancelInteraction();
      this.adapter?.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    }
    this.preferences = preferences;
    if (!this.rendererReady) return;
    const renderer = this.renderer;
    if (!renderer) throw new Error('Board renderer is unavailable');
    try {
      renderer.setPreferences(preferences);
    } catch (cause) {
      const failure = this.failRendererAndReport(
        cause,
        'Board renderer preference update failed'
      );
      this.reportError(failure);
      throw failure;
    }
  }

  dismissLocalPresentation(
    scope: BoardPresentationDismissScope = 'all'
  ): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.dismissLocalPresentation(scope);
  }

  getLayoutState(): BoardLayoutState {
    return copyLayoutState(this.layoutState);
  }

  /** Full source characterization used to derive renderer scene geometry. */
  getCharacterizedLayoutSnapshot(): BoardLayoutSnapshot {
    return this.layoutSnapshot;
  }

  /**
   * Route-composition seam for chrome that follows the renderer-neutral board
   * layout without reaching into either concrete renderer.
   */
  subscribeLayout(listener: () => void): () => void {
    this.assertUsable();
    this.layoutListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.layoutListeners.delete(listener);
    };
  }

  /** Waits only for a currently pending lazy renderer mount/recovery handoff. */
  async whenSettled(): Promise<void> {
    const task = this.rendererMountTask;
    await task;
    if (this.disposed) throw this.abortedMountError;
    if (this.rendererFailure) throw this.rendererFailure;
    if (this.rendererMountError) throw this.rendererMountError;
  }

  replaceLayoutState(
    layout: BoardLayoutState,
    cause: 'layout' | 'flip' = 'layout'
  ): boolean {
    this.assertUsable();
    const view = this.adapter?.getSnapshot().view;
    const nextState = retainLayoutState(withLostZoneUse(layout, view));
    const nextSnapshot = retainLayoutSnapshot(nextState);
    if (view) this.createScene(view, nextState, nextSnapshot);
    const changesScene = !sameLayoutState(this.layoutState, nextState);
    if (!changesScene) return false;
    this.layoutState = nextState;
    this.layoutSnapshot = nextSnapshot;
    this.adapter?.refreshScene(cause);
    this.adapter?.synchronize();
    this.notifyLayoutListeners();
    return true;
  }

  /** @deprecated Use replaceLayoutState; retained for candidate-wrapper compatibility. */
  replaceSupportedLayoutState(layout: BoardLayoutState): boolean {
    return this.replaceLayoutState(layout);
  }

  setViewport(viewport: BoardViewport): void {
    this.replaceLayoutState({
      ...this.layoutState,
      viewport: { ...viewport },
    });
  }

  /**
   * A docked side panel beside the table (`sidebar`) or none; `reveal` is
   * how far a sliding panel has come in, 0 to 1. `immediate` (a frame of
   * the panel's slide) paints the table within the caller's frame, so it
   * keeps pace with the panel instead of trailing it by a frame.
   */
  setShellMode(
    shellMode: BoardShellMode,
    reveal = 1,
    options?: { readonly immediate?: boolean }
  ): void {
    const { sidePanelReveal: _reveal, ...rest } = this.layoutState;
    const apply = (): void => {
      this.replaceLayoutState({
        ...rest,
        shellMode,
        ...(shellMode === 'sidebar' && reveal < 1
          ? { sidePanelReveal: reveal }
          : {}),
      });
    };
    const renderer = this.renderer;
    if (options?.immediate && renderer?.paintWithin) {
      renderer.paintWithin(apply);
    } else {
      apply();
    }
  }

  flipBoard(): void {
    this.replaceLayoutState(flipBoardLayoutState(this.layoutState), 'flip');
  }

  /**
   * v1's `#hand` scrolls sideways and its `#board` downwards when their cards
   * overflow; the renderer reports the scroll offset so the next scene lays
   * the cards out where they are shown.
   */
  scrollZone(zoneId: string, offsetPx: number): void {
    if (this.disposed || this.rendererFailure) return;
    const zone = this.adapter
      ?.getSnapshot()
      .scene?.zones.find((candidate) => candidate.id === zoneId);
    if (!zone?.playerId || (zone.kind !== 'hand' && zone.kind !== 'board')) {
      return;
    }
    const next = Math.max(
      0,
      Math.round(Number.isFinite(offsetPx) ? offsetPx : 0)
    );
    if ((this.layoutState.zoneScrollPx?.[zone.id] ?? 0) === next) return;
    this.replaceLayoutState({
      ...this.layoutState,
      zoneScrollPx: {
        ...(this.layoutState.zoneScrollPx ?? {}),
        [zone.id]: next,
      },
    });
  }

  resizeBoard(handleId: BoardResizeHandleId, clientY: number): void {
    this.replaceLayoutState(
      resizeLayoutStateFor(this.layoutState, handleId, clientY)
    );
  }

  /**
   * The viewer's board view on the play-mat table: how the height is split
   * between the halves, and a half they would rather not see.
   */
  setTableView(view: {
    readonly lowerShare: number;
    readonly hiddenPhysicalSide?: BoardPhysicalSide;
    readonly hideEmptyLostZone?: boolean;
    readonly hideLostZone?: boolean;
    readonly seamBandPx?: number;
    readonly appBarPx?: { readonly width: number; readonly height: number };
    readonly oncePerGameMarkers?: number;
    readonly farCardsUpright?: boolean;
  }): void {
    const {
      hiddenPhysicalSide: _previous,
      hideEmptyLostZone: _lostZone,
      hideLostZone: _lostZoneAway,
      seamBandPx: _seam,
      appBarPx: _bar,
      oncePerGameMarkers: _markers,
      farCardsUpright: _upright,
      ...rest
    } = this.layoutState;
    this.replaceLayoutState({
      ...rest,
      vertical: tableVerticalLayout(view.lowerShare),
      ...(view.hiddenPhysicalSide
        ? { hiddenPhysicalSide: view.hiddenPhysicalSide }
        : {}),
      ...(view.hideEmptyLostZone ? { hideEmptyLostZone: true } : {}),
      ...(view.hideLostZone ? { hideLostZone: true } : {}),
      ...(view.seamBandPx ? { seamBandPx: view.seamBandPx } : {}),
      ...(view.appBarPx ? { appBarPx: view.appBarPx } : {}),
      ...(view.oncePerGameMarkers
        ? { oncePerGameMarkers: view.oncePerGameMarkers }
        : {}),
      ...(view.farCardsUpright ? { farCardsUpright: true } : {}),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const adapter = this.adapter;
    this.adapter = null;
    const renderer = this.renderer;
    this.renderer = null;
    const host = this.host;
    this.host = null;
    this.desiredScene = null;
    this.desiredPresentation = DEFAULT_BOARD_PRESENTATION;
    this.rendererReady = false;
    this.layoutListeners.clear();
    this.stopFollowingLanguage?.();
    this.stopFollowingLanguage = null;
    try {
      adapter?.dispose();
    } catch (error) {
      this.reportError(error);
    }
    try {
      renderer?.destroy();
    } catch (error) {
      this.reportError(error);
    } finally {
      queueMicrotask(() => host?.replaceChildren());
    }
  }

  private createAdapter(): BoardSessionAdapter {
    return new BoardSessionAdapter({
      live: this.options.live,
      replay: this.options.replay,
      createScene: (view) => {
        this.followLostZoneUse(view);
        return this.createScene(view, this.layoutState, this.layoutSnapshot);
      },
      emitRendererEffect: this.handleBoardEffect,
      ...(this.options.transformView
        ? { transformView: this.options.transformView }
        : {}),
      ...(this.options.onSubmission
        ? { onSubmission: this.options.onSubmission }
        : {}),
      ...(this.options.onCommandRefused
        ? { onCommandRefused: this.options.onCommandRefused }
        : {}),
      ...(this.options.resolveDrop
        ? { resolveDrop: this.options.resolveDrop }
        : {}),
      ...(this.options.readsEveryHand
        ? { readsEveryHand: this.options.readsEveryHand }
        : {}),
      reportEffectFailure: (error) => this.reportError(error),
    });
  }

  private createScene(
    view: MatchViewState,
    layout: BoardLayoutState,
    snapshot: BoardLayoutSnapshot
  ): BoardScene {
    if (
      layout.playerIds[0] !== view.playerOrder[0] ||
      layout.playerIds[1] !== view.playerOrder[1]
    ) {
      throw new Error(
        'Characterized layout player order does not match the projected view'
      );
    }
    // Card backs are references each viewer draws for itself (ADR-041):
    // its own (both seats at a Solo table) as chosen, other players'
    // uploaded and designed ones only while Settings allows them.
    const ownPlayerIds = new Set(
      this.options.readsEveryHand?.() === true
        ? view.playerOrder
        : view.viewer.kind === 'player'
          ? [view.viewer.playerId]
          : []
    );
    return resolveSceneCardBacks(
      localizeSceneCardImages(createBoardScene(view, snapshot)),
      {
        ownPlayerIds,
        opponentCustomBacks: preferences().get(CARD_BACK_VIEW_PREFERENCES)
          .opponentCustomBacks,
      }
    );
  }

  private readonly handleBoardEffect = (
    effect: BoardSessionRendererEffect
  ): void => {
    if (this.rendererFailure) throw this.rendererFailure;
    if (this.disposed) return;
    const renderer = this.renderer;
    if (!renderer) throw new Error('Board renderer is unavailable');
    switch (effect.kind) {
      case 'CancelRendererInteraction':
        try {
          renderer.cancelInteraction();
        } catch (cause) {
          throw this.failRendererAndReport(
            cause,
            'Board renderer interaction cancellation failed'
          );
        }
        break;
      case 'ResetRenderer':
        this.desiredScene = null;
        this.desiredSceneMode = 'replace';
        this.desiredPresentation = DEFAULT_BOARD_PRESENTATION;
        try {
          renderer.clearScene();
        } catch (cause) {
          throw this.failRendererAndReport(
            cause,
            'Board renderer reset failed'
          );
        }
        break;
      case 'InstallScene':
        this.desiredScene = effect.scene;
        this.desiredSceneMode = effect.mode;
        if (this.rendererReady) {
          try {
            renderer.resize(effect.scene.viewport);
            renderer.installScene(effect.scene, [], effect.mode, effect.motion);
          } catch (cause) {
            throw this.failRendererAndReport(
              cause,
              'Board renderer scene install failed'
            );
          }
        } else {
          this.startRendererMount();
        }
        break;
      case 'InstallPresentation':
        this.desiredPresentation = effect.presentation;
        if (this.rendererReady) {
          try {
            renderer.installPresentation(effect.presentation);
          } catch (cause) {
            throw this.failRendererAndReport(
              cause,
              'Board renderer presentation install failed'
            );
          }
        }
        break;
      case 'IntentRejected':
      case 'OverlayActionRejected':
      case 'ShortcutActionRejected':
      case 'OncePerGameActionRejected':
        break;
    }
    this.options.onBoardEffect?.(effect);
  };

  private startRendererMount(): void {
    if (this.rendererMountTask || this.rendererReady || this.disposed) return;
    const renderer = this.renderer;
    const host = this.host;
    const initialScene = this.desiredScene;
    const initialPresentation = this.desiredPresentation;
    if (!renderer || !host || !initialScene) return;
    this.rendererMountError = undefined;
    // The first paint already wears the player's preferences (the tilt).
    if (this.preferences) renderer.setPreferences(this.preferences);
    this.rendererMountTask = renderer
      .mount(host, initialScene, initialPresentation)
      .then(() => {
        if (this.disposed) throw this.abortedMountError;
        this.rendererReady = true;
        const scene = this.desiredScene;
        if (!scene) return;
        renderer.resize(scene.viewport);
        if (scene !== initialScene) {
          // Catching up after mount: the table simply appears as it is.
          renderer.installScene(scene, [], this.desiredSceneMode, {
            cause: 'replace',
          });
        }
        if (this.desiredPresentation !== initialPresentation) {
          renderer.installPresentation(this.desiredPresentation);
        }
        if (this.preferences) renderer.setPreferences(this.preferences);
      })
      .catch((error: unknown) => {
        const rendererHadAlreadyFailed = this.rendererFailure !== null;
        const failure = this.disposed
          ? this.abortedMountError
          : this.failRendererAndReport(error, 'Board renderer mount failed');
        this.rendererMountError = failure;
        if (!this.disposed && !rendererHadAlreadyFailed) {
          this.reportError(failure);
        }
      })
      .finally(() => {
        this.rendererMountTask = null;
      });
  }

  private readonly reportError = (error: unknown): void => {
    try {
      this.options.reportError?.(error);
    } catch {
      // Diagnostics cannot interrupt renderer/session cleanup.
    }
  };

  /**
   * The first card into a Lost Zone, or the last out, lays the table out
   * again before its scene is built: an optional Lost Zone holding cards
   * lies beside the prizes. The layout's readers hear of it once the
   * scene is installed.
   */
  private followLostZoneUse(view: MatchViewState): void {
    const next = withLostZoneUse(this.layoutState, view);
    if (next === this.layoutState) return;
    this.layoutState = retainLayoutState(next);
    this.layoutSnapshot = retainLayoutSnapshot(this.layoutState);
    queueMicrotask(() => {
      if (!this.disposed) this.notifyLayoutListeners();
    });
  }

  private notifyLayoutListeners(): void {
    for (const listener of [...this.layoutListeners]) {
      if (!this.layoutListeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private publishRendererStatus(status: BoardRendererStatus): void {
    try {
      this.options.reportRendererStatus?.(status);
    } catch (error) {
      this.reportError(error);
    }
  }

  private failRendererAndReport(cause: unknown, message: string): Error {
    const failure = this.failRenderer(cause, message);
    if (!this.rendererFailureStatusReported) {
      this.rendererFailureStatusReported = true;
      this.publishRendererStatus({ kind: 'failed', error: failure });
    }
    return failure;
  }

  private failRenderer(cause: unknown, message: string): Error {
    if (this.rendererFailure) return this.rendererFailure;
    const failure = new Error(message);
    Object.assign(failure, { cause });
    this.rendererFailure = failure;
    this.desiredScene = null;
    this.desiredSceneMode = 'replace';
    this.desiredPresentation = DEFAULT_BOARD_PRESENTATION;
    const host = this.host;
    host?.replaceChildren();
    const adapter = this.adapter;
    this.adapter = null;
    const renderer = this.renderer;
    this.renderer = null;
    this.rendererReady = false;
    try {
      adapter?.dispose();
    } catch {
      // Fatal cleanup is best effort; the stable renderer error wins.
    }
    try {
      renderer?.destroy();
    } catch {
      // Fatal cleanup is best effort; the host is already blank.
    }
    return failure;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Board runtime is disposed');
    if (this.rendererFailure) throw this.rendererFailure;
    if (!this.attached) throw new Error('Board runtime is not mounted');
  }
}
