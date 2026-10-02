// @vitest-environment happy-dom

import {
  DEFAULT_BOARD_PRESENTATION,
  DEFAULT_BOARD_PREFERENCES,
  createRendererSpikeView,
  type BoardPreferences,
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
    expect(rendererHarness.setPreferences).not.toHaveBeenCalled();

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

  it('installs explicit local preferences after mount and updates without remounting', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const view = createRendererSpikeView();
    const dark: BoardPreferences = {
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
      showZoneOutlines: true,
    };
    const light: BoardPreferences = { ...dark, darkMode: false };
    const props = {
      view,
      rendererKind: 'dom' as const,
      onIntent: vi.fn(),
      submitCommand: vi.fn(),
    };

    await act(async () => {
      root.render(<RendererSpikeBoard {...props} preferences={dark} />);
      await Promise.resolve();
    });
    expect(rendererHarness.setPreferences).toHaveBeenCalledWith(dark);
    expect(rendererHarness.mount).toHaveBeenCalledOnce();

    await act(async () =>
      root.render(<RendererSpikeBoard {...props} preferences={light} />)
    );
    expect(rendererHarness.setPreferences).toHaveBeenLastCalledWith(light);
    expect(rendererHarness.mount).toHaveBeenCalledOnce();
    expect(rendererHarness.destroy).not.toHaveBeenCalled();

    await act(async () => root.render(<RendererSpikeBoard {...props} />));
    expect(rendererHarness.setPreferences).toHaveBeenLastCalledWith(
      DEFAULT_BOARD_PREFERENCES
    );
    expect(rendererHarness.mount).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(rendererHarness.destroy).toHaveBeenCalledOnce();
  });

  it('cancels stale local presentation once when a live session stops being ready', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const view = createRendererSpikeView();
    const props = {
      view,
      rendererKind: 'dom' as const,
      onIntent: vi.fn(),
      submitCommand: vi.fn(),
    };

    await act(async () => {
      root.render(<RendererSpikeBoard {...props} sessionReady />);
      await Promise.resolve();
    });
    const card = (
      rendererHarness.mount.mock.calls[0]?.[1] as BoardScene | undefined
    )?.cards.find((candidate) => candidate.interactive);
    if (!card) throw new Error('Fixture has no interactive card');

    await act(async () => {
      rendererHarness.adapters?.emitIntent({
        kind: 'CardSelected',
        cardId: card.id,
      });
      rendererHarness.adapters?.emitPresentationUpdate({
        kind: 'DragChanged',
        drag: {
          cardId: card.id,
          x: card.bounds.x,
          y: card.bounds.y,
          targetId: null,
        },
      });
    });
    expect(rendererHarness.installPresentation.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        selectedCardId: card.id,
        drag: expect.objectContaining({ cardId: card.id }),
      })
    );

    rendererHarness.cancelInteraction.mockClear();
    rendererHarness.installPresentation.mockClear();
    await act(async () => {
      root.render(<RendererSpikeBoard {...props} sessionReady={false} />);
    });
    expect(rendererHarness.cancelInteraction).toHaveBeenCalledOnce();
    expect(rendererHarness.installPresentation).toHaveBeenCalledWith(
      DEFAULT_BOARD_PRESENTATION
    );

    await act(async () => {
      root.render(<RendererSpikeBoard {...props} sessionReady={false} />);
    });
    expect(rendererHarness.cancelInteraction).toHaveBeenCalledOnce();
    expect(rendererHarness.mount).toHaveBeenCalledOnce();
    expect(rendererHarness.destroy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(rendererHarness.destroy).toHaveBeenCalledOnce();
  });

  it('coalesces viewport signals, suppresses unchanged work, and releases every listener', async () => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const addResolutionListener = vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change') listeners.add(listener);
      }
    );
    const removeResolutionListener = vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change') listeners.delete(listener);
      }
    );
    const mediaQuery = {
      matches: true,
      media: '(resolution: 1dppx)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: addResolutionListener,
      removeEventListener: removeResolutionListener,
      dispatchEvent: (event: Event) => {
        for (const listener of [...listeners]) {
          if (typeof listener === 'function') listener.call(mediaQuery, event);
          else listener.handleEvent(event);
        }
        return true;
      },
    } as unknown as MediaQueryList;
    const nativeMatchMedia = globalThis.matchMedia;
    const nativeDevicePixelRatio = Object.getOwnPropertyDescriptor(
      window,
      'devicePixelRatio'
    );
    globalThis.matchMedia = vi.fn(() => mediaQuery);
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <RendererSpikeBoard
            view={createRendererSpikeView()}
            rendererKind="dom"
            onIntent={vi.fn()}
            submitCommand={vi.fn()}
          />
        );
        await Promise.resolve();
      });
      expect(addResolutionListener).toHaveBeenCalledTimes(1);
      rendererHarness.resize.mockClear();
      rendererHarness.installScene.mockClear();

      await act(async () => {
        for (let index = 0; index < 20; index += 1) {
          window.dispatchEvent(new Event('resize'));
          mediaQuery.dispatchEvent(new Event('change'));
          document.dispatchEvent(new Event('visibilitychange'));
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      });
      expect(rendererHarness.resize).not.toHaveBeenCalled();
      expect(rendererHarness.installScene).not.toHaveBeenCalled();

      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: 2,
      });
      await act(async () => {
        mediaQuery.dispatchEvent(new Event('change'));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      });
      expect(rendererHarness.resize).toHaveBeenCalledOnce();
      expect(rendererHarness.installScene).toHaveBeenCalledOnce();
      expect(
        (rendererHarness.installScene.mock.calls[0]?.[0] as BoardScene).viewport
          .devicePixelRatio
      ).toBe(2);

      await act(async () => root.unmount());
      expect(removeWindowListener).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      );
      expect(removeDocumentListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
      expect(removeResolutionListener).toHaveBeenCalledTimes(2);
      expect(listeners.size).toBe(0);

      rendererHarness.resize.mockClear();
      window.dispatchEvent(new Event('resize'));
      mediaQuery.dispatchEvent(new Event('change'));
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      expect(rendererHarness.resize).not.toHaveBeenCalled();
    } finally {
      removeWindowListener.mockRestore();
      removeDocumentListener.mockRestore();
      globalThis.matchMedia = nativeMatchMedia;
      if (nativeDevicePixelRatio) {
        Object.defineProperty(
          window,
          'devicePixelRatio',
          nativeDevicePixelRatio
        );
      } else {
        Reflect.deleteProperty(window, 'devicePixelRatio');
      }
    }
  });
});
