// @vitest-environment happy-dom

import {
  BoardDragController,
  createBoardScene,
  createRendererSpikeView,
  DEFAULT_BOARD_PRESENTATION,
  type BoardPresentation,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PixiBoardRenderer } from './PixiBoardRenderer.js';

const scene = (): BoardScene => {
  const view = createRendererSpikeView();
  return createBoardScene(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId:
      view.viewer.kind === 'player'
        ? view.viewer.playerId
        : view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
};

interface RendererInternals {
  app: { readonly canvas: HTMLCanvasElement; readonly destroy: () => void };
  mounted: boolean;
  scene: BoardScene;
  presentation: BoardPresentation;
  readonly dragController: BoardDragController;
  readonly handleContextLost: (event: Event) => void;
  recoverFromContextLoss: () => Promise<void>;
}

const mountInteractionState = (
  renderer: PixiBoardRenderer,
  presentation: BoardPresentation = DEFAULT_BOARD_PRESENTATION
) => {
  const canvas = document.createElement('canvas');
  canvas.hasPointerCapture = vi.fn(() => true);
  canvas.releasePointerCapture = vi.fn();
  const currentScene = scene();
  const internals = renderer as unknown as RendererInternals;
  internals.app = { canvas, destroy: vi.fn() };
  internals.mounted = true;
  internals.scene = currentScene;
  internals.presentation = presentation;
  return { canvas, currentScene, internals };
};

const startDrag = (
  internals: RendererInternals,
  currentScene: BoardScene,
  pointerId = 7
) => {
  const card = currentScene.cards.find((candidate) => candidate.interactive)!;
  const x = card.bounds.x + card.bounds.width / 2;
  const y = card.bounds.y + card.bounds.height / 2;
  expect(
    internals.dragController.pointerDown(currentScene, card.id, {
      pointerId,
      x,
      y,
      button: 0,
    })
  ).toBe(true);
  expect(
    internals.dragController.pointerMove(currentScene, {
      pointerId,
      x: x + 20,
      y: y + 20,
      button: 0,
    })
  ).toBe(true);
  return { card, x, y };
};

describe('Pixi board interaction cancellation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards application cancellation and releases the captured pointer', () => {
    const cancelInteraction = vi.spyOn(
      BoardDragController.prototype,
      'cancelInteraction'
    );
    cancelInteraction.mockReturnValueOnce(7);
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const { canvas } = mountInteractionState(renderer);

    expect(() => renderer.cancelInteraction()).not.toThrow();
    expect(cancelInteraction).toHaveBeenCalledOnce();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    renderer.destroy();
  });

  it('clears an active drag exactly once before context-loss recovery', async () => {
    const emitPresentationUpdate = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError: vi.fn(),
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    const { card, x, y } = startDrag(internals, currentScene);
    internals.presentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: card.id, x: x + 20, y: y + 20, targetId: null },
    };
    emitPresentationUpdate.mockClear();
    const recover = vi
      .spyOn(internals, 'recoverFromContextLoss')
      .mockImplementation(async () => {
        expect(internals.presentation.drag).toBeNull();
      });
    const event = new Event('webglcontextlost', { cancelable: true });

    internals.handleContextLost(event);
    internals.handleContextLost(event);
    expect(event.defaultPrevented).toBe(true);
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
    expect(emitPresentationUpdate).toHaveBeenCalledWith({
      kind: 'DragChanged',
      drag: null,
    });
    expect(internals.presentation.drag).toBeNull();
    expect(canvas.releasePointerCapture).toHaveBeenCalledOnce();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(internals.dragController.consumeSuppressedClick(card.id)).toBe(
      false
    );
    expect(recover).toHaveBeenCalledOnce();
    await Promise.resolve();
    renderer.destroy();
  });

  it('contains pointer-release failures and destroys active interaction idempotently', () => {
    const emitPresentationUpdate = vi.fn();
    const reportError = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError,
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    startDrag(internals, currentScene);
    emitPresentationUpdate.mockClear();
    const release = vi.fn(() => {
      throw new Error('capture already lost');
    });
    canvas.releasePointerCapture = release;

    expect(() => renderer.destroy()).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(emitPresentationUpdate).not.toHaveBeenCalled();
    expect(() => renderer.destroy()).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('contains a capture-release failure during context loss', async () => {
    const emitPresentationUpdate = vi.fn();
    const reportError = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError,
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    const { card, x, y } = startDrag(internals, currentScene);
    internals.presentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: card.id, x: x + 20, y: y + 20, targetId: null },
    };
    emitPresentationUpdate.mockClear();
    canvas.releasePointerCapture = vi.fn(() => {
      throw new Error('capture already lost');
    });
    vi.spyOn(internals, 'recoverFromContextLoss').mockResolvedValue(undefined);

    expect(() =>
      internals.handleContextLost(
        new Event('webglcontextlost', { cancelable: true })
      )
    ).not.toThrow();
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
    expect(internals.presentation.drag).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
    await Promise.resolve();
    renderer.destroy();
    renderer.destroy();
  });
});
