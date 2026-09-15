import type {
  BoardRenderer,
  BoardRendererAdapters,
  BoardScene,
} from '@ptcgsim/renderer-contract';

export type RendererKind = 'dom' | 'pixi';

export type BoardRendererFactory = (
  adapters: BoardRendererAdapters
) => BoardRenderer;

export interface RendererSpikeHandle {
  readonly rendererKind: RendererKind;
  readonly renderer: BoardRenderer;
  readonly scene: BoardScene;
  /** Development-only browser-test seam for lifecycle gates. */
  readonly createRenderer?: BoardRendererFactory;
}

declare global {
  interface Window {
    __PTCG_RENDERER_SPIKE__?: RendererSpikeHandle;
  }
}
