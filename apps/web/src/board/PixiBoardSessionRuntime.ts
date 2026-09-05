import { createPixiBoardRenderer } from '@ptcgsim/renderer-pixi';

import {
  BoardSessionRuntime,
  type BoardSessionRuntimeOptions,
} from './BoardSessionRuntime.js';

export type PixiBoardSessionRuntimeOptions = Omit<
  BoardSessionRuntimeOptions,
  'createRenderer'
>;

/**
 * Opt-in raw-Pixi composition over the same renderer-neutral session runtime.
 * It is exported for parity evidence and is not instantiated by a route.
 */
export class PixiBoardSessionRuntime extends BoardSessionRuntime {
  constructor(options: PixiBoardSessionRuntimeOptions) {
    super({ ...options, createRenderer: createPixiBoardRenderer });
  }
}
