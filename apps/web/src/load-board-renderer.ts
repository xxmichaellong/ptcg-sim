import type { BoardRendererFactory } from './renderer-spike-handle.js';

/** The board's renderer arrives in its own chunk, after the page shell. */
export const loadBoardRenderer = async (): Promise<BoardRendererFactory> =>
  (await import('@ptcgsim/renderer-dom')).createReactDomBoardRenderer;
