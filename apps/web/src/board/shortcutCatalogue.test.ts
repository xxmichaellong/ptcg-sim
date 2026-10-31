import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KEYMAP,
  keymapFor,
  parseHotkeyOverrides,
} from '../hotkeys/keymap.js';
import { shortcutHint } from './shortcutCatalogue.js';

describe('shortcut hints', () => {
  it("formats v1's keys as compact menu hints", () => {
    expect(shortcutHint(DEFAULT_KEYMAP, 'hand.discardAndDraw', 'other')).toBe(
      'Alt+D'
    );
    expect(
      shortcutHint(DEFAULT_KEYMAP, 'hand.shuffleToBottomAndDraw', 'other')
    ).toBe('Alt+↓');
    expect(shortcutHint(DEFAULT_KEYMAP, 'card.addStadiumPiece', 'other')).toBe(
      'Shift+G'
    );
    expect(shortcutHint(DEFAULT_KEYMAP, 'card.toBoard', 'other')).toBe('Space');
    expect(shortcutHint(DEFAULT_KEYMAP, 'table.closePopups', 'other')).toBe(
      'Esc'
    );
  });

  it('names a count by its row of number keys', () => {
    expect(shortcutHint(DEFAULT_KEYMAP, 'deck.draw', 'other')).toBe('1–9');
    expect(shortcutHint(DEFAULT_KEYMAP, 'deck.viewTop', 'other')).toBe(
      'Alt+1–9'
    );
    expect(shortcutHint(DEFAULT_KEYMAP, 'deck.viewBottom', 'other')).toBe(
      'Ctrl+1–9'
    );
  });

  it('uses Mac symbols on a Mac', () => {
    expect(shortcutHint(DEFAULT_KEYMAP, 'hand.discardAndDraw', 'mac')).toBe(
      '⌥D'
    );
    expect(shortcutHint(DEFAULT_KEYMAP, 'deck.viewTop', 'mac')).toBe('⌥1–9');
  });

  it("follows the player's own keys, and a cleared shortcut has none", () => {
    const keymap = keymapFor(
      parseHotkeyOverrides({
        'hand.discardAndDraw': 'ctrl+shift+d',
        'deck.shuffle': null,
      })
    );
    expect(shortcutHint(keymap, 'hand.discardAndDraw', 'other')).toBe(
      'Ctrl+Shift+D'
    );
    expect(shortcutHint(keymap, 'deck.shuffle', 'other')).toBeUndefined();
  });
});
