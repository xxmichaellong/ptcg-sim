import type {
  BoardRenderer,
  BoardRendererAdapters,
} from '@ptcgsim/renderer-contract';
import { createReactDomBoardRenderer } from '@ptcgsim/renderer-dom';

import {
  BoardSessionRuntime,
  type BoardSessionRuntimeOptions,
} from './BoardSessionRuntime.js';

export interface ReactDomBoardSessionRuntimeOptions extends Omit<
  BoardSessionRuntimeOptions,
  'createRenderer'
> {
  readonly createRenderer?: (adapters: BoardRendererAdapters) => BoardRenderer;
}

/**
 * Opt-in normalized-DOM composition. Upstream live/replay/presentation owners
 * are borrowed; this wrapper only selects the DOM renderer implementation.
 */
export class ReactDomBoardSessionRuntime extends BoardSessionRuntime {
  constructor(options: ReactDomBoardSessionRuntimeOptions) {
    super({
      ...options,
      createRenderer: options.createRenderer ?? createReactDomBoardRenderer,
    });
  }
}
