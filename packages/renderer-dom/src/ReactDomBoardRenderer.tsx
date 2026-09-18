import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
  assertViewport,
  type BoardPreferences,
  type BoardPresentation,
  type BoardPresentationEvent,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardRendererDiagnostics,
  type BoardScene,
  type BoardSceneInstallMode,
  type BoardViewport,
} from '@ptcgsim/renderer-contract';
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { BoardSurface } from './BoardSurface.js';

class BoardRendererErrorBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly onError: (error: unknown) => void;
  },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: true } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export class ReactDomBoardRenderer implements BoardRenderer {
  private readonly adapters: BoardRendererAdapters;
  private root: Root | null = null;
  private host: HTMLElement | null = null;
  private scene: BoardScene | null = null;
  private presentation: BoardPresentation | null = null;
  private preferences: BoardPreferences = DEFAULT_BOARD_PREFERENCES;
  private generation = 0;
  private renderCommits = 0;
  private destroyed = false;
  private fatalErrorReported = false;
  private finishPendingMount: (() => void) | null = null;
  private failPendingMount: ((error: unknown) => void) | null = null;
  private cancelMountedInteraction: (() => void) | null = null;

  constructor(adapters: BoardRendererAdapters) {
    this.adapters = adapters;
  }

  async mount(
    host: HTMLElement,
    scene: BoardScene,
    presentation: BoardPresentation
  ): Promise<void> {
    if (this.destroyed) throw new Error('Cannot mount a destroyed renderer');
    if (this.root) throw new Error('Board renderer is already mounted');
    assertViewport(scene.viewport);
    this.adapters.reportStatus?.({ kind: 'mounting' });
    this.host = host;
    this.scene = scene;
    this.presentation = presentation;
    this.root = createRoot(host, {
      onUncaughtError: this.handleUncaughtRenderError,
      onCaughtError: this.handleUncaughtRenderError,
    });
    this.generation += 1;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.finishPendingMount = null;
        this.failPendingMount = null;
        resolve();
      };
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        this.finishPendingMount = null;
        this.failPendingMount = null;
        reject(error);
      };
      this.finishPendingMount = finish;
      this.failPendingMount = fail;
      this.renderNow(this.requireRoot(), finish);
    });
    if (this.destroyed) {
      throw new Error('Renderer initialization was superseded');
    }
    this.adapters.reportStatus?.({
      kind: 'ready',
      generation: this.generation,
    });
  }

  installScene(
    scene: BoardScene,
    events: readonly BoardPresentationEvent[],
    mode: BoardSceneInstallMode = 'advance'
  ): void {
    const root = this.requireRoot();
    assertViewport(scene.viewport);
    const current = this.scene;
    if (mode !== 'replace' && current && scene.revision < current.revision) {
      throw new Error('Cannot install an older board scene revision');
    }
    for (const event of events) {
      if (event.revision !== scene.revision) {
        throw new Error('Presentation event revision does not match the scene');
      }
    }
    this.scene = scene;
    if (this.presentation) this.renderNow(root);
  }

  installPresentation(presentation: BoardPresentation): void {
    const root = this.requireRoot();
    this.presentation = presentation;
    if (this.scene) this.renderNow(root);
  }

  cancelInteraction(): void {
    this.cancelMountedInteraction?.();
  }

  clearScene(): void {
    const root = this.requireRoot();
    this.cancelInteraction();
    this.scene = null;
    this.presentation = DEFAULT_BOARD_PRESENTATION;
    this.finishPendingMount?.();
    this.finishPendingMount = null;
    this.failPendingMount = null;
    flushSync(() => root.render(null));
    this.renderCommits += 1;
    this.cancelMountedInteraction = null;
  }

  resize(viewport: BoardViewport): void {
    this.requireRoot();
    assertViewport(viewport);
    if (this.host) {
      this.host.style.width = `${viewport.width}px`;
      this.host.style.height = `${viewport.height}px`;
    }
  }

  setPreferences(preferences: BoardPreferences): void {
    const root = this.requireRoot();
    this.preferences = preferences;
    if (this.scene && this.presentation) this.renderNow(root);
  }

  getDiagnostics(): BoardRendererDiagnostics {
    const host = this.host;
    const renderedCardIds = Array.from(
      host?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [],
      (element) => element.dataset.cardId
    ).filter(
      (id): id is BoardRendererDiagnostics['renderedCardIds'][number] =>
        id !== undefined
    );
    const renderedZoneIds = Array.from(
      host?.querySelectorAll<HTMLElement>('[data-zone-id]') ?? [],
      (element) => element.dataset.zoneId
    ).filter((id): id is string => id !== undefined);
    const renderedMarkerIds = Array.from(
      host?.querySelectorAll<HTMLElement>('[data-marker-id]') ?? [],
      (element) => element.dataset.markerId
    ).filter((id): id is string => id !== undefined);
    return {
      rendererKind: 'dom',
      mounted: !this.destroyed && this.root !== null,
      destroyed: this.destroyed,
      generation: this.generation,
      sceneRevision: this.scene?.revision ?? null,
      renderCommits: this.renderCommits,
      renderedCardIds,
      renderedZoneIds,
      renderedMarkerIds,
      domNodes: host?.querySelectorAll('*').length ?? 0,
      displayObjects: 0,
      localTextureBindings: 0,
      globalTextureLeaseEntries: 0,
      globalPendingTextureLoads: 0,
      globalUnloadingTextures: 0,
      globalTextureReferences: 0,
      globalTextureLoadFailures: 0,
      globalTextureUnloadFailures: 0,
      contextLossListeners: 0,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelInteraction();
    this.destroyed = true;
    this.finishPendingMount?.();
    this.finishPendingMount = null;
    this.failPendingMount = null;
    const root = this.root;
    const host = this.host;
    this.root = null;
    if (!root) this.host = null;
    this.scene = null;
    this.presentation = null;
    this.cancelMountedInteraction = null;
    this.adapters.reportStatus?.({ kind: 'destroyed' });
    if (root) {
      queueMicrotask(() => {
        try {
          root.unmount();
        } catch (error) {
          try {
            this.adapters.reportError(error);
          } catch {
            // Diagnostics cannot interrupt deferred teardown.
          }
        } finally {
          if (this.host === host) this.host = null;
        }
      });
    }
  }

  private requireRoot(): Root {
    if (this.destroyed || !this.root) {
      throw new Error('Board renderer is not mounted');
    }
    return this.root;
  }

  private renderNow(root = this.requireRoot(), onCommit?: () => void): void {
    const scene = this.scene;
    const presentation = this.presentation;
    if (!scene || !presentation) return;
    let committed = false;
    const recordCommit = () => {
      // Strict Mode replays layout effects in development. Count the renderer
      // commit once while retaining the replay that catches unsafe effects.
      if (committed) return;
      committed = true;
      this.renderCommits += 1;
      onCommit?.();
    };
    const surface = (
      <StrictMode>
        <BoardRendererErrorBoundary onError={this.handleUncaughtRenderError}>
          <BoardSurface
            scene={scene}
            presentation={presentation}
            preferences={this.preferences}
            adapters={this.adapters}
            onCommit={recordCommit}
            setInteractionCancellation={this.setInteractionCancellation}
          />
        </BoardRendererErrorBoundary>
      </StrictMode>
    );
    root.render(surface);
  }

  private readonly setInteractionCancellation = (
    cancel: (() => void) | null
  ): void => {
    this.cancelMountedInteraction = cancel;
  };

  private readonly handleUncaughtRenderError = (error: unknown): void => {
    if (this.fatalErrorReported) return;
    this.fatalErrorReported = true;
    // Reject a pending initial mount before notifying the runtime. The fatal
    // status callback is allowed to destroy this renderer synchronously, and
    // destroy normally resolves a pending mount to unblock orderly disposal.
    this.failPendingMount?.(error);
    this.failPendingMount = null;
    this.finishPendingMount = null;
    try {
      this.adapters.reportStatus?.({ kind: 'failed', error });
    } catch (observerError) {
      try {
        this.adapters.reportError(observerError);
      } catch {
        // Diagnostics cannot interrupt fatal renderer notification.
      }
    }
    try {
      this.adapters.reportError(error);
    } catch {
      // Diagnostics cannot interrupt React's error cleanup.
    }
  };
}

export const createReactDomBoardRenderer = (
  adapters: BoardRendererAdapters
): BoardRenderer => new ReactDomBoardRenderer(adapters);
