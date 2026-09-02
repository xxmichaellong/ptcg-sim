import {
  DEFAULT_BOARD_PREFERENCES,
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
      this.renderNow(finish);
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
    const mounted = this.requireMounted();
    if (mode !== 'replace' && scene.revision < mounted.scene.revision) {
      throw new Error('Cannot install an older board scene revision');
    }
    for (const event of events) {
      if (event.revision !== scene.revision) {
        throw new Error('Presentation event revision does not match the scene');
      }
    }
    this.scene = scene;
    this.renderNow();
  }

  installPresentation(presentation: BoardPresentation): void {
    this.requireMounted();
    this.presentation = presentation;
    this.renderNow();
  }

  resize(viewport: BoardViewport): void {
    this.requireMounted();
    if (this.host) {
      this.host.style.width = `${viewport.width}px`;
      this.host.style.height = `${viewport.height}px`;
    }
  }

  setPreferences(preferences: BoardPreferences): void {
    this.requireMounted();
    this.preferences = preferences;
    this.renderNow();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishPendingMount?.();
    this.finishPendingMount = null;
    const root = this.root;
    this.root = null;
    this.host = null;
    this.scene = null;
    this.presentation = null;
    this.adapters.reportStatus?.({ kind: 'destroyed' });
    if (root) queueMicrotask(() => root.unmount());
  }

  private requireMounted(): {
    readonly root: Root;
    readonly scene: BoardScene;
    readonly presentation: BoardPresentation;
  } {
    if (this.destroyed || !this.root || !this.scene || !this.presentation) {
      throw new Error('Board renderer is not mounted');
    }
    return {
      root: this.root,
      scene: this.scene,
      presentation: this.presentation,
    };
  }

  private renderNow(onCommit?: () => void): void {
    const { root, scene, presentation } = this.requireMounted();
    const surface = (
      <StrictMode>
        <BoardSurface
          scene={scene}
          presentation={presentation}
          preferences={this.preferences}
          adapters={this.adapters}
          onCommit={onCommit}
        />
      </StrictMode>
    );
    root.render(surface);
  }
}

export const createReactDomBoardRenderer = (
  adapters: BoardRendererAdapters
): BoardRenderer => new ReactDomBoardRenderer(adapters);
