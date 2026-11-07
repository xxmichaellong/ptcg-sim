/**
 * A keyboard shortcut is a chord: one key, pressed with any of Ctrl, Alt,
 * Shift and Meta. Chords are kept as canonical text (`alt+d`, `shift+g`,
 * `?`, `arrowup`), which is what preferences store and lookups key on.
 *
 * A key is named by what the player sees on it where that is plain (`d` on
 * a QWERTY or AZERTY board alike), and by its position where the character
 * is not: Option on a Mac turns D into `∂`, and a Cyrillic layout turns it
 * into `в`. Matching tries both, which is what the board's v1 handling has
 * always done (`event.key === 'd' || event.code === 'KeyD'`).
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export interface KeyChord {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/** The fields of a keyboard event the board reads. */
export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly getModifierState?: (keyArg: string) => boolean;
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ' ': 'space',
  Spacebar: 'space',
  '+': 'plus',
  Enter: 'enter',
  Escape: 'escape',
  Esc: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Up: 'arrowup',
  Down: 'arrowdown',
  Left: 'arrowleft',
  Right: 'arrowright',
};

const CODE_KEYS: Readonly<Record<string, string>> = {
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadDivide: '/',
  NumpadMultiply: '*',
  NumpadSubtract: '-',
  NumpadAdd: 'plus',
  NumpadDecimal: '.',
};

const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Super',
  'Hyper',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
]);

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/u;

/** A plain, printable character such as `d`, `?` or `/` (not `∂` or `в`). */
const isPlainCharacter = (name: string): boolean =>
  name.length === 1 && name >= '!' && name <= '~';

/** The key's name from the character it typed, if it has a usable one. */
export const keyNameFromKey = (key: string): string | null => {
  const named = NAMED_KEYS[key];
  if (named) return named;
  if (FUNCTION_KEY.test(key)) return key.toLowerCase();
  // One visible character (a single code point that is not a control).
  if ([...key].length === 1 && !/\p{Cc}/u.test(key)) return key.toLowerCase();
  return null;
};

/** The key's name from where it sits on a US layout. */
export const keyNameFromCode = (code: string): string | null => {
  const named = CODE_KEYS[code];
  if (named) return named;
  const letter = /^Key([A-Z])$/u.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^(?:Digit|Numpad)(\d)$/u.exec(code);
  if (digit) return digit[1]!;
  if (FUNCTION_KEY.test(code)) return code.toLowerCase();
  return null;
};

export const isModifierKey = (key: string): boolean => MODIFIER_KEYS.has(key);

const modifiersOf = (input: KeyInput) => ({
  ctrl: input.ctrlKey === true,
  // v1 reads Alt from the modifier state as well as the flag.
  alt: input.altKey || input.getModifierState?.('Alt') === true,
  shift: input.shiftKey === true,
  meta: input.metaKey === true,
});

/**
 * Every chord a key press could mean: by its character first, then by its
 * position. A symbol that Shift produced (`?` from `/`) already carries the
 * Shift, so it reads as `?`; by position it is `shift+/`.
 */
export const chordCandidates = (input: KeyInput): readonly KeyChord[] => {
  const modifiers = modifiersOf(input);
  const fromKey = keyNameFromKey(input.key);
  const fromCode = keyNameFromCode(input.code);
  const candidates: KeyChord[] = [];
  if (fromKey !== null) {
    // A typed symbol (not a letter, not a named key) that differs from
    // what the key types unshifted.
    const shiftProducedIt =
      modifiers.shift &&
      [...input.key].length === 1 &&
      !/\p{L}/u.test(input.key) &&
      fromKey !== fromCode;
    candidates.push({
      key: fromKey,
      ...modifiers,
      shift: modifiers.shift && !shiftProducedIt,
    });
  }
  if (fromCode !== null && fromCode !== fromKey) {
    candidates.push({ key: fromCode, ...modifiers });
  }
  return candidates;
};

/**
 * The chord a player means by a key press while choosing a shortcut, or
 * `null` while only modifiers are held. Alt and non-Latin characters name
 * the key by position; everything else by its character.
 */
export const chordFromInput = (input: KeyInput): KeyChord | null => {
  if (isModifierKey(input.key)) return null;
  const candidates = chordCandidates(input);
  const [byCharacter, byPosition] = candidates;
  if (!byCharacter) return null;
  const fromKey = keyNameFromKey(input.key);
  const preferPosition =
    byPosition !== undefined &&
    (byCharacter.alt ||
      (fromKey !== null && fromKey.length === 1 && !isPlainCharacter(fromKey)));
  return preferPosition ? byPosition : byCharacter;
};

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

/** Canonical text: modifiers in a fixed order, then the key. */
export const chordText = (chord: KeyChord): string =>
  [...MODIFIER_ORDER.filter((modifier) => chord[modifier]), chord.key].join(
    '+'
  );

const isKeyName = (name: string): boolean =>
  name.length > 0 &&
  !name.includes('+') &&
  (Object.values(NAMED_KEYS).includes(name) ||
    Object.values(CODE_KEYS).includes(name) ||
    FUNCTION_KEY.test(name.toUpperCase()) ||
    [...name].length === 1);

