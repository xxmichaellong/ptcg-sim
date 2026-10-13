import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
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
