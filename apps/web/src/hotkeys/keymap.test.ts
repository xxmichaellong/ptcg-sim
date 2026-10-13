import { describe, expect, it } from 'vitest';

import { chordText, parseChord, type KeyInput } from './chords.js';
import {
  HOTKEY_ACTIONS,
  scopeIncludes,
  type HotkeyActionId,
} from './hotkey-catalogue.js';
import {
  assignHotkey,
  DEFAULT_KEYMAP,
  hotkeyConflicts,
  keymapFor,
  NO_HOTKEY_OVERRIDES,
  parseHotkeyOverrides,
  reservedChord,
  resetHotkey,
  type HotkeyMode,
} from './keymap.js';

const press = (
  key: string,
  code: string,
  modifiers: Partial<
    Pick<KeyInput, 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>
  > = {}
): KeyInput => ({ key, code, altKey: false, ...modifiers });

const chord = (text: string) => parseChord(text)!;

describe('the hotkey catalogue', () => {
  it("keeps v1's keys free of clashes in each situation", () => {
    for (const mode of ['card', 'table'] as const satisfies HotkeyMode[]) {
      const seen = new Map<string, string>();
      for (const entry of HOTKEY_ACTIONS) {
        if (!scopeIncludes(entry.scope, mode)) continue;
        const text = chordText(chord(entry.defaultChord));
        expect(seen.get(text), `${mode}: ${text}`).toBeUndefined();
        seen.set(text, entry.id);
      }
    }
  });

  it('has unique ids and a valid default for each shortcut', () => {
    const ids = HOTKEY_ACTIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of HOTKEY_ACTIONS) {
      expect(parseChord(entry.defaultChord), entry.id).not.toBeNull();
      // Only the fixed ones may sit on a reserved key.
      expect(
        reservedChord(chord(entry.defaultChord), entry.scope) !== null,
        entry.id
      ).toBe('fixed' in entry);
    }
  });
});

describe('the keymap', () => {
  it("resolves v1's keys, with Shift falling back as v1's handling does", () => {
    expect(DEFAULT_KEYMAP.resolve(press('d', 'KeyD'), 'card')).toBe(
      'card.toDiscard'
    );
    expect(
      DEFAULT_KEYMAP.resolve(press('D', 'KeyD', { shiftKey: true }), 'card')
    ).toBe('card.toDiscard');
    expect(
      DEFAULT_KEYMAP.resolve(press('G', 'KeyG', { shiftKey: true }), 'card')
    ).toBe('card.addStadiumPiece');
    expect(
      DEFAULT_KEYMAP.resolve(press('∂', 'KeyD', { altKey: true }), 'table')
    ).toBe('hand.discardAndDraw');
    expect(DEFAULT_KEYMAP.resolve(press('7', 'Digit7'), 'table')).toBe(
      'deck.draw'
    );
    expect(DEFAULT_KEYMAP.resolve(press('7', 'Digit7'), 'card')).toBe(
      'card.addDamage'
    );
    expect(
      DEFAULT_KEYMAP.resolve(press('?', 'Slash', { shiftKey: true }), 'card')
    ).toBe('table.shortcuts');
    expect(DEFAULT_KEYMAP.resolve(press('/', 'Slash'), 'card')).toBe(
      'board.shuffleAllIntoDeck'
    );
    expect(DEFAULT_KEYMAP.resolve(press('d', 'KeyD'), 'table')).toBeNull();
  });

  it("passes every key through untouched while the player has v1's keys", () => {
    for (const input of [
      press('d', 'KeyD'),
      press('r', 'KeyR', { ctrlKey: true }),
      press('x', 'KeyX'),
    ]) {
      expect(DEFAULT_KEYMAP.translate(input, 'card')).toEqual({
        kind: 'default',
      });
    }
  });

  it('turns a moved shortcut into its default key, and its old key into nothing', () => {
    const keymap = keymapFor(
      parseHotkeyOverrides({ 'card.toDiscard': 'k', 'deck.shuffle': 'alt+k' })
    );
    const moved = keymap.translate(press('k', 'KeyK'), 'card');
    expect(moved).toMatchObject({
      kind: 'moved',
      action: 'card.toDiscard',
      input: { key: 'd', code: 'KeyD', altKey: false },
    });
    expect(keymap.translate(press('d', 'KeyD'), 'card').kind).toBe('freed');
    expect(
      keymap.translate(press('d', 'KeyD', { ctrlKey: true }), 'card').kind
    ).toBe('freed');
    // The key is only freed where its shortcut worked.
    expect(keymap.translate(press('d', 'KeyD'), 'table').kind).toBe('default');
    expect(keymap.translate(press('s', 'KeyS'), 'table').kind).toBe('freed');
    expect(keymap.translate(press('s', 'KeyS'), 'card').kind).toBe('default');
    expect(
      keymap.translate(press('˚', 'KeyK', { altKey: true }), 'table')
    ).toMatchObject({
      kind: 'moved',
      input: { key: 's', code: 'KeyS', altKey: false },
    });
    // Unchanged shortcuts keep their exact key press.
    expect(keymap.translate(press('h', 'KeyH'), 'card').kind).toBe('default');
  });

  it('keeps ? from falling back to / once the list has moved', () => {
    const keymap = keymapFor(
      parseHotkeyOverrides({ 'table.shortcuts': 'ctrl+k' })
    );
    const question = press('?', 'Slash', { shiftKey: true });
    expect(keymap.resolve(question, 'table')).toBeNull();
    expect(keymap.translate(question, 'table').kind).toBe('freed');
  });

  it('keeps number keys, Esc and Tab out of reach', () => {
    expect(reservedChord(chord('5'), 'table')).toEqual({
      kind: 'fixed',
      action: 'deck.draw',
    });
    expect(reservedChord(chord('5'), 'card')).toEqual({
      kind: 'fixed',
      action: 'card.addDamage',
    });
    expect(reservedChord(chord('alt+3'), 'table')).toEqual({
      kind: 'fixed',
      action: 'deck.viewTop',
    });
    expect(reservedChord(chord('0'))).toEqual({
      kind: 'fixed',
      action: 'card.clearDamage',
    });
    expect(reservedChord(chord('ctrl+escape'))?.kind).toBe('fixed');
    expect(reservedChord(chord('tab'))).toEqual({ kind: 'focus' });
    expect(reservedChord(chord('!'))).toBeNull();
  });
});

