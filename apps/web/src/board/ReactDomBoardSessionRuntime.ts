import type {
  BoardRenderer,
  BoardRendererAdapters,
} from '@ptcgsim/renderer-contract';
import { createReactDomBoardRenderer } from '@ptcgsim/renderer-dom';

import {
  BoardSessionRuntime,
  type BoardSessionRuntimeOptions,
} from './BoardSessionRuntime.js';
import { ReactDomBoardResizeInteraction } from './ReactDomBoardResizeInteraction.js';

export interface ReactDomBoardSessionRuntimeOptions extends Omit<
  BoardSessionRuntimeOptions,
  'createRenderer'
> {
  readonly createRenderer?: (adapters: BoardRendererAdapters) => BoardRenderer;
  /**
   * Candidate-only native pointer ownership for the source-shaped resize
   * handles. Disabled unless the composing route explicitly opts in.
   */
  readonly enableLegacyResizeInteraction?: boolean;
}

/**
 * Opt-in normalized-DOM composition. Upstream live/replay/presentation owners
 * are borrowed; this wrapper only selects the DOM renderer implementation.
 */
export class ReactDomBoardSessionRuntime extends BoardSessionRuntime {
  private readonly enableLegacyResizeInteraction: boolean;
  private readonly reportResizeError: (error: unknown) => void;
  private resizeInteraction: ReactDomBoardResizeInteraction | null = null;

  constructor(options: ReactDomBoardSessionRuntimeOptions) {
    super({
      ...options,
      createRenderer: options.createRenderer ?? createReactDomBoardRenderer,
    });
    this.enableLegacyResizeInteraction =
      options.enableLegacyResizeInteraction === true;
    this.reportResizeError = options.reportError ?? (() => undefined);
  }

  override async mount(host: HTMLElement): Promise<void> {
    await super.mount(host);
    if (!this.enableLegacyResizeInteraction) return;
    try {
      this.resizeInteraction = new ReactDomBoardResizeInteraction(
        host,
        () => this.getCharacterizedLayoutSnapshot(),
        (handleId, clientY) => this.resizeBoard(handleId, clientY)
      );
    } catch (error) {
      super.dispose();
      try {
        this.reportResizeError(error);
      } catch {
        // Diagnostics cannot interrupt the mount failure boundary.
      }
      throw error;
    }
  }

  override dispose(): void {
    this.resizeInteraction?.dispose();
    this.resizeInteraction = null;
    super.dispose();
  }
}
