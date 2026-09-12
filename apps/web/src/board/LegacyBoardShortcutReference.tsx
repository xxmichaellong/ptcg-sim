import { memo } from 'react';

import './LegacyBoardShortcutReference.css';

interface ShortcutReferenceEntry {
  readonly label: string;
  readonly shortcut?: string;
  readonly indented?: boolean;
}

interface ShortcutReferenceColumn {
  readonly heading: string;
  readonly entries: readonly ShortcutReferenceEntry[];
}

const SHORTCUT_REFERENCE_SECTIONS: readonly (readonly ShortcutReferenceColumn[])[] =
  [
    [
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
    ],
    [
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
    ],
  ] as const;

export const LegacyBoardShortcutReference = memo(
  function LegacyBoardShortcutReference({
    visible,
    darkMode,
  }: {
    readonly visible: boolean;
    readonly darkMode: boolean;
  }) {
    return (
      <div
        className={`ptcgsim-legacy-shortcut-reference${visible ? ' is-visible' : ''}${darkMode ? ' is-dark' : ''}`}
        data-legacy-shortcut-reference="true"
        data-shortcut-reference-visible={String(visible)}
        aria-hidden={!visible}
      >
        <div className="ptcgsim-legacy-shortcut-sections">
          {SHORTCUT_REFERENCE_SECTIONS.map((columns, sectionIndex) => (
            <div className="ptcgsim-legacy-shortcut-section" key={sectionIndex}>
              {columns.map((column) => (
                <div
                  className="ptcgsim-legacy-shortcut-column"
                  key={column.heading}
                >
                  <h1>{column.heading}</h1>
                  <ul>
                    {column.entries.map((entry, entryIndex) => (
                      <li
                        className={entry.indented ? 'is-indented' : undefined}
                        key={`${entry.label}:${entry.shortcut ?? ''}:${entryIndex}`}
                      >
                        <span>{entry.label}</span>
                        {entry.shortcut ? <code>{entry.shortcut}</code> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="ptcgsim-legacy-shortcut-macos-note">
          <p>
            <strong>For macOS:</strong> Use <code>option</code> instead of{' '}
            <code>alt</code>
          </p>
        </div>
      </div>
    );
  }
);
