// @vitest-environment happy-dom

import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('routes U only for a solo-capable unselected surface', async () => {
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
          soloUndoEnabled: true,
        })
      );
    });
    expect(dispatch()).toBe(true);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'undoOwnLastMove',
    });

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
          soloUndoEnabled: true,
        })
      );
    });
    expect(dispatch()).toBe(false);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(dispatch(input)).toBe(true);
    input.remove();
    expect(onRequest).toHaveBeenCalledTimes(1);
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
