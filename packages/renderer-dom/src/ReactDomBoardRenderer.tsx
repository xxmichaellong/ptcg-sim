import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
  type BoardPreferences,
  type BoardPresentation,
  type BoardPresentationEvent,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardScene,
  type BoardSceneInstallMode,
  type BoardViewport,
} from '@ptcgsim/renderer-contract';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { BoardSurface } from './BoardSurface.js';

export class ReactDomBoardRenderer implements BoardRenderer {
  private readonly adapters: BoardRendererAdapters;
  private root: Root | null = null;
  private host: HTMLElement | null = null;
  private scene: BoardScene | null = null;
  private presentation: BoardPresentation | null = null;
  private preferences: BoardPreferences = DEFAULT_BOARD_PREFERENCES;
  private generation = 0;
  private destroyed = false;
  private finishPendingMount: (() => void) | null = null;
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
    this.adapters.reportStatus?.({ kind: 'mounting' });
    this.host = host;
    this.scene = scene;
    this.presentation = presentation;
    this.root = createRoot(host);
    this.generation += 1;
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.finishPendingMount = null;
        resolve();
      };
      this.finishPendingMount = finish;
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
    flushSync(() => root.render(null));
    this.cancelMountedInteraction = null;
  }

  resize(viewport: BoardViewport): void {
    this.requireRoot();
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

  destroy(): void {
    if (this.destroyed) return;
    this.cancelInteraction();
    this.destroyed = true;
    this.finishPendingMount?.();
    this.finishPendingMount = null;
    const root = this.root;
    this.root = null;
    this.host = null;
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
    const surface = (
      <StrictMode>
        <BoardSurface
          scene={scene}
          presentation={presentation}
          preferences={this.preferences}
          adapters={this.adapters}
          onCommit={onCommit}
          setInteractionCancellation={this.setInteractionCancellation}
        />
      </StrictMode>
    );
    root.render(surface);
  }

  private readonly setInteractionCancellation = (
    cancel: (() => void) | null
  ): void => {
    this.cancelMountedInteraction = cancel;
  };
}

export const createReactDomBoardRenderer = (
  adapters: BoardRendererAdapters
): BoardRenderer => new ReactDomBoardRenderer(adapters);
