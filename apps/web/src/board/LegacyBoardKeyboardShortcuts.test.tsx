// @vitest-environment happy-dom

import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KEYMAP,
  keymapFor,
  parseHotkeyOverrides,
} from '../hotkeys/keymap.js';
import { createInitialBoardSessionControllerState } from './BoardSessionController.js';
import {
  isLegacyBoardShortcutEditableTarget,
  LegacyBoardKeyboardShortcuts,
} from './LegacyBoardKeyboardShortcuts.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('legacy board keyboard shortcut bridge', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('emits one closed request for the selected stable card and prevents the key default', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
        })
      );
    });
    const target = document.createElement('button');
    document.body.append(target);
    const event = new KeyboardEvent('keydown', {
      key: 'W',
      code: 'KeyW',
      bubbles: true,
      cancelable: true,
    });
    expect(target.dispatchEvent(event)).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'toggleAbility',
      cardId: 'selected-card',
    });
    target.remove();
  });

  it('allows only the exact selected card in the exact opened zone through the overlay guard', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
              openedZoneId: 'selected-zone',
            },
          },
          onRequest,
        })
      );
    });
    const overlays = document.createElement('div');
    overlays.dataset.legacyBoardOverlays = 'true';
    const zone = document.createElement('section');
    zone.dataset.legacyZoneBrowser = 'true';
    zone.dataset.zoneBrowserId = 'selected-zone';
    const selected = document.createElement('button');
    selected.dataset.overlayCardId = 'selected-card';
    const other = document.createElement('button');
    other.dataset.overlayCardId = 'other-card';
    const toolbar = document.createElement('button');
    zone.append(selected, other, toolbar);
    overlays.append(zone);
    document.body.append(overlays);

    const shortcut = () =>
      new KeyboardEvent('keydown', {
        key: 'W',
        code: 'KeyW',
        bubbles: true,
        cancelable: true,
      });
    expect(selected.dispatchEvent(shortcut())).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'toggleAbility',
      cardId: 'selected-card',
    });
    onRequest.mockClear();
    expect(other.dispatchEvent(shortcut())).toBe(true);
    expect(toolbar.dispatchEvent(shortcut())).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    overlays.remove();
  });

  it('emits global loose-board requests without requiring a selection', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    const discard = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    expect(document.dispatchEvent(discard)).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
        bubbles: true,
      })
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        bubbles: true,
      })
    );
    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'resolveOwnLooseBoard', destination: 'discard' },
      { action: 'resolveOwnLooseBoard', destination: 'hand' },
      { action: 'resolveOwnLooseBoard', destination: 'shuffleIntoDeck' },
    ]);
  });

  it('emits one closed unselected deck request for each supported chord', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    for (const init of [
      { key: '3', code: 'Digit3' },
      { key: '3', code: 'Digit3', altKey: true },
      { key: '3', code: 'Digit3', ctrlKey: true },
      { key: 's', code: 'KeyS' },
    ]) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          ...init,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '3',
        code: 'Digit3',
        altKey: true,
        ctrlKey: true,
        bubbles: true,
      })
    );

    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'drawOwnDeck', count: 3 },
      { action: 'inspectOwnDeck', count: 3, edge: 'top' },
      { action: 'inspectOwnDeck', count: 3, edge: 'bottom' },
      { action: 'shuffleOwnDeck' },
    ]);
  });

  it('emits a global coin flip with or without a selected card', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    const unselected = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      bubbles: true,
      cancelable: true,
    });
    expect(document.dispatchEvent(unselected)).toBe(true);

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
        })
      );
    });
    const selected = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      bubbles: true,
      cancelable: true,
    });
    expect(document.dispatchEvent(selected)).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        altKey: true,
        bubbles: true,
      })
    );

    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'flipCoin' },
      { action: 'flipCoin' },
    ]);
  });

  it('routes lifecycle keys only through the unselected branch', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    for (const code of ['KeyN', 'KeyR', 'KeyT']) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: code.slice(-1).toLowerCase(),
          code,
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
        })
      );
    });
    for (const code of ['KeyN', 'KeyR', 'KeyT']) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: code.slice(-1).toLowerCase(),
          code,
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'setupOwnPlayer' },
      { action: 'resetOwnPlayer' },
      { action: 'startOwnTurn' },
      {
        action: 'rotateSelectedCard',
        cardId: 'selected-card',
        single: true,
      },
      {
        action: 'changeCardType',
        cardId: 'selected-card',
        category: 'Trainer',
      },
    ]);
  });

  it('acts once for a held key, and keeps its repeats from the browser', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });
    const press = (repeat: boolean) => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        code: 'KeyN',
        altKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event;
    };
    press(false);
    const repeats = Array.from({ length: 20 }, () => press(true));
    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'setupOwnPlayer' },
    ]);
    expect(repeats.every((event) => event.defaultPrevented)).toBe(true);
    // Let go and press again: that is a new press.
    press(false);
    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('routes prompt-driven hand keys only while unselected and preserves source defaults', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    const dispatch = (key: string, code: string) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code,
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    expect(dispatch('d', 'KeyD')).toBe(false);
    expect(dispatch('s', 'KeyS')).toBe(true);
    expect(dispatch('ArrowDown', 'ArrowDown')).toBe(true);

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
        })
      );
    });
    expect(dispatch('d', 'KeyD')).toBe(false);
    expect(dispatch('s', 'KeyS')).toBe(false);
    expect(dispatch('ArrowDown', 'ArrowDown')).toBe(false);

    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      { action: 'discardOwnHandAndDraw' },
      { action: 'shuffleOwnHandAndDraw' },
      { action: 'shuffleOwnHandToDeckBottomAndDraw' },
    ]);
  });

  it('leaves keys alone inside dialogs and while a count prompt is open', async () => {
    const onRequest = vi.fn();
    const onDismissPresentation = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const render = async (
      input: (typeof state)['overlays']['input']
    ): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardKeyboardShortcuts, {
            state: { ...state, overlays: { ...state.overlays, input } },
            onRequest,
            onDismissPresentation,
          })
        );
      });
    };
    const altD = () =>
      new KeyboardEvent('keydown', {
        key: 'd',
        code: 'KeyD',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
    const escape = () =>
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      });
    await render(null);

    // A confirmation's buttons are not table targets: its keys are its own.
    const dialog = document.createElement('div');
    dialog.setAttribute('data-ptcgsim-overlay', 'alert');
    const confirmButton = document.createElement('button');
    dialog.append(confirmButton);
    document.body.append(dialog);
    expect(confirmButton.dispatchEvent(altD())).toBe(true);
    expect(confirmButton.dispatchEvent(escape())).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    expect(onDismissPresentation).not.toHaveBeenCalled();
    // Once answered, a dialog only animates out: a quick next shortcut
    // pressed while focus is still in it reaches the table.
    dialog.setAttribute('data-closed', '');
    expect(confirmButton.dispatchEvent(altD())).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'discardOwnHandAndDraw',
    });
    onRequest.mockClear();
    dialog.remove();

    // Alt+D's question is modal, as v1's native prompt was: a repeated or
    // stray key cannot ask again or act on the table underneath.
    await render({
      kind: 'shortcutCount',
      action: 'discardOwnHandAndDraw',
      playerId: 'player-1',
      zoneId: 'zone:player-1:hand',
      message: 'Draw how many cards?',
      initialValue: '0',
      minimum: 0,
      invalidMessage: 'Please enter a valid number for the draw amount.',
    });
    expect(document.body.dispatchEvent(altD())).toBe(true);
    expect(document.body.dispatchEvent(escape())).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    expect(onDismissPresentation).not.toHaveBeenCalled();

    await render(null);
    expect(document.body.dispatchEvent(altD())).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'discardOwnHandAndDraw',
    });
  });

  it('routes U only for an undo-capable unselected surface', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const dispatch = (target: EventTarget = document) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'u',
          code: 'KeyU',
          bubbles: true,
          cancelable: true,
        })
      );

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          undoSeat: 'acting',
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'undoOwnLastMove',
    });

    // A multiplayer route asks for the player's own move, flipped or not.
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          undoSeat: 'own',
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onRequest).toHaveBeenLastCalledWith({
      action: 'undoOwnLastMove',
      ownSeat: true,
    });
    onRequest.mockClear();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          undoSeat: 'acting',
        })
      );
    });
    expect(dispatch()).toBe(false);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(dispatch(input)).toBe(true);
    input.remove();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('routes modifier-agnostic M through the separate unselected announcement callback', async () => {
    const onRequest = vi.fn();
    const onDeclareMulligan = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const dispatch = (
      target: EventTarget = document,
      init: KeyboardEventInit = {}
    ) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'm',
          code: 'KeyM',
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          onDeclareMulligan,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(dispatch(document, { altKey: true })).toBe(true);
    expect(dispatch(document, { key: 'M', shiftKey: true })).toBe(true);
    expect(onDeclareMulligan).toHaveBeenCalledTimes(3);
    expect(onRequest).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          onDeclareMulligan,
        })
      );
    });
    expect(dispatch()).toBe(false);

    const input = document.createElement('input');
    document.body.append(input);
    expect(dispatch(input)).toBe(true);
    input.remove();
    expect(onDeclareMulligan).toHaveBeenCalledTimes(3);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('separates unselected R refresh from selected group/single rotation and suppresses full preview', async () => {
    const onRequest = vi.fn();
    const onRefreshScene = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const dispatch = (init: KeyboardEventInit = {}) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'r',
          code: 'KeyR',
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          onRefreshScene,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(dispatch({ ctrlKey: true })).toBe(true);
    expect(dispatch({ key: 'R', shiftKey: true })).toBe(true);
    expect(dispatch({ altKey: true })).toBe(true);
    expect(onRefreshScene).toHaveBeenCalledTimes(4);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'resetOwnPlayer',
    });
    expect(onRefreshScene.mock.invocationCallOrder[3]).toBeLessThan(
      onRequest.mock.invocationCallOrder[0]!
    );

    onRequest.mockClear();
    onRefreshScene.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          onRefreshScene,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(dispatch({ altKey: true })).toBe(false);
    expect(onRequest.mock.calls.map(([request]) => request)).toEqual([
      {
        action: 'rotateSelectedCard',
        cardId: 'selected-card',
        single: false,
      },
      {
        action: 'rotateSelectedCard',
        cardId: 'selected-card',
        single: true,
      },
    ]);
    expect(onRefreshScene).not.toHaveBeenCalled();

    onRequest.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            overlays: {
              ...state.overlays,
              preview: { kind: 'card', cardId: 'preview-card' },
            },
          },
          onRequest,
          onRefreshScene,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(dispatch({ altKey: true })).toBe(false);
    expect(onRequest).not.toHaveBeenCalled();
    expect(onRefreshScene).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            view: {
              ...createRendererSpikeView(),
              viewer: { kind: 'spectator' },
            },
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          onRefreshScene,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    expect(onRefreshScene).not.toHaveBeenCalled();
  });

  it('routes Alt-F only through an eligible local board-flip seam', async () => {
    const onRequest = vi.fn();
    const onFlipBoard = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const dispatch = (
      target: EventTarget = document,
      init: KeyboardEventInit = {}
    ) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          altKey: true,
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          onFlipBoard,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(onFlipBoard).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          onFlipBoard,
          boardFlipEnabled: true,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(dispatch(document, { ctrlKey: true })).toBe(false);
    expect(dispatch(document, { key: 'F', shiftKey: true })).toBe(false);
    expect(onFlipBoard).toHaveBeenCalledTimes(3);

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          onFlipBoard,
          boardFlipEnabled: true,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(onFlipBoard).toHaveBeenCalledTimes(4);

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            view: {
              ...createRendererSpikeView(),
              viewer: { kind: 'spectator' },
            },
          },
          onRequest,
          onFlipBoard,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(onFlipBoard).toHaveBeenCalledTimes(5);

    const input = document.createElement('input');
    document.body.append(input);
    expect(dispatch(input)).toBe(true);
    input.remove();
    const overlay = document.createElement('div');
    overlay.dataset.legacyBoardOverlays = 'true';
    const overlayButton = document.createElement('button');
    overlay.append(overlayButton);
    document.body.append(overlay);
    expect(dispatch(overlayButton)).toBe(true);
    overlay.remove();
    expect(onFlipBoard).toHaveBeenCalledTimes(5);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('routes V to local deck/card presentation before its player announcement', async () => {
    const onRequest = vi.fn();
    const onLocalIntent = vi.fn();
    const onDeclareDeckView = vi.fn();
    const initial = createInitialBoardSessionControllerState();
    const view = createRendererSpikeView();
    if (view.viewer.kind !== 'player') throw new Error('player view required');
    const scene = createBoardSceneForViewport(view, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: view.viewer.playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const deck = scene.zones.find(
      (zone) => zone.kind === 'deck' && zone.playerId === view.viewer.playerId
    )!;
    const selectedCard = scene.cards.find((card) =>
      card.parentId.includes(':active')
    )!;
    const state = { ...initial, view, scene };
    const dispatch = (init: KeyboardEventInit = {}) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'v',
          code: 'KeyV',
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state,
          onRequest,
          onLocalIntent,
          onDeclareDeckView,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(dispatch({ ctrlKey: true })).toBe(true);
    expect(dispatch({ key: 'V', shiftKey: true })).toBe(true);
    expect(dispatch({ altKey: true })).toBe(true);
    expect(onLocalIntent.mock.calls.map(([intent]) => intent)).toEqual(
      Array.from({ length: 4 }, () => ({
        kind: 'ZoneOpened',
        zoneId: deck.id,
      }))
    );
    expect(onDeclareDeckView).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 4; index += 1) {
      expect(onLocalIntent.mock.invocationCallOrder[index]).toBeLessThan(
        onDeclareDeckView.mock.invocationCallOrder[index]!
      );
    }
    expect(onRequest).not.toHaveBeenCalled();

    onLocalIntent.mockClear();
    onDeclareDeckView.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: selectedCard.id,
            },
          },
          onRequest,
          onLocalIntent,
          onDeclareDeckView,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(dispatch({ altKey: true })).toBe(false);
    expect(onLocalIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { kind: 'CardPreviewRequested', cardId: selectedCard.id },
      { kind: 'CardPreviewRequested', cardId: selectedCard.id },
    ]);
    expect(onDeclareDeckView).not.toHaveBeenCalled();

    onLocalIntent.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            overlays: {
              ...state.overlays,
              preview: { kind: 'card', cardId: selectedCard.id },
            },
          },
          onRequest,
          onLocalIntent,
          onDeclareDeckView,
        })
      );
    });
    expect(dispatch()).toBe(false);
    expect(onLocalIntent).not.toHaveBeenCalled();

    const spectatorView = { ...view, viewer: { kind: 'spectator' } as const };
    onLocalIntent.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            view: spectatorView,
            presentation: {
              ...state.presentation,
              selectedCardId: selectedCard.id,
            },
          },
          onRequest,
          onLocalIntent,
          onDeclareDeckView,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardPreviewRequested',
      cardId: selectedCard.id,
    });
    expect(onDeclareDeckView).not.toHaveBeenCalled();

    onLocalIntent.mockClear();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: { ...state, view: spectatorView },
          onRequest,
          onLocalIntent,
          onDeclareDeckView,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'ZoneOpened',
      zoneId: deck.id,
    });
    expect(onDeclareDeckView).not.toHaveBeenCalled();
  });

  it('does not let global shortcuts collide with overlays or native card and zone activation', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });

    const overlay = document.createElement('div');
    overlay.dataset.legacyBoardOverlays = 'true';
    const menuItem = document.createElement('button');
    menuItem.setAttribute('role', 'menuitem');
    overlay.append(menuItem);
    const card = document.createElement('button');
    card.dataset.cardId = 'card-1';
    const zone = document.createElement('button');
    zone.dataset.zoneId = 'zone-1';
    document.body.append(overlay, card, zone);

    for (const target of [menuItem, card, zone]) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    }
    menuItem.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        bubbles: true,
      })
    );
    menuItem.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        bubbles: true,
      })
    );

    expect(onRequest).not.toHaveBeenCalled();

    card.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        bubbles: true,
      })
    );
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'resolveOwnLooseBoard',
      destination: 'shuffleIntoDeck',
    });

    overlay.remove();
    card.remove();
    zone.remove();
  });

  it('toggles the shortcuts list with ? for what the keys do now, and leaves Shift alone', async () => {
    const onRequest = vi.fn();
    const onToggleShortcuts = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const render = (selectedCardId: string | null) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardKeyboardShortcuts, {
            state: {
              ...state,
              presentation: { ...state.presentation, selectedCardId },
            },
            onRequest,
            onToggleShortcuts,
            keymap: DEFAULT_KEYMAP,
          })
        );
      });
    const press = (target: EventTarget, init: KeyboardEventInit) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
    const questionMark = {
      key: '?',
      code: 'Slash',
      shiftKey: true,
    } as const;
    await render(null);
    // Holding Shift no longer pops a sheet over the table: Shift+G and the
    // player's own Shift chords need it.
    expect(
      press(document, { key: 'Shift', code: 'ShiftLeft', shiftKey: true })
    ).toBe(true);
    expect(onToggleShortcuts).not.toHaveBeenCalled();
    // `?` is Shift+/; it must never shuffle the board into the deck.
    expect(press(document, questionMark)).toBe(false);
    expect(onToggleShortcuts).toHaveBeenCalledExactlyOnceWith('table');
    expect(onRequest).not.toHaveBeenCalled();

    await render('selected-card');
    expect(press(document, questionMark)).toBe(false);
    expect(onToggleShortcuts).toHaveBeenLastCalledWith('card');

    // Typing a question keeps its question mark.
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(input, questionMark)).toBe(true);
    expect(onToggleShortcuts).toHaveBeenCalledTimes(2);
    input.remove();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("reads the player's own keys: a moved shortcut answers to its new key only", async () => {
    const onRequest = vi.fn();
    const onToggleShortcuts = vi.fn();
    const state = createInitialBoardSessionControllerState();
    const keymap = keymapFor(
      parseHotkeyOverrides({
        'card.toDiscard': 'k',
        'table.undo': 'shift+j',
        'table.shortcuts': 'ctrl+k',
      })
    );
    const render = (selectedCardId: string | null) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardKeyboardShortcuts, {
            state: {
              ...state,
              presentation: { ...state.presentation, selectedCardId },
            },
            onRequest,
            onToggleShortcuts,
            keymap,
            undoSeat: 'acting',
          })
        );
      });
    const press = (init: KeyboardEventInit) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
    await render('selected-card');
    // v1's D (with or without Ctrl or Shift) no longer discards.
    expect(press({ key: 'd', code: 'KeyD' })).toBe(true);
    expect(press({ key: 'd', code: 'KeyD', ctrlKey: true })).toBe(true);
    expect(press({ key: 'D', code: 'KeyD', shiftKey: true })).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    // K does, and the browser keeps out of it.
    expect(press({ key: 'k', code: 'KeyK' })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'moveCardToZone',
      cardId: 'selected-card',
      destination: 'discard',
    });
    // Untouched keys keep v1's handling exactly.
    onRequest.mockClear();
    expect(press({ key: 'h', code: 'KeyH' })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'moveCardToZone',
      cardId: 'selected-card',
      destination: 'hand',
    });

    onRequest.mockClear();
    await render(null);
    expect(press({ key: 'u', code: 'KeyU' })).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    expect(press({ key: 'J', code: 'KeyJ', shiftKey: true })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'undoOwnLastMove',
    });
    // With the list moved to Ctrl+K, `?` does nothing at all -- in
    // particular it does not fall back to / and shuffle the board away.
    onRequest.mockClear();
    expect(press({ key: '?', code: 'Slash', shiftKey: true })).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
    expect(onToggleShortcuts).not.toHaveBeenCalled();
    expect(press({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false);
    expect(onToggleShortcuts).toHaveBeenCalledExactlyOnceWith('table');
  });

  it('dismisses local presentation with native Escape semantics outside protected targets', async () => {
    const onRequest = vi.fn();
    const onDismissPresentation = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
          onDismissPresentation,
        })
      );
    });

    const target = document.createElement('button');
    const input = document.createElement('input');
    const overlay = document.createElement('div');
    const overlayButton = document.createElement('button');
    overlay.dataset.legacyBoardOverlays = 'true';
    overlay.append(overlayButton);
    document.body.append(target, input, overlay);

    for (const init of [
      { key: 'Escape', code: 'Escape' },
      { key: 'Escape', code: 'Escape', ctrlKey: true },
      { key: 'Unidentified', code: 'Escape', altKey: true, shiftKey: true },
    ]) {
      expect(
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            ...init,
            bubbles: true,
            cancelable: true,
          })
        )
      ).toBe(true);
    }
    expect(onDismissPresentation).toHaveBeenCalledTimes(3);
    expect(onRequest).not.toHaveBeenCalled();

    for (const protectedTarget of [input, overlayButton]) {
      expect(
        protectedTarget.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        )
      ).toBe(true);
    }
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    target.dispatchEvent(composing);
    const consumed = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    target.dispatchEvent(consumed);

    expect(onDismissPresentation).toHaveBeenCalledTimes(3);
    expect(onRequest).not.toHaveBeenCalled();
    target.remove();
    input.remove();
    overlay.remove();
  });

  it('ignores unselected, composing, already-consumed, and editable-target keys', async () => {
    const onRequest = vi.fn();
    const state = createInitialBoardSessionControllerState();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, { state, onRequest })
      );
    });
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(onRequest).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: {
            ...state,
            presentation: {
              ...state.presentation,
              selectedCardId: 'selected-card',
            },
          },
          onRequest,
        })
      );
    });
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const tableCell = document.createElement('td');
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    const legacyMarker = document.createElement('div');
    legacyMarker.className = 'self-circle';
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    const nested = document.createElement('span');
    editor.append(nested);
    document.body.append(
      input,
      textarea,
      select,
      tableCell,
      textbox,
      legacyMarker,
      editor
    );
    for (const target of [
      input,
      textarea,
      select,
      tableCell,
      textbox,
      legacyMarker,
      nested,
    ]) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '3',
          code: 'Digit3',
          bubbles: true,
          cancelable: true,
        })
      );
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          bubbles: true,
          cancelable: true,
        })
      );
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          bubbles: true,
          cancelable: true,
        })
      );
      for (const code of ['KeyN', 'KeyR', 'KeyT']) {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: code.slice(-1).toLowerCase(),
            code,
            altKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }
    const composing = new KeyboardEvent('keydown', {
      key: '3',
      code: 'Digit3',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    document.dispatchEvent(composing);
    const consumed = new KeyboardEvent('keydown', {
      key: '3',
      code: 'Digit3',
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onRequest).not.toHaveBeenCalled();
    for (const target of [
      input,
      textarea,
      select,
      tableCell,
      textbox,
      legacyMarker,
      nested,
    ]) {
      expect(isLegacyBoardShortcutEditableTarget(target)).toBe(true);
    }
    expect(isLegacyBoardShortcutEditableTarget(document.body)).toBe(false);
    input.remove();
    textarea.remove();
    select.remove();
    tableCell.remove();
    textbox.remove();
    legacyMarker.remove();
    editor.remove();
  });
});
