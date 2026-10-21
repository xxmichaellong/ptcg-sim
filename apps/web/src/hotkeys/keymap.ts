import {
  chordCandidates,
  chordText,
  parseChord,
  sameChord,
  type KeyChord,
  type KeyInput,
} from './chords.js';
import {
  HOTKEY_ACTIONS,
  hotkeyAction,
  scopeIncludes,
  scopesOverlap,
  type HotkeyActionId,
  type HotkeyScope,
} from './hotkey-catalogue.js';

/** While a card is selected, or while none is. */
export type HotkeyMode = Exclude<HotkeyScope, 'any'>;

/**
 * The player's changes to the defaults: a shortcut moved to another chord,
 * or `null` for one they cleared. Only changes are kept, so an improved
 * default reaches everyone who never moved that shortcut.
 */
export type HotkeyOverrides = Readonly<
  Partial<Record<HotkeyActionId, string | null>>
>;

export const NO_HOTKEY_OVERRIDES: HotkeyOverrides = Object.freeze({});

const isDigit = (key: string): boolean => /^\d$/u.test(key);

/** Number keys carry counts and Esc closes everything; Tab moves focus. */
export type HotkeyReservation =
  | { readonly kind: 'fixed'; readonly action: HotkeyActionId }
  | { readonly kind: 'focus' };

/**
 * Why a chord cannot be given to a shortcut, or `null` if it can. Every
 * number key is kept for the counts (Shift+1 types `!`, which is free), Esc
 * for closing, and Tab for moving between controls. `scope` names the
 * number row's owner the player would collide with: Draw or Add damage.
 */
export const reservedChord = (
  chord: KeyChord,
  scope: HotkeyScope = 'any'
): HotkeyReservation | null => {
  if (chord.key === '0') return { kind: 'fixed', action: 'card.clearDamage' };
  if (isDigit(chord.key)) {
    const row = chordText({ ...chord, key: '1' });
    const owners = HOTKEY_ACTIONS.filter(
      (entry) => 'digits' in entry && entry.defaultChord === row
    );
    const owner =
      owners.find((entry) => scopesOverlap(entry.scope, scope)) ?? owners[0];
    return {
      kind: 'fixed',
      action: owner?.id ?? (scope === 'card' ? 'card.addDamage' : 'deck.draw'),
    };
  }
  if (chord.key === 'escape') {
    return { kind: 'fixed', action: 'table.closePopups' };
  }
  if (chord.key === 'tab') return { kind: 'focus' };
  return null;
};

/** Keeps only valid changes that differ from the defaults, in catalogue order. */
export const parseHotkeyOverrides = (value: unknown): HotkeyOverrides => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return NO_HOTKEY_OVERRIDES;
  }
  const overrides: Partial<Record<HotkeyActionId, string | null>> = {};
  for (const entry of HOTKEY_ACTIONS) {
    if ('fixed' in entry || !Object.hasOwn(value, entry.id)) continue;
    const stored: unknown = Reflect.get(value, entry.id);
    if (stored === null) {
      overrides[entry.id] = null;
      continue;
    }
    const chord = parseChord(stored);
    if (!chord || reservedChord(chord)) continue;
    const text = chordText(chord);
    if (text !== entry.defaultChord) overrides[entry.id] = text;
  }
  return Object.keys(overrides).length === 0 ? NO_HOTKEY_OVERRIDES : overrides;
};

/** What the board's default key handling should see for a key press. */
export type HotkeyTranslation =
  /** The key means what v1 made it mean: handle the press as it is. */
  | { readonly kind: 'default' }
  /** A moved shortcut: handle it as its default key would be. */
  | {
      readonly kind: 'moved';
      readonly action: HotkeyActionId;
      readonly input: KeyInput;
    }
  /** A default key the player moved its shortcut away from: ignore it. */
  | { readonly kind: 'freed' };

const KEY_EVENT_FIELDS: Readonly<
  Record<string, { readonly key: string; readonly code: string }>
> = {
  space: { key: ' ', code: 'Space' },
  enter: { key: 'Enter', code: 'Enter' },
  escape: { key: 'Escape', code: 'Escape' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp' },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown' },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft' },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight' },
  '/': { key: '/', code: 'Slash' },
  '?': { key: '?', code: 'Slash' },
};

