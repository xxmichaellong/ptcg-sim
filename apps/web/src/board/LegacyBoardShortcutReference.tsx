import { Fragment, memo } from 'react';

import {
  SHORTCUT_REFERENCE_GROUPS,
  shortcutChords,
  type ShortcutReferenceGroup,
} from './shortcutCatalogue.js';
import './LegacyBoardShortcutReference.css';

/**
 * The reference's four columns, by group heading. The groups keep v1's
 * reading order; only how they sit on the sheet changes.
 */
const REFERENCE_COLUMNS: readonly (readonly string[])[] = [
  ['Move card...'],
  ['Deck', 'Hand', 'Playboard'],
  ['Card actions'],
  ['General'],
];

const groupsFor = (headings: readonly string[]): ShortcutReferenceGroup[] =>
  headings.flatMap((heading) => {
    const group = SHORTCUT_REFERENCE_GROUPS.find(
      (candidate) => candidate.heading === heading
    );
    return group ? [group] : [];
  });

/** One shortcut as keycaps: chords joined by +, steps by an arrow. */
const Keycaps = ({ shortcut }: { readonly shortcut: string }) => (
  <span className="ptcgsim-shortcut-keys" aria-hidden="true">
    {shortcutChords(shortcut).map((chord, chordIndex) => (
      <Fragment key={chordIndex}>
        {chordIndex > 0 ? (
          <span className="ptcgsim-shortcut-then">then</span>
        ) : null}
        {chord.map((key, keyIndex) => (
          <Fragment key={`${key}:${keyIndex}`}>
            {keyIndex > 0 ? (
              <span className="ptcgsim-shortcut-plus">+</span>
            ) : null}
            <kbd>{key}</kbd>
          </Fragment>
        ))}
      </Fragment>
    ))}
  </span>
);

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
        <div className="ptcgsim-shortcut-title">
          <span className="ptcgsim-shortcut-title-text">
            Keyboard shortcuts
          </span>
          <span className="ptcgsim-shortcut-title-hint">
            Release <kbd>Shift</kbd> to close
          </span>
        </div>
        <div className="ptcgsim-legacy-shortcut-sections">
          {REFERENCE_COLUMNS.map((headings, columnIndex) => (
            <div className="ptcgsim-legacy-shortcut-section" key={columnIndex}>
              {groupsFor(headings).map((group) => (
                <div
                  className="ptcgsim-legacy-shortcut-column"
                  key={group.heading}
                >
                  <h1>{group.heading}</h1>
                  <ul>
                    {group.entries.map((entry, entryIndex) => (
                      <li
                        className={entry.indented ? 'is-indented' : undefined}
                        key={`${entry.label}:${entry.shortcut ?? ''}:${entryIndex}`}
                      >
                        <span className="ptcgsim-shortcut-label">
                          {entry.label}
                        </span>
                        {entry.shortcut ? (
                          <>
                            {/* v1's text stays for assistive technology and
                                copy; sighted players read the keycaps. */}
                            <code className="ptcgsim-shortcut-source">
                              {entry.shortcut}
                            </code>
                            <Keycaps shortcut={entry.shortcut} />
                          </>
                        ) : null}
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
