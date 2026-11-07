import {
  chordHint,
  detectKeyboardPlatform,
  type KeyboardPlatform,
} from '../hotkeys/chords.js';
import {
  hotkeyAction,
  type HotkeyActionId,
} from '../hotkeys/hotkey-catalogue.js';
import type { Keymap } from '../hotkeys/keymap.js';

/** How a count's row of number keys reads in a hint. */
export const DIGIT_ROW_LABEL = '1–9';

/**
 * A shortcut's key as a compact menu hint: `Alt+D`, `Shift+G`, `1–9`
 * (`⌥D` on a Mac). It follows the player's own keys; a shortcut they
 * cleared has no hint.
 */
export const shortcutHint = (
  keymap: Keymap,
  id: HotkeyActionId,
  platform: KeyboardPlatform = detectKeyboardPlatform()
): string | undefined => {
  const chord = keymap.chord(id);
  if (!chord) return undefined;
  return 'digits' in hotkeyAction(id)
    ? chordHint(chord, platform, DIGIT_ROW_LABEL)
    : chordHint(chord, platform);
};