/** A stand-in key press for a default chord. */
export const inputForChord = (chord: KeyChord): KeyInput => {
  const fields = KEY_EVENT_FIELDS[chord.key] ?? {
    key: chord.shift ? chord.key.toUpperCase() : chord.key,
    code: /^[a-z]$/u.test(chord.key) ? `Key${chord.key.toUpperCase()}` : '',
  };
  const shift = chord.shift || chord.key === '?';
  return {
    ...fields,
    altKey: chord.alt,
    ctrlKey: chord.ctrl,
    shiftKey: shift,
    metaKey: chord.meta,
    getModifierState: (modifier) =>
      (modifier === 'Alt' && chord.alt) ||
      (modifier === 'Control' && chord.ctrl) ||
      (modifier === 'Shift' && shift) ||
      (modifier === 'Meta' && chord.meta),
  };
};

const withoutLooseModifiers = (chord: KeyChord): KeyChord => ({
  ...chord,
  ctrl: false,
  shift: false,
  meta: false,
});

export class Keymap {
  /** Whether anything differs from v1's keys. */
  readonly customized: boolean;
  private readonly chords = new Map<HotkeyActionId, KeyChord | null>();
  private readonly byMode: Readonly<
    Record<HotkeyMode, ReadonlyMap<string, HotkeyActionId>>
  >;
  /** Default chords nothing answers to any more, by mode. */
  private readonly freed: Readonly<Record<HotkeyMode, ReadonlySet<string>>>;

  constructor(readonly overrides: HotkeyOverrides = NO_HOTKEY_OVERRIDES) {
    this.customized = Object.keys(overrides).length > 0;
    for (const entry of HOTKEY_ACTIONS) {
      const override = overrides[entry.id];
      this.chords.set(
        entry.id,
        override === undefined
          ? parseChord(entry.defaultChord)
          : override === null
            ? null
            : parseChord(override)
      );
    }
    const lookup = (mode: HotkeyMode) => {
      const map = new Map<string, HotkeyActionId>();
      for (const entry of HOTKEY_ACTIONS) {
        const chord = this.chords.get(entry.id);
        if (!chord || !scopeIncludes(entry.scope, mode)) continue;
        const text = chordText(chord);
        // A hand-edited conflict resolves to the first in reading order.
        if (!map.has(text)) map.set(text, entry.id);
      }
      return map;
    };
    this.byMode = { card: lookup('card'), table: lookup('table') };
    const freed = (mode: HotkeyMode) =>
      new Set(
        HOTKEY_ACTIONS.filter(
          (entry) =>
            scopeIncludes(entry.scope, mode) && !this.isDefault(entry.id)
        )
          .map((entry) => entry.defaultChord)
          .filter((text) => !this.byMode[mode].has(text))
      );
    this.freed = { card: freed('card'), table: freed('table') };
  }

  /** The chord a shortcut is on now, or `null` if the player cleared it. */
  chord(id: HotkeyActionId): KeyChord | null {
    return this.chords.get(id) ?? null;
  }

  isDefault(id: HotkeyActionId): boolean {
    return this.overrides[id] === undefined;
  }

  /** The shortcut on exactly this chord while a card is or is not selected. */
  actionAt(chord: KeyChord, mode: HotkeyMode): HotkeyActionId | null {
    const exact = this.byMode[mode].get(chordText(chord));
    if (exact) return exact;
    // A number key stands for its whole row: 5 draws five.
    return isDigit(chord.key) && chord.key !== '0'
      ? (this.byMode[mode].get(chordText({ ...chord, key: '1' })) ?? null)
      : null;
  }

  /**
   * The shortcut a key press means. Its exact chord wins; failing that, a
   * press with Shift held falls back to the same key without it, as v1's
   * handling always has (Shift+H still moves a card to the hand).
   */
  resolve(input: KeyInput, mode: HotkeyMode): HotkeyActionId | null {
    const resolution = this.lookup(input, mode);
    return resolution.kind === 'action' ? resolution.action : null;
  }

  translate(input: KeyInput, mode: HotkeyMode): HotkeyTranslation {
    if (!this.customized) return { kind: 'default' };
    const resolution = this.lookup(input, mode);
    if (resolution.kind === 'freed') return { kind: 'freed' };
    if (resolution.kind === 'none') {
      // v1 ignores Ctrl and Shift on most keys, so Ctrl+D would still
      // discard: a default key that was moved away is dead with them too.
      return chordCandidates(input).some((chord) =>
        this.freed[mode].has(chordText(withoutLooseModifiers(chord)))
      )
        ? { kind: 'freed' }
        : { kind: 'default' };
    }
    const entry = hotkeyAction(resolution.action);
    if ('fixed' in entry || this.isDefault(entry.id)) {
      return { kind: 'default' };
    }
    return {
      kind: 'moved',
      action: entry.id,
      input: inputForChord(parseChord(entry.defaultChord)!),
    };
  }

