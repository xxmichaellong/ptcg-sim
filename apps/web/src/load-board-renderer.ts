import type {
  BoardRendererFactory,
  RendererKind,
} from './renderer-spike-handle.js';

/** Probe the same stencil capability that Pixi requires, then release the context. */
const supportsBoardWebGL = (): boolean => {
  const canvas = document.createElement('canvas');
  try {
    const context = canvas.getContext('webgl', {
      stencil: true,
      failIfMajorPerformanceCaveat: false,
    }) as WebGLRenderingContext | null;
    if (!context) return false;
    const supported = context.getContextAttributes()?.stencil === true;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return supported;
  } catch {
    return false;
  }
};

export const loadBoardRenderer = async (
  requested: RendererKind
): Promise<{ kind: RendererKind; createRenderer: BoardRendererFactory }> => {
  const kind = requested === 'pixi' && supportsBoardWebGL() ? 'pixi' : 'dom';
  const createRenderer =
    kind === 'pixi'
      ? (await import('@ptcgsim/renderer-pixi')).createPixiBoardRenderer
      : (await import('@ptcgsim/renderer-dom')).createReactDomBoardRenderer;
  return { kind, createRenderer };
};
