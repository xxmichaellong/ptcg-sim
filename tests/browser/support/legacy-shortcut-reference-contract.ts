export interface LegacyShortcutReferenceEntry {
  readonly label: string;
  readonly shortcut: string | null;
}

export const LEGACY_SHORTCUT_REFERENCE_HEADINGS = [
  'Move card...',
  'Deck',
  'Hand',
  'Playboard',
  'Card actions',
  'General',
] as const;

export const LEGACY_SHORTCUT_REFERENCE_ENTRIES: readonly LegacyShortcutReferenceEntry[] =
  [
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
    { label: 'Shuffle deck', shortcut: '[s]' },
    { label: 'Draw card(s)', shortcut: '[1-9]' },
    { label: 'View top card(s)', shortcut: '[alt + 1-9]' },
    { label: 'View bottom card(s)', shortcut: '[ctrl + 1-9]' },
    { label: 'View', shortcut: '[v]' },
    { label: 'Discard hand', shortcut: '[alt + d]' },
    { label: 'Shuffle hand to deck', shortcut: '[alt + s]' },
    { label: 'Shuffle hand to bottom', shortcut: '[alt + ↓]' },
    { label: 'Discard all', shortcut: '[enter]' },
    { label: 'Move all to hand', shortcut: '[alt + enter]' },
    { label: 'Shuffle all into deck', shortcut: '[/]' },
    { label: 'Attach', shortcut: '[q]' },
    { label: 'Evolve', shortcut: '[e]' },
    {
      label: 'View (for cards in play, press twice)',
      shortcut: '[v]',
    },
    { label: 'Toggle ability/effect', shortcut: '[w]' },
    { label: 'Damage counter', shortcut: null },
    { label: 'Increase', shortcut: '[1-9]' },
    { label: 'Decrease', shortcut: '[alt + 1-9]' },
    { label: 'Remove', shortcut: '[0]' },
    { label: 'Special condition', shortcut: null },
    { label: 'Add/Toggle', shortcut: '[y]' },
    { label: 'Remove', shortcut: '[alt + y]' },
    { label: 'Rotate card(s)', shortcut: '[r]' },
    { label: 'Rotate BREAK', shortcut: '[alt + r]' },
    { label: 'Look/cover card (only yourself)', shortcut: '[c]' },
    { label: 'Hide card (both players)', shortcut: '[z]' },
    { label: 'Reveal card (both players)', shortcut: '[alt + z]' },
    { label: 'Put face-down card in active', shortcut: '[z] → [a]' },
    { label: 'Change type...', shortcut: null },
    { label: 'to Tool', shortcut: '[alt + t]' },
    { label: 'to Energy', shortcut: '[alt + e]' },
    { label: 'to Pokémon', shortcut: '[alt + p]' },
    { label: 'Set up', shortcut: '[alt + n]' },
    { label: 'Reset', shortcut: '[alt + r]' },
    { label: 'Start turn', shortcut: '[alt + t]' },
    { label: 'Flip coin', shortcut: '[f]' },
    { label: 'Flip board', shortcut: '[alt + f]' },
    { label: 'Announce mulligan', shortcut: '[m]' },
    { label: 'Undo', shortcut: '[u]' },
    { label: 'Close popups', shortcut: '[esc]' },
    { label: 'Refresh images', shortcut: '[r]' },
  ];

export const LEGACY_SHORTCUT_REFERENCE_MACOS_NOTE =
  'For macOS: Use option instead of alt';
