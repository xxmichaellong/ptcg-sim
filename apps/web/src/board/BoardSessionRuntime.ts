import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardLayoutSnapshot,
  createBoardScene,
  DEFAULT_BOARD_PRESENTATION,
  flipBoardLayoutState,
  resizeBoardLayoutState,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type BoardIntent,
  type BoardPresentation,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardRendererStatus,
  type BoardResizeHandleId,
  type BoardScene,
  type BoardShellMode,
  type BoardViewport,
} from '@ptcgsim/renderer-contract';

import {
  BoardSessionAdapter,
  type BoardSessionAdapterOptions,
  type BoardSessionLiveSource,
  type BoardSessionRendererEffect,
  type BoardSessionReplaySource,
} from './BoardSessionAdapter.js';
import type {
  BoardPresentationDismissScope,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from './BoardSessionController.js';
import type { LegacyBoardOverlayActionRequest } from './resolveLegacyBoardOverlayAction.js';
import type { LegacyBoardShortcutActionRequest } from './resolveLegacyBoardShortcutAction.js';

export interface BoardSessionRuntimeOptions {
  readonly live: BoardSessionLiveSource;
  readonly replay: BoardSessionReplaySource;
  readonly layout: BoardLayoutState;
  readonly createRenderer: (adapters: BoardRendererAdapters) => BoardRenderer;
  readonly onBoardEffect?: (effect: BoardSessionRendererEffect) => void;
  readonly onSubmission?: BoardSessionAdapterOptions['onSubmission'];
  readonly reportError?: (error: unknown) => void;
  readonly reportRendererStatus?: (status: BoardRendererStatus) => void;
}

const copyLayoutState = (state: BoardLayoutState): BoardLayoutState => ({
  ...state,
  viewport: { ...state.viewport },
  playerIds: [...state.playerIds],
  vertical: {
    lowerFrame: { ...state.vertical.lowerFrame },
    upperFrame: { ...state.vertical.upperFrame },
    lowerHandle: { ...state.vertical.lowerHandle },
    upperHandle: { ...state.vertical.upperHandle },
    sharedPlacement: state.vertical.sharedPlacement,
  },
});

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
  deepFreeze(createBoardLayoutSnapshot(state));

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
  left.vertical.sharedPlacement === right.vertical.sharedPlacement;

/**
 * Renderer-neutral vertical composition for opt-in board candidates. It owns
 * its renderer, adapter, and subscriptions, while borrowing the live/replay
 * sources supplied by the route. Concrete wrappers remain unwired from
 * production routes until their parity gates pass.
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
  private rendererReady = false;
  private rendererMountTask: Promise<void> | null = null;
  private rendererMountError: unknown;
  private rendererFailure: Error | null = null;
  private attached = false;
  private disposed = false;
  private readonly layoutListeners = new Set<() => void>();
  private readonly abortedMountError = new Error(
    'Board runtime mount was aborted by disposal'
  );

  constructor(private readonly options: BoardSessionRuntimeOptions) {
    this.layoutState = retainLayoutState(options.layout);
    this.layoutSnapshot = retainLayoutSnapshot(this.layoutState);
    this.createRenderer = options.createRenderer;
  }

  async mount(host: HTMLElement): Promise<void> {
    if (this.disposed) throw new Error('Cannot mount a disposed board runtime');
    if (this.attached) throw new Error('Board runtime is already mounted');
    this.attached = true;
    this.host = host;
    try {
      this.renderer = this.createRenderer({
        emitIntent: (intent) => this.adapter?.emitIntent(intent),
        emitPresentationUpdate: (update) =>
          this.adapter?.emitPresentationUpdate(update),
        reportError: this.reportError,
        reportStatus: (status) => {
          try {
            this.options.reportRendererStatus?.(status);
          } catch (error) {
            this.reportError(error);
          }
        },
      });
      this.adapter = this.createAdapter();
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

  /** Validates duplicated card input against the currently open safe zone. */
  emitOpenedZoneCardIntent(intent: OpenedZoneCardIntent): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitOpenedZoneCardIntent(intent);
  }

  /** Resolves route-owned overlay controls through the installed safe view. */
  emitLegacyOverlayAction(request: LegacyBoardOverlayActionRequest): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitLegacyOverlayAction(request);
  }

  /** Resolves selected-card shortcuts through the same protected controller. */
  emitLegacyShortcutAction(request: LegacyBoardShortcutActionRequest): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.emitLegacyShortcutAction(request);
  }

  /** Route-owned keyboard seam for an ephemeral, non-command declaration. */
  declareMulligan(): boolean {
    this.assertUsable();
    const adapter = this.adapter;
    if (!adapter) throw new Error('Board session adapter is unavailable');
    return adapter.declareMulligan();
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

  replaceLayoutState(layout: BoardLayoutState): boolean {
    this.assertUsable();
    const nextState = retainLayoutState(layout);
    const nextSnapshot = retainLayoutSnapshot(nextState);
    const view = this.adapter?.getSnapshot().view;
    if (view) this.createScene(view, nextState, nextSnapshot);
    const changesScene = !sameLayoutState(this.layoutState, nextState);
    if (!changesScene) return false;
    this.layoutState = nextState;
    this.layoutSnapshot = nextSnapshot;
    this.adapter?.refreshScene();
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

  setShellMode(shellMode: BoardShellMode): void {
    this.replaceLayoutState({ ...this.layoutState, shellMode });
  }

  flipBoard(): void {
    this.replaceLayoutState(flipBoardLayoutState(this.layoutState));
  }

  resizeBoard(handleId: BoardResizeHandleId, clientY: number): void {
    this.replaceLayoutState(
      resizeBoardLayoutState(this.layoutState, handleId, clientY)
    );
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
      createScene: (view) =>
        this.createScene(view, this.layoutState, this.layoutSnapshot),
      emitRendererEffect: this.handleBoardEffect,
      ...(this.options.onSubmission
        ? { onSubmission: this.options.onSubmission }
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
    return createBoardScene(view, snapshot);
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
        renderer.cancelInteraction();
        break;
      case 'ResetRenderer':
        this.desiredScene = null;
        this.desiredSceneMode = 'replace';
        this.desiredPresentation = DEFAULT_BOARD_PRESENTATION;
        try {
          renderer.clearScene();
        } catch (cause) {
          throw this.failRenderer(cause, 'Board renderer reset failed');
        }
        break;
      case 'InstallScene':
        this.desiredScene = effect.scene;
        this.desiredSceneMode = effect.mode;
        if (this.rendererReady) {
          renderer.resize(effect.scene.viewport);
          renderer.installScene(effect.scene, [], effect.mode);
        } else {
          this.startRendererMount();
        }
        break;
      case 'InstallPresentation':
        this.desiredPresentation = effect.presentation;
        if (this.rendererReady)
          renderer.installPresentation(effect.presentation);
        break;
      case 'IntentRejected':
      case 'OverlayActionRejected':
      case 'ShortcutActionRejected':
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
    this.rendererMountTask = renderer
      .mount(host, initialScene, initialPresentation)
      .then(() => {
        if (this.disposed) throw this.abortedMountError;
        this.rendererReady = true;
        const scene = this.desiredScene;
        if (!scene) return;
        renderer.resize(scene.viewport);
        if (scene !== initialScene) {
          renderer.installScene(scene, [], this.desiredSceneMode);
        }
        if (this.desiredPresentation !== initialPresentation) {
          renderer.installPresentation(this.desiredPresentation);
        }
      })
      .catch((error: unknown) => {
        const failure = this.disposed
          ? this.abortedMountError
          : this.failRenderer(error, 'Board renderer mount failed');
        this.rendererMountError = failure;
        if (!this.disposed) this.reportError(failure);
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
