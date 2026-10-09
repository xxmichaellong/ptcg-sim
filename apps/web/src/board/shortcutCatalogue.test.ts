import { describe, expect, it } from 'vitest';

import {
  catalogueShortcut,
  SHORTCUT_REFERENCE_GROUPS,
  shortcutChords,
  shortcutHint,
} from './shortcutCatalogue.js';

describe('shortcut catalogue', () => {
  it('keeps v1 reference groups in reading order', () => {
    expect(SHORTCUT_REFERENCE_GROUPS.map((group) => group.heading)).toEqual([
      'Move card...',
      'Deck',
      'Hand',
      'Playboard',
      'Card actions',
      'General',
    ]);
    expect(
      SHORTCUT_REFERENCE_GROUPS.flatMap((group) => group.entries)
    ).toHaveLength(53);
  });

  it('looks entries up by heading and label', () => {
    expect(catalogueShortcut({ heading: 'Hand', label: 'Discard hand' })).toBe(
      '[alt + d]'
    );
    expect(
      catalogueShortcut({ heading: 'Card actions', label: 'Damage counter' })
    ).toBeUndefined();
    expect(
      catalogueShortcut({ heading: 'Deck', label: 'Discard hand' })
    ).toBeUndefined();
  });

  it('splits catalogue text into chords of named keys', () => {
    expect(shortcutChords('[q]')).toEqual([['Q']]);
    expect(shortcutChords('[alt + 1-9]')).toEqual([['Alt', '1–9']]);
    expect(shortcutChords('[ctrl + 1-9]')).toEqual([['Ctrl', '1–9']]);
    expect(shortcutChords('[space]')).toEqual([['Space']]);
    expect(shortcutChords('[alt + enter]')).toEqual([['Alt', 'Enter']]);
    expect(shortcutChords('[alt + ↓]')).toEqual([['Alt', '↓']]);
    expect(shortcutChords('[/]')).toEqual([['/']]);
    expect(shortcutChords('[z] → [a]')).toEqual([['Z'], ['A']]);
  });

  it('formats compact menu hints', () => {
    expect(shortcutHint('[alt + d]')).toBe('Alt+D');
    expect(shortcutHint('[1-9]')).toBe('1–9');
    expect(shortcutHint('[esc]')).toBe('Esc');
    expect(shortcutHint('[z] → [a]')).toBe('Z → A');
  });
});
