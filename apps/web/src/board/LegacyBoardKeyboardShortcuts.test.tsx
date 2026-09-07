// @vitest-environment happy-dom

import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
