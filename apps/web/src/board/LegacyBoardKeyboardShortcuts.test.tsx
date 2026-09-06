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
        key: '3',
        code: 'Digit3',
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
