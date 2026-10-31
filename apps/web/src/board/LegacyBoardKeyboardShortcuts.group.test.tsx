// @vitest-environment happy-dom

import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ViewCardId } from '@ptcgsim/game-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keymapFor, parseHotkeyOverrides } from '../hotkeys/keymap.js';
import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from './BoardSessionController.js';
import { BLUE, groupTable } from './group-table.test-support.js';
import { LegacyBoardKeyboardShortcuts } from './LegacyBoardKeyboardShortcuts.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const energy = { category: 'Energy' as const, name: 'Fire Energy' };

describe('the keys with several cards selected (ADR-042)', () => {
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

  const withSelection = (
    selection: readonly string[],
    patch: Partial<BoardSessionControllerState> = {}
  ): BoardSessionControllerState => {
    const state = createInitialBoardSessionControllerState();
    return {
      ...state,
      ...patch,
      presentation: {
        ...state.presentation,
        ...patch.presentation,
        selection: selection as readonly ViewCardId[],
      },
    };
  };
  const press = (init: KeyboardEventInit, target: EventTarget = document) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );

  it('sends each card key as the whole group’s move or mark, Shift or not', async () => {
    const onRequest = vi.fn();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: withSelection(['one', 'two']),
          onRequest,
          onNotice: vi.fn(),
        })
      );
    });
    const cases: [KeyboardEventInit, unknown][] = [
      [
        { key: 'h', code: 'KeyH' },
        { kind: 'send', to: 'hand' },
      ],
      [
        { key: 'd', code: 'KeyD' },
        { kind: 'send', to: 'discard' },
      ],
      [
        { key: 'l', code: 'KeyL' },
        { kind: 'send', to: 'lostZone' },
      ],
      [
        { key: 'p', code: 'KeyP' },
        { kind: 'send', to: 'prizes' },
      ],
      [
        { key: ' ', code: 'Space' },
        { kind: 'send', to: 'board' },
      ],
      [
        { key: 'ArrowUp', code: 'ArrowUp' },
        { kind: 'send', to: 'deckTop' },
      ],
      [
        { key: 'ArrowDown', code: 'ArrowDown' },
        { kind: 'send', to: 'deckBottom' },
      ],
      [
        { key: 's', code: 'KeyS' },
        { kind: 'send', to: 'deckShuffled' },
      ],
      [
        { key: 'b', code: 'KeyB' },
        { kind: 'play', slot: 'bench' },
      ],
      [
        { key: 'a', code: 'KeyA' },
        { kind: 'play', slot: 'active' },
      ],
      [{ key: 'g', code: 'KeyG' }, { kind: 'stadium' }],
      // Shift held after picking cards with it means nothing here.
      [{ key: 'G', code: 'KeyG', shiftKey: true }, { kind: 'stadium' }],
      [
        { key: 'D', code: 'KeyD', shiftKey: true },
        { kind: 'send', to: 'discard' },
      ],
      [
        { key: '3', code: 'Digit3' },
        { kind: 'damage', delta: 30 },
      ],
      [
        { key: '2', code: 'Digit2', altKey: true },
        { kind: 'damage', delta: -20 },
      ],
      [{ key: '0', code: 'Digit0' }, { kind: 'clearDamage' }],
      [
        { key: 'y', code: 'KeyY' },
        { kind: 'condition', remove: false },
      ],
      [
        { key: 'y', code: 'KeyY', altKey: true },
        { kind: 'condition', remove: true },
      ],
      [{ key: 'w', code: 'KeyW' }, { kind: 'ability' }],
      [
        { key: 'z', code: 'KeyZ' },
        { kind: 'reveal', revealed: false },
      ],
      [
        { key: 'z', code: 'KeyZ', altKey: true },
        { kind: 'reveal', revealed: true },
      ],
      [
        { key: 'r', code: 'KeyR' },
        { kind: 'rotate', single: false },
      ],
    ];
    for (const [init, group] of cases) {
      onRequest.mockClear();
      expect(press(init), JSON.stringify(init)).toBe(false);
      expect(onRequest, JSON.stringify(init)).toHaveBeenCalledExactlyOnceWith({
        action: 'groupAction',
        group,
      });
    }
    onRequest.mockClear();
    expect(press({ key: 'q', code: 'KeyQ' })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'beginGroupAttach',
    });
  });

  it('answers a one-card key with a word, holds table keys, and keeps the table’s own keys working', async () => {
    const onRequest = vi.fn();
    const onNotice = vi.fn();
    const onDeclareMulligan = vi.fn();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: withSelection(['one', 'two']),
          onRequest,
          onNotice,
          onDeclareMulligan,
          undoSeat: 'acting',
        })
      );
    });
    for (const init of [
      { key: 'ArrowRight', code: 'ArrowRight' },
      { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true },
      { key: 'c', code: 'KeyC' },
      { key: 'v', code: 'KeyV' },
      { key: 'e', code: 'KeyE', altKey: true },
    ]) {
      onNotice.mockClear();
      expect(press(init), JSON.stringify(init)).toBe(false);
      expect(onNotice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: 'Select one card for that' })
      );
    }
    for (const init of [
      { key: 'd', code: 'KeyD', altKey: true },
      { key: 'u', code: 'KeyU' },
      { key: 'm', code: 'KeyM' },
      { key: 'n', code: 'KeyN', altKey: true },
    ]) {
      onNotice.mockClear();
      expect(press(init), JSON.stringify(init)).toBe(false);
      expect(onNotice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: 'Press Esc to put the cards down' })
      );
    }
    expect(onRequest).not.toHaveBeenCalled();
    expect(onDeclareMulligan).not.toHaveBeenCalled();
    // Enter and the coin are the table's at any time.
    expect(press({ key: 'f', code: 'KeyF' })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({ action: 'flipCoin' });
  });

  it('leaves a spectator’s group alone', async () => {
    const onRequest = vi.fn();
    const table = groupTable();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: withSelection(['one', 'two'], {
            view: { ...table.view, viewer: { kind: 'spectator' } },
          }),
          onRequest,
          onNotice: vi.fn(),
        })
      );
    });
    expect(press({ key: 'd', code: 'KeyD' })).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('takes the focused or pointed-at card in or out with x, and leaves the key alone without one', async () => {
    const onLocalIntent = vi.fn();
    const render = (hovered: string | null) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardKeyboardShortcuts, {
            state: withSelection([], {
              presentation: {
                ...createInitialBoardSessionControllerState().presentation,
                hoveredCardId: hovered as ViewCardId | null,
              },
            }),
            onRequest: vi.fn(),
            onLocalIntent,
          })
        );
      });
    await render(null);
    expect(press({ key: 'x', code: 'KeyX' })).toBe(true);
    expect(onLocalIntent).not.toHaveBeenCalled();
    const card = document.createElement('div');
    card.dataset.cardId = 'focused-card';
    card.tabIndex = 0;
    document.body.append(card);
    expect(press({ key: 'x', code: 'KeyX' }, card)).toBe(false);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: 'focused-card',
      mode: 'add',
    });
    card.remove();
    onLocalIntent.mockClear();
    await render('hovered-card');
    expect(press({ key: 'x', code: 'KeyX' })).toBe(false);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: 'hovered-card',
      mode: 'add',
    });
    // A tile of the open pile takes it too, through the viewer's guard.
    const browser = document.createElement('div');
    browser.dataset.legacyBoardOverlays = '';
    const tile = document.createElement('button');
    tile.dataset.overlayCardId = 'pile-card';
    browser.append(tile);
    document.body.append(browser);
    onLocalIntent.mockClear();
    expect(press({ key: 'x', code: 'KeyX' }, tile)).toBe(false);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: 'pile-card',
      mode: 'add',
    });
    browser.remove();
  });

  it('selects every card where the focused one lies with Ctrl/⌘+A, and leaves the browser its own otherwise', async () => {
    const onLocalIntent = vi.fn();
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    const active = table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]);
    const render = (keymap = keymapFor(parseHotkeyOverrides({}))) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardKeyboardShortcuts, {
            state: withSelection([], {
              view: table.view,
              scene: table.scene(),
            }),
            onRequest: vi.fn(),
            onLocalIntent,
            keymap,
          })
        );
      });
    await render();
    // Nothing focused, nothing selected, no pile open: the browser's.
    expect(press({ key: 'a', code: 'KeyA', ctrlKey: true })).toBe(true);
    expect(onLocalIntent).not.toHaveBeenCalled();
    const focus = (cardId: string) => {
      const element = document.createElement('div');
      element.dataset.cardId = cardId;
      document.body.append(element);
      return element;
    };
    const inHand = focus(hand[1]!);
    expect(press({ key: 'a', code: 'KeyA', ctrlKey: true }, inHand)).toBe(
      false
    );
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: hand,
      mode: 'replace',
    });
    inHand.remove();
    // A Pokémon's place is its seat's Pokémon in play.
    onLocalIntent.mockClear();
    const onBench = focus(benched.top);
    expect(press({ key: 'a', code: 'KeyA', metaKey: true }, onBench)).toBe(
      false
    );
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: [active.top, benched.top],
      mode: 'replace',
    });
    // Moved elsewhere, ⌘A and Ctrl+A are the browser's again.
    onLocalIntent.mockClear();
    await render(keymapFor(parseHotkeyOverrides({ 'select.all': 'alt+a' })));
    expect(press({ key: 'a', code: 'KeyA', metaKey: true }, onBench)).toBe(
      true
    );
    expect(press({ key: 'a', code: 'KeyA', ctrlKey: true }, onBench)).toBe(
      true
    );
    expect(onLocalIntent).not.toHaveBeenCalled();
    expect(press({ key: 'a', code: 'KeyA', altKey: true }, onBench)).toBe(
      false
    );
    expect(onLocalIntent).toHaveBeenCalledOnce();
    onBench.remove();
  });

  it('answers to a moved selection key only', async () => {
    const onLocalIntent = vi.fn();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: withSelection([], {
            presentation: {
              ...createInitialBoardSessionControllerState().presentation,
              hoveredCardId: 'hovered-card' as ViewCardId,
            },
          }),
          onRequest: vi.fn(),
          onLocalIntent,
          keymap: keymapFor(parseHotkeyOverrides({ 'select.toggle': 'j' })),
        })
      );
    });
    expect(press({ key: 'x', code: 'KeyX' })).toBe(true);
    expect(onLocalIntent).not.toHaveBeenCalled();
    expect(press({ key: 'j', code: 'KeyJ' })).toBe(false);
    expect(onLocalIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: 'hovered-card',
      mode: 'add',
    });
  });

  it("reads the player's own Shift key for a group as they bound it", async () => {
    const onRequest = vi.fn();
    await act(async () => {
      root.render(
        createElement(LegacyBoardKeyboardShortcuts, {
          state: withSelection(['one', 'two']),
          onRequest,
          onNotice: vi.fn(),
          keymap: keymapFor(
            parseHotkeyOverrides({ 'card.toDiscard': 'shift+h' })
          ),
        })
      );
    });
    // Shift+H, bound to the discard: the group goes there, not to the hand.
    expect(press({ key: 'H', code: 'KeyH', shiftKey: true })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'groupAction',
      group: { kind: 'send', to: 'discard' },
    });
    // H alone is still the hand.
    onRequest.mockClear();
    expect(press({ key: 'h', code: 'KeyH' })).toBe(false);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      action: 'groupAction',
      group: { kind: 'send', to: 'hand' },
    });
  });
});