/** Reads canonical chord text; anything else is `null`. */
export const parseChord = (text: unknown): KeyChord | null => {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) {
    return null;
  }
  const parts = text.split('+');
  const key = parts.pop();
  if (key === undefined || !isKeyName(key)) return null;
  const chord = { key, ctrl: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    if (!(MODIFIER_ORDER as readonly string[]).includes(part)) return null;
    const modifier = part as (typeof MODIFIER_ORDER)[number];
    if (chord[modifier]) return null;
    chord[modifier] = true;
  }
  return chord;
};

export const sameChord = (
  left: KeyChord | null | undefined,
  right: KeyChord | null | undefined
): boolean =>
  left === right ||
  (left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    chordText(left) === chordText(right));

/* ---- Showing chords ---------------------------------------------------- */

export type KeyboardPlatform = 'mac' | 'other';

export const detectKeyboardPlatform = (): KeyboardPlatform => {
  const nav = globalThis.navigator as
    | (Navigator & { readonly userAgentData?: { readonly platform?: string } })
    | undefined;
  const platform = nav?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac|iphone|ipad|ipod/iu.test(platform) ? 'mac' : 'other';
};

/**
 * The words printed on keys, in the player's language (a German keyboard
 * reads Leertaste and Entf). Arrows and symbols read the same everywhere.
 */
const KEY_LABELS: Readonly<Record<string, MessageDescriptor | string>> = {
  space: msg({ message: 'Space', context: 'keyboard key' }),
  enter: msg({ message: 'Enter', context: 'keyboard key' }),
  escape: msg({ message: 'Esc', context: 'keyboard key' }),
  tab: msg({ message: 'Tab', context: 'keyboard key' }),
  backspace: msg({ message: 'Backspace', context: 'keyboard key' }),
  delete: msg({ message: 'Delete', context: 'keyboard key' }),
  insert: msg({ message: 'Insert', context: 'keyboard key' }),
  home: msg({ message: 'Home', context: 'keyboard key' }),
  end: msg({ message: 'End', context: 'keyboard key' }),
  pageup: msg({ message: 'Page Up', context: 'keyboard key' }),
  pagedown: msg({ message: 'Page Down', context: 'keyboard key' }),
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  plus: '+',
};

/** The label printed on a key: `D`, `↑`, `Space`, `?`. */
export const keyLabel = (key: string): string => {
  const label = KEY_LABELS[key];
  if (label === undefined) return key.toUpperCase();
  return typeof label === 'string' ? label : i18n._(label);
};

/**
 * The modifiers as a PC keyboard prints them, in the player's language
 * (Strg on a German one). A Mac's are named as Apple prints them.
 */
const OTHER_MODIFIER_LABELS: Readonly<
  Record<(typeof MODIFIER_ORDER)[number], MessageDescriptor>
> = {
  ctrl: msg({ message: 'Ctrl', context: 'keyboard key' }),
  alt: msg({ message: 'Alt', context: 'keyboard key' }),
  shift: msg({ message: 'Shift', context: 'keyboard key' }),
  meta: msg({ message: 'Win', context: 'keyboard key (the Windows key)' }),
};

const MAC_MODIFIER_LABELS: Readonly<
  Record<(typeof MODIFIER_ORDER)[number], string>
> = { ctrl: '⌃ Control', alt: '⌥ Option', shift: '⇧ Shift', meta: '⌘ Cmd' };

const MODIFIER_SYMBOLS: Readonly<
  Record<(typeof MODIFIER_ORDER)[number], string>
> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

export const modifierLabel = (
  modifier: (typeof MODIFIER_ORDER)[number],
  platform: KeyboardPlatform
): string =>
  platform === 'mac'
    ? MAC_MODIFIER_LABELS[modifier]
    : i18n._(OTHER_MODIFIER_LABELS[modifier]);

/** The keycaps to draw for a chord, modifiers first. */
export const chordKeycaps = (
  chord: KeyChord,
  platform: KeyboardPlatform,
  keyText: string = keyLabel(chord.key)
): readonly string[] => [
  ...MODIFIER_ORDER.filter((modifier) => chord[modifier]).map((modifier) =>
    modifierLabel(modifier, platform)
  ),
  keyText,
];

/**
 * A compact hint for a menu row: `Alt+D` (or `⌥D` on a Mac), `Shift+G`,
 * `Alt+↓`. `keyText` stands in for the key, as `1–9` does for a count.
 */
export const chordHint = (
  chord: KeyChord,
  platform: KeyboardPlatform,
  keyText: string = keyLabel(chord.key)
): string => {
  const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]);
  return platform === 'mac'
    ? `${modifiers.map((modifier) => MODIFIER_SYMBOLS[modifier]).join('')}${keyText}`
    : [
        ...modifiers.map((modifier) => modifierLabel(modifier, 'other')),
        keyText,
      ].join('+');
};

/**
 * Ctrl+K, ⌘K on a Mac: opens the command palette on every keyboard, by
 * its letter or its place, besides the palette's own key (keymap.ts).
 */
export const commandsChordHint = (
  platform: KeyboardPlatform = detectKeyboardPlatform()
): string =>
  chordHint(
    {
      key: 'k',
      ctrl: platform !== 'mac',
      alt: false,
      shift: false,
      meta: platform === 'mac',
    },
    platform
  );

export const MODIFIERS = MODIFIER_ORDER;
export type Modifier = (typeof MODIFIER_ORDER)[number];
