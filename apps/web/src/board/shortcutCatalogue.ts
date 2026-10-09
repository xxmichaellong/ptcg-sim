/**
 * The board's keyboard shortcuts as v1's Shift reference lists them. This is
 * the one place their text lives: the Shift reference prints it and the card
 * menu reads its keyboard hints from it, so the two cannot drift apart.
 */
export interface ShortcutReferenceEntry {
  readonly label: string;
  readonly shortcut?: string;
  readonly indented?: boolean;
}

export interface ShortcutReferenceGroup {
  readonly heading: string;
  readonly entries: readonly ShortcutReferenceEntry[];
}

/** v1's groups, in v1's reading order. */
export const SHORTCUT_REFERENCE_GROUPS: readonly ShortcutReferenceGroup[] = [
  {
    heading: 'Move card...',
    entries: [
      { label: 'to Hand', shortcut: '[h]' },
      { label: 'to Discard', shortcut: '[d]' },
      { label: 'to Bench', shortcut: '[b]' },
      { label: 'to Active', shortcut: '[a]' },
      { label: 'to Stadium', shortcut: '[g]' },
      { label: 'to Lost Zone', shortcut: '[l]' },
      { label: 'to Prizes', shortcut: '[p]' },
      { label: 'to Board', shortcut: '[space]' },
      { label: 'to Deck (top)', shortcut: '[↑]' },
      { label: 'to Deck (bottom)', shortcut: '[↓]' },
      { label: 'to Deck (switch)', shortcut: '[→]' },
      { label: 'to Deck (shuffle)', shortcut: '[s]' },
    ],
  },
  {
    heading: 'Deck',
    entries: [
      { label: 'Shuffle deck', shortcut: '[s]' },
      { label: 'Draw card(s)', shortcut: '[1-9]' },
      { label: 'View top card(s)', shortcut: '[alt + 1-9]' },
      { label: 'View bottom card(s)', shortcut: '[ctrl + 1-9]' },
      { label: 'View', shortcut: '[v]' },
    ],
  },
  {
    heading: 'Hand',
    entries: [
      { label: 'Discard hand', shortcut: '[alt + d]' },
      { label: 'Shuffle hand to deck', shortcut: '[alt + s]' },
      { label: 'Shuffle hand to bottom', shortcut: '[alt + ↓]' },
    ],
  },
  {
    heading: 'Playboard',
    entries: [
      { label: 'Discard all', shortcut: '[enter]' },
      { label: 'Move all to hand', shortcut: '[alt + enter]' },
      { label: 'Shuffle all into deck', shortcut: '[/]' },
    ],
  },
  {
    heading: 'Card actions',
    entries: [
      { label: 'Attach', shortcut: '[q]' },
      { label: 'Evolve', shortcut: '[e]' },
      {
        label: 'View (for cards in play, press twice)',
        shortcut: '[v]',
      },
      { label: 'Toggle ability/effect', shortcut: '[w]' },
      { label: 'Damage counter' },
      { label: 'Increase', shortcut: '[1-9]', indented: true },
      { label: 'Decrease', shortcut: '[alt + 1-9]', indented: true },
      { label: 'Remove', shortcut: '[0]', indented: true },
      { label: 'Special condition' },
      { label: 'Add/Toggle', shortcut: '[y]', indented: true },
      { label: 'Remove', shortcut: '[alt + y]', indented: true },
      { label: 'Rotate card(s)', shortcut: '[r]' },
      { label: 'Rotate BREAK', shortcut: '[alt + r]' },
      { label: 'Look/cover card (only yourself)', shortcut: '[c]' },
      { label: 'Hide card (both players)', shortcut: '[z]' },
      { label: 'Reveal card (both players)', shortcut: '[alt + z]' },
      { label: 'Put face-down card in active', shortcut: '[z] → [a]' },
      { label: 'Change type...' },
      { label: 'to Tool', shortcut: '[alt + t]', indented: true },
      { label: 'to Energy', shortcut: '[alt + e]', indented: true },
      { label: 'to Pokémon', shortcut: '[alt + p]', indented: true },
    ],
  },
  {
    heading: 'General',
    entries: [
      { label: 'Set up', shortcut: '[alt + n]' },
      { label: 'Reset', shortcut: '[alt + r]' },
      { label: 'Start turn', shortcut: '[alt + t]' },
      { label: 'Flip coin', shortcut: '[f]' },
      { label: 'Flip board', shortcut: '[alt + f]' },
      { label: 'Announce mulligan', shortcut: '[m]' },
      { label: 'Undo', shortcut: '[u]' },
      { label: 'Close popups', shortcut: '[esc]' },
      { label: 'Refresh images', shortcut: '[r]' },
    ],
  },
];

/** A catalogue entry, named by its group heading and its label. */
export interface ShortcutCatalogueKey {
  readonly heading: string;
  readonly label: string;
}

/** The catalogue's shortcut text for one entry, such as `[alt + d]`. */
export const catalogueShortcut = ({
  heading,
  label,
}: ShortcutCatalogueKey): string | undefined =>
  SHORTCUT_REFERENCE_GROUPS.find(
    (group) => group.heading === heading
  )?.entries.find((entry) => entry.label === label)?.shortcut;

const KEY_NAMES: Readonly<Record<string, string>> = {
  alt: 'Alt',
  ctrl: 'Ctrl',
  enter: 'Enter',
  esc: 'Esc',
  space: 'Space',
};

const keyName = (key: string): string =>
  KEY_NAMES[key] ??
  (/^\d-\d$/u.test(key)
    ? key.replace('-', '–')
    : key.length === 1
      ? key.toUpperCase()
      : key);

/**
 * Splits catalogue text into the keys to press: each step of a sequence is a
 * chord of keys held together. `[alt + 1-9]` is one chord of Alt and 1–9;
 * `[z] → [a]` is Z, then A.
 */
export const shortcutChords = (
  shortcut: string
): readonly (readonly string[])[] =>
  [...shortcut.matchAll(/\[([^\]]+)\]/gu)].map((match) =>
    (match[1] ?? '')
      .split('+')
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
      .map(keyName)
  );

/** A compact hint for a menu row: `Alt+D`, `1–9`, `Z → A`. */
export const shortcutHint = (shortcut: string): string =>
  shortcutChords(shortcut)
    .map((chord) => chord.join('+'))
    .join(' → ');
