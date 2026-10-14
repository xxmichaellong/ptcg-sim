import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { useMemo } from 'react';

import type { HotkeyActionId } from './hotkey-catalogue.js';
import { chordHint, detectKeyboardPlatform } from './chords.js';
import {
  keymapFor,
  NO_HOTKEY_OVERRIDES,
  parseHotkeyOverrides,
  type HotkeyOverrides,
  type Keymap,
} from './keymap.js';

/** The player's own keyboard shortcuts: only what they changed is kept. */
export const HOTKEY_PREFERENCES = definePreference<HotkeyOverrides>({
  key: 'ptcgsim.hotkeys.v1',
  defaults: NO_HOTKEY_OVERRIDES,
  parse: parseHotkeyOverrides,
});

/** How the shortcuts dialog was last left. */
export interface ShortcutsDialogPreferences {
  /** The keyboard map above the list; hidden leaves more room for the list. */
  readonly showKeyboard: boolean;
}

export const SHORTCUTS_DIALOG_PREFERENCES =
  definePreference<ShortcutsDialogPreferences>({
    key: 'ptcgsim.shortcuts-dialog.v1',
    defaults: Object.freeze({ showKeyboard: true }),
    parse: (value) => ({
      showKeyboard:
        typeof value !== 'object' ||
        value === null ||
        Reflect.get(value, 'showKeyboard') !== false,
    }),
  });

/** The page's keymap now; re-renders when the player changes a shortcut. */
export const useKeymap = (store: PreferenceStore = preferences()): Keymap =>
  keymapFor(usePreference(HOTKEY_PREFERENCES, store));

/**
 * The key that does an action, as a short hint for a button's tooltip or a
 * menu row (`M`, `Alt+T`, `⌥T`); undefined when the player freed it.
 */
export const useHotkeyHints = (
  store: PreferenceStore = preferences()
): ((id: HotkeyActionId) => string | undefined) => {
  const keymap = useKeymap(store);
  return useMemo(() => {
    const platform = detectKeyboardPlatform();
    return (id) => {
      const chord = keymap.chord(id);
      return chord ? chordHint(chord, platform) : undefined;
    };
  }, [keymap]);
};
