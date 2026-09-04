// @vitest-environment happy-dom

import {
  createRendererSpikeView,
  type BoardRendererAdapters,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readRendererKind, RendererSpikeBoard } from './RendererSpikeBoard.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rendererHarness = vi.hoisted(() => ({
  adapters: undefined as BoardRendererAdapters | undefined,
  mount: vi.fn(async () => undefined),
  installScene: vi.fn(),
  installPresentation: vi.fn(),
  cancelInteraction: vi.fn(),
  clearScene: vi.fn(),
  resize: vi.fn(),
  setPreferences: vi.fn(),
  destroy: vi.fn(),
  create: vi.fn((adapters: BoardRendererAdapters) => {
    rendererHarness.adapters = adapters;
    return {
      mount: rendererHarness.mount,
      installScene: rendererHarness.installScene,
      installPresentation: rendererHarness.installPresentation,
      cancelInteraction: rendererHarness.cancelInteraction,
      clearScene: rendererHarness.clearScene,
      resize: rendererHarness.resize,
      setPreferences: rendererHarness.setPreferences,
      destroy: rendererHarness.destroy,
    };
  }),
}));

vi.mock('@ptcgsim/renderer-dom', () => ({
  createReactDomBoardRenderer: rendererHarness.create,
}));

class PassiveResizeObserver implements ResizeObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
}

describe('RendererSpikeBoard application boundary', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    rendererHarness.adapters = undefined;
    globalThis.ResizeObserver = PassiveResizeObserver;
  });

  it('installs authoritative views and current submitters without remounting', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const firstView = createRendererSpikeView();
    const firstSubmit = vi.fn();
    const secondSubmit = vi.fn();
    const onIntent = vi.fn();

    await act(async () => {
      root.render(
        <RendererSpikeBoard
          view={firstView}
          rendererKind="dom"
          onIntent={onIntent}
          submitCommand={firstSubmit}
        />
      );
      await Promise.resolve();
    });
    expect(rendererHarness.mount).toHaveBeenCalledTimes(1);
    expect(rendererHarness.create).toHaveBeenCalledTimes(1);

    const secondView = { ...firstView, revision: firstView.revision + 1 };
    await act(async () => {
      root.render(
        <RendererSpikeBoard
          view={secondView}
          rendererKind="dom"
          onIntent={onIntent}
          submitCommand={secondSubmit}
        />
      );
    });
    const installedScene = rendererHarness.installScene.mock.calls.at(
      -1
    )?.[0] as BoardScene | undefined;
    expect(installedScene?.revision).toBe(secondView.revision);
    expect(rendererHarness.mount).toHaveBeenCalledTimes(1);
    expect(rendererHarness.destroy).not.toHaveBeenCalled();

    const replayView = { ...secondView, revision: 0 };
    await act(async () => {
      root.render(
        <RendererSpikeBoard
          view={replayView}
          rendererKind="dom"
          onIntent={onIntent}
          submitCommand={secondSubmit}
          allowRevisionRegression
        />
      );
    });
    expect(rendererHarness.installScene.mock.calls.at(-1)?.[2]).toBe('replace');
    expect(rendererHarness.mount).toHaveBeenCalledTimes(1);

    const handCard = installedScene?.cards.find(
      (card) => card.side === 'local' && card.parentId.endsWith(':hand')
    );
    if (!handCard) throw new Error('Fixture has no local hand card');
    rendererHarness.adapters?.emitIntent({
      kind: 'CardDropRequested',
      cardId: handCard.id,
      targetId: 'slot:spike-blue:bench',
    });
    expect(firstSubmit).not.toHaveBeenCalled();
    expect(secondSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MoveCardToPlay',
        cardId: handCard.id,
        expectedSourceZoneId: 'zone:spike-blue:hand',
      })
    );

    await act(async () => root.unmount());
    expect(rendererHarness.destroy).toHaveBeenCalledTimes(1);
  });

  it('defaults to the selected DOM renderer and keeps Pixi explicitly opt-in', () => {
    expect(readRendererKind(null)).toBe('dom');
    expect(readRendererKind('dom')).toBe('dom');
    expect(readRendererKind('pixi')).toBe('pixi');
    expect(readRendererKind('unsupported')).toBe('dom');
  });
});