describe('changing shortcuts', () => {
  const ids = (list: readonly HotkeyActionId[]) => [...list].sort();

  it('stores only real changes, dropping unknown, fixed and default entries', () => {
    expect(
      parseHotkeyOverrides({
        'card.toHand': 'x',
        'card.toDiscard': 'd',
        'deck.draw': 'k',
        'not.a.shortcut': 'y',
        'card.toBench': 'alt+',
        'card.toActive': '5',
        'card.toPrizes': null,
      })
    ).toEqual({ 'card.toHand': 'x', 'card.toPrizes': null });
    expect(parseHotkeyOverrides(['x'])).toBe(NO_HOTKEY_OVERRIDES);
    expect(parseHotkeyOverrides('x')).toBe(NO_HOTKEY_OVERRIDES);
  });

  it('only counts clashes that could be pressed at the same moment', () => {
    // R rotates a selected card and refreshes images otherwise.
    expect(
      hotkeyConflicts(DEFAULT_KEYMAP, 'table.refreshImages', chord('r'))
    ).toEqual([]);
    expect(
      ids(hotkeyConflicts(DEFAULT_KEYMAP, 'card.toHand', chord('f')))
    ).toEqual(['table.flipCoin']);
    expect(
      ids(hotkeyConflicts(DEFAULT_KEYMAP, 'table.flipCoin', chord('s')))
    ).toEqual(['card.shuffleIntoDeck', 'deck.shuffle']);
  });

  it('swaps keys, or clears the other shortcut', () => {
    const swapped = assignHotkey(
      NO_HOTKEY_OVERRIDES,
      'card.toHand',
      chord('d'),
      'swap'
    );
    expect(swapped).toEqual({ 'card.toHand': 'd', 'card.toDiscard': 'h' });
    const cleared = assignHotkey(
      NO_HOTKEY_OVERRIDES,
      'card.toHand',
      chord('d'),
      'clear'
    );
    expect(cleared).toEqual({ 'card.toHand': 'd', 'card.toDiscard': null });
    // Swapping back is no change at all.
    expect(assignHotkey(swapped, 'card.toHand', chord('h'), 'swap')).toEqual(
      {}
    );
  });

  it('clears instead of swapping when the old key would clash elsewhere', () => {
    // Flip coin works everywhere; R would clash with Refresh images.
    expect(
      assignHotkey(NO_HOTKEY_OVERRIDES, 'card.rotate', chord('f'), 'swap')
    ).toEqual({ 'card.rotate': 'f', 'table.flipCoin': null });
  });

  it("resets one shortcut to v1's key, taking it back from whoever had it", () => {
    const moved = assignHotkey(
      NO_HOTKEY_OVERRIDES,
      'card.toHand',
      chord('x'),
      'clear'
    );
    const taken = assignHotkey(moved, 'card.toDiscard', chord('h'), 'clear');
    expect(taken).toEqual({ 'card.toHand': 'x', 'card.toDiscard': 'h' });
    expect(resetHotkey(taken, 'card.toHand')).toEqual({
      'card.toDiscard': null,
    });
  });
});