  private lookup(
    input: KeyInput,
    mode: HotkeyMode
  ):
    | { readonly kind: 'action'; readonly action: HotkeyActionId }
    | { readonly kind: 'freed' }
    | { readonly kind: 'none' } {
    const candidates = chordCandidates(input);
    for (const chord of candidates) {
      const action = this.actionAt(chord, mode);
      if (action) return { kind: 'action', action };
    }
    // `?` must not fall back to `/` (shuffle the board away) once the
    // shortcuts list has moved off it.
    if (candidates.some((chord) => this.freed[mode].has(chordText(chord)))) {
      return { kind: 'freed' };
    }
    for (const chord of candidates) {
      if (!chord.shift) continue;
      const action = this.actionAt({ ...chord, shift: false }, mode);
      if (action) return { kind: 'action', action };
    }
    return { kind: 'none' };
  }
}

const compiled = new WeakMap<HotkeyOverrides, Keymap>();

/** The keymap for a set of changes, built once per set. */
export const keymapFor = (overrides: HotkeyOverrides): Keymap => {
  let keymap = compiled.get(overrides);
  if (!keymap) {
    keymap = new Keymap(overrides);
    compiled.set(overrides, keymap);
  }
  return keymap;
};

export const DEFAULT_KEYMAP = keymapFor(NO_HOTKEY_OVERRIDES);

/* ---- Changing shortcuts ------------------------------------------------ */

/** Shortcuts already on `chord` that could be pressed at the same time as `id`. */
export const hotkeyConflicts = (
  keymap: Keymap,
  id: HotkeyActionId,
  chord: KeyChord
): readonly HotkeyActionId[] => {
  const scope = hotkeyAction(id).scope;
  return HOTKEY_ACTIONS.filter(
    (entry) =>
      entry.id !== id &&
      scopesOverlap(entry.scope, scope) &&
      sameChord(keymap.chord(entry.id), chord)
  ).map((entry) => entry.id);
};

const normalized = (
  overrides: Partial<Record<HotkeyActionId, string | null>>
): HotkeyOverrides => parseHotkeyOverrides(overrides);

/**
 * Puts `id` on `chord` (or clears it, for `null`). Shortcuts already on that
 * chord that would clash either take `id`'s old chord (`swap`) or are left
 * without one (`clear`). A swap that would clash in turn clears instead.
 */
export const assignHotkey = (
  overrides: HotkeyOverrides,
  id: HotkeyActionId,
  chord: KeyChord | null,
  others: 'swap' | 'clear' = 'clear'
): HotkeyOverrides => {
  const keymap = keymapFor(overrides);
  const previous = keymap.chord(id);
  const next: Partial<Record<HotkeyActionId, string | null>> = {
    ...overrides,
    [id]: chord === null ? null : chordText(chord),
  };
  if (chord !== null) {
    for (const other of hotkeyConflicts(keymap, id, chord)) {
      next[other] =
        others === 'swap' &&
        previous !== null &&
        canSwap(keymap, other, id, previous)
          ? chordText(previous)
          : null;
    }
  }
  for (const entry of HOTKEY_ACTIONS) {
    if (next[entry.id] === entry.defaultChord) delete next[entry.id];
  }
  return normalized(next);
};

/** Whether `other` could take `previous` (the chord `id` is leaving). */
export const canSwap = (
  keymap: Keymap,
  other: HotkeyActionId,
  id: HotkeyActionId,
  previous: KeyChord
): boolean =>
  hotkeyConflicts(keymap, other, previous).every((clash) => clash === id);

export const resetHotkey = (
  overrides: HotkeyOverrides,
  id: HotkeyActionId
): HotkeyOverrides => {
  const defaultChord = parseChord(hotkeyAction(id).defaultChord)!;
  // Back to v1's key, and whoever took that key meanwhile gives it back.
  return assignHotkey(
    Object.fromEntries(
      Object.entries(overrides).filter(([action]) => action !== id)
    ) as HotkeyOverrides,
    id,
    defaultChord,
    'clear'
  );
};
