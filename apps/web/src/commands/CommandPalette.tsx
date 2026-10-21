import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { useLingui } from '@lingui/react/macro';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { useKeymap } from '../hotkeys/hotkey-preferences.js';
import { usePreference } from '../preferences/usePreference.js';
import { TOUCH_ONLY_QUERY, useMediaQuery } from '../ui/breakpoints.js';
import {
  OVERLAY_SURFACE_ATTRIBUTE,
  isOverlayKeyTarget,
} from '../ui/overlay-surface.js';
import {
  flattenCommands,
  PATH_SEPARATOR,
  type CommandEntry,
} from './command-tree.js';
import {
  closeCommandPalette,
  isCommandPaletteOpen,
  openCommandPalette,
  useCommandPaletteOpen,
} from './palette-state.js';
import {
  rankCommands,
  rankScreen,
  type RankedEntry,
  type RankedSectionLabel,
} from './rank-commands.js';
import { COMMAND_PREFERENCES, recordCommandRun } from './recent-commands.js';
import {
  collectCommands,
  commandSourcesVersion,
  subscribeCommandSources,
  useCommandSource,
} from './registry.js';
import { appSettingCommands } from './settings-commands.js';
import { CARD_IMAGE_PREFERENCES } from '../i18n/card-image-language.js';
import { LANGUAGE_PREFERENCES } from '../i18n/language-preference.js';
import { depthSettings } from '../motion/depth-settings.js';
import { motionSettings } from '../motion/motion-settings.js';
import { TABLE_PREFERENCES } from '../session/table-preferences.js';
import type { CommandSection, PaletteCommand, PaletteScreen } from './types.js';
import './command-palette.css';

/** A dangerous command asks for a second Enter within this long. */
const ARMED_MS = 5_000;

/** Its choices are found by a search from the screen above, unless it says not. */
const searchesInto = (command: PaletteCommand): boolean =>
  command.nestedSearch !== false;

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !==
      null);

/**
 * Opens the palette from anywhere on the page: its key (`` ` `` unless the
 * player moved it), Ctrl+K or ⌘K. Not while typing, nor over another
 * dialog. Open, `` ` `` or the same chord closes it.
 */
const useCommandPaletteKeys = (): void => {
  const keymap = useKeymap();
  const latest = useRef(keymap);
  latest.current = keymap;
  useEffect(() => {
    const press = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const chordK =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key.toLowerCase() === 'k' || event.code === 'KeyK');
      const open = isCommandPaletteOpen();
      if (open) {
        // Only keys that type nothing in the search close it from inside.
        if (
          chordK ||
          (event.code === 'Backquote' &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          closeCommandPalette();
        }
        return;
      }
      const bound = latest.current.resolve(event, 'table') === 'table.commands';
      if (!chordK && !bound) return;
      if (isEditable(event.target) || isOverlayKeyTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      openCommandPalette();
    };
    document.addEventListener('keydown', press, true);
    return () => document.removeEventListener('keydown', press, true);
  }, []);
};

/** The page's own settings, listed wherever the palette opens. */
const useAppSettingCommands = (): void => {
  usePreference(LANGUAGE_PREFERENCES);
  usePreference(CARD_IMAGE_PREFERENCES);
  usePreference(TABLE_PREFERENCES);
  const motion = motionSettings();
  useSyncExternalStore(motion.subscribe, motion.getSnapshot);
  const depth = depthSettings();
  useSyncExternalStore(depth.subscribe, depth.getSnapshot);
  useCommandSource(appSettingCommands);
};

/** The one palette for the page, and the keys that open it. */
export const CommandPaletteHost = () => {
  useCommandPaletteKeys();
  useAppSettingCommands();
  const open = useCommandPaletteOpen();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <CommandPalette onClose={closeCommandPalette} />,
    document.body
  );
};

/** A command the palette is asking a number or text for. */
interface Asking {
  readonly command: PaletteCommand;
  readonly kind: 'count' | 'text';
}

interface Row {
  readonly ranked: RankedEntry;
  /** The option's element id. */
  readonly id: string;
  /** Which command it is, wherever the list puts it. */
  readonly key: string;
}

const sectionLabels = (
  t: ReturnType<typeof useLingui>['t']
): Record<RankedSectionLabel, string> => ({
  recent: t({
    message: 'Recent',
    comment: 'Command palette section: commands run last.',
  }),
  selected: t({
    message: 'Selected card',
    comment: 'Command palette section.',
  }),
  turn: t({
    message: 'Turn',
    comment: 'Command palette section: Set up, Attack, Pass…',
  }),
  deck: t({ message: 'Deck and hand', comment: 'Command palette section.' }),
  cards: t({
    message: 'Cards',
    comment: 'Command palette section: find a card on the table.',
  }),
  piles: t({
    message: 'Piles',
    comment: 'Command palette section: deck, discard, prizes…',
  }),
  table: t({
    message: 'Table',
    comment: 'Command palette section: view and table pieces.',
  }),
  room: t({
    message: 'Room',
    comment: 'Command palette section: decks, online play, replays.',
  }),
  settings: t({ message: 'Settings', comment: 'Command palette section.' }),
  help: t({ message: 'Help', comment: 'Command palette section.' }),
});

/**
 * The command palette (ADR-035): search every action the table, the room
 * and the app offer right now, choose with the keys or a press, and run it
 * through the same path as its button, menu entry or key.
 */
export const CommandPalette = ({
  onClose,
}: {
  readonly onClose: () => void;
}) => {
  const { t } = useLingui();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const version = useSyncExternalStore(
    subscribeCommandSources,
    commandSourcesVersion
  );
  const { recent } = usePreference(COMMAND_PREFERENCES);
  const [query, setQuery] = useState('');
  /** Ids of the commands whose screens are open, outermost first. */
  const [path, setPath] = useState<readonly string[]>([]);
  /** The chosen row, by what it is: a list that changes keeps it chosen. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const listId = useId();

  // Asked again whenever a source changes (`version`).
  const root = useMemo(() => {
    void version;
    return collectCommands();
  }, [version]);
  // The open screens, re-read from the current commands each time: one
  // whose command is gone (the card left the table) closes with it.
  const screens = useMemo(() => {
    const opened: {
      readonly command: PaletteCommand;
      readonly screen: PaletteScreen;
    }[] = [];
    let commands: readonly PaletteCommand[] = root;
    for (const id of path) {
      const command = commands.find((candidate) => candidate.id === id);
      const screen = command?.submenu?.();
      if (!command || !screen) break;
      opened.push({ command, screen });
      commands = screen.commands;
    }
    return opened;
  }, [root, path]);
  useEffect(() => {
    if (screens.length < path.length) setPath(path.slice(0, screens.length));
  }, [screens.length, path]);
  const screen = screens.at(-1)?.screen;

  // The list: sections on the root screen, one run on a sub-screen.
  const { rows, sections } = useMemo(() => {
    const entries = flattenCommands(
      screen ? screen.commands : root,
      searchesInto
    );
    const grouped = screen ? null : rankCommands(entries, query, recent);
    // A command listed twice (under Recent and its own section) is two rows.
    const ranked = grouped
      ? grouped.flatMap((section) =>
          section.entries.map((entry) => ({ entry, section: section.section }))
        )
      : rankScreen(entries, query).map((entry) => ({
          entry,
          section: 'screen',
        }));
    return {
      rows: ranked.map(({ entry, section }, index): Row => ({
        ranked: entry,
        id: `${listId}-option-${index}`,
        key: [
          section,
          ...entry.entry.ancestors.map((ancestor) => ancestor.id),
          entry.entry.command.id,
          entry.count ?? '',
        ].join('\u0000'),
      })),
      sections: grouped,
    };
  }, [root, screen, query, recent, listId]);
  const current = Math.max(
    0,
    rows.findIndex((row) => row.key === selectedKey)
  );

  // The selection starts at the top of every new list.
  useEffect(() => {
    setSelectedKey(null);
    setArmed(null);
  }, [query, path]);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  useEffect(() => {
    if (flashed === null) return;
    const timer = setTimeout(() => setFlashed(null), 450);
    return () => clearTimeout(timer);
  }, [flashed]);

  // Focus: the field while open; back where it was when closed.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    field.current?.focus({ preventScroll: true });
    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    // A number asked for starts selected: typing replaces it.
    if (asking) field.current?.select();
  }, [asking, path]);

  // The chosen row stays in view.
  useLayoutEffect(() => {
    const row = rows[current];
    if (!row) return;
    list.current
      ?.querySelector<HTMLElement>(`[id="${CSS.escape(row.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current, rows]);

  const titleOf = (ranked: RankedEntry): string =>
    ranked.count !== undefined && ranked.entry.command.count
      ? ranked.entry.command.count.title(ranked.count)
      : ranked.entry.command.title;

  /** The command a recent entry is remembered by: the screen it ran from. */
  const remembered = (entry: CommandEntry): string =>
    path[0] ?? entry.command.id;

  const finish = (
    command: PaletteCommand,
    entry: CommandEntry,
    rowKey: string
  ): void => {
    recordCommandRun(remembered(entry));
    if (command.keepOpen) {
      // Kept chosen as Recent takes it in, for the next Enter to repeat.
      setSelectedKey(rowKey);
      setFlashed(rowKey);
      return;
    }
    onClose();
  };

  const run = (row: Row): void => {
    const { entry, count } = row.ranked;
    const { command } = entry;
    if (command.submenu) {
      setPath([
        ...path,
        ...entry.ancestors.map((ancestor) => ancestor.id),
        command.id,
      ]);
      setQuery('');
      return;
    }
    if (command.count && count === undefined) {
      setAsking({ command, kind: 'count' });
      setDraft(String(command.count.initial ?? command.count.min));
      setProblem(null);
      return;
    }
    if (command.text) {
      setAsking({ command, kind: 'text' });
      setDraft('');
      setProblem(null);
      return;
    }
    if (command.dangerous && armed !== row.key) {
      setArmed(row.key);
      return;
    }
    setArmed(null);
    command.run?.(count === undefined ? {} : { count });
    finish(command, entry, row.key);
  };

  const answer = (): void => {
    if (!asking) return;
    const { command } = asking;
    if (asking.kind === 'count' && command.count) {
      const value = draft.trim();
      const count = /^\d+$/u.test(value) ? Number(value) : Number.NaN;
      if (!(count >= command.count.min && count <= command.count.max)) {
        setProblem(
          t`A whole number from ${command.count.min} to ${command.count.max}`
        );
        field.current?.select();
        return;
      }
      command.run?.({ count });
    } else {
      const text = draft.trim();
      if (text === '') {
        setProblem(t`Type something first`);
        return;
      }
      command.run?.({ text });
    }
    recordCommandRun(path[0] ?? command.id);
    if (command.keepOpen) {
      setAsking(null);
      setDraft('');
      return;
    }
    onClose();
  };

  /** One step back: the question, the search, a screen, then the palette. */
  const back = (): void => {
    if (armed !== null) setArmed(null);
    else if (asking) {
      setAsking(null);
      setProblem(null);
    } else if (query !== '') setQuery('');
    else if (path.length > 0) setPath(path.slice(0, -1));
    else onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // Typing in the palette is never a table shortcut.
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        back();
        return;
      case 'Backspace':
        if (event.currentTarget.value === '' && (asking || path.length > 0)) {
          event.preventDefault();
          back();
        }
        return;
      case 'Enter': {
        event.preventDefault();
        if (event.repeat) return;
        if (asking) answer();
        else {
          const row = rows[current];
          if (row) run(row);
        }
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        if (asking || rows.length === 0) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedKey(rows[(current + step + rows.length) % rows.length]!.key);
        setArmed(null);
        return;
      }
      case 'Home':
      case 'End':
        if (asking || rows.length === 0 || event.currentTarget.value !== '')
          return;
        event.preventDefault();
        setSelectedKey(rows[event.key === 'Home' ? 0 : rows.length - 1]!.key);
        return;
      case 'Tab':
        // The field keeps the focus: the list is read through it.
        event.preventDefault();
        return;
    }
  };

  const labels = sectionLabels(t);
  const crumbs = [
    ...screens.map((opened) => opened.screen.breadcrumb),
    ...(asking ? [asking.command.title.replace(/…$/u, '')] : []),
  ];
  const placeholder = asking
    ? asking.kind === 'count'
      ? asking.command.count!.label
      : (asking.command.text!.placeholder ?? asking.command.text!.label)
    : (screen?.placeholder ?? t`Search for an action…`);

  const renderRow = (row: Row, index: number) => {
    const { entry } = row.ranked;
    const { command } = entry;
    const Icon =
      command.icon ??
      entry.ancestors.at(-1)?.icon ??
      screens.at(-1)?.command.icon ??
      LightningIcon;
    const isArmed = armed === row.key;
    return (
      <div
        key={row.key}
        id={row.id}
        role="option"
        aria-selected={index === current}
        className="ptcgsim-command"
        data-command-id={command.id}
        data-armed={isArmed ? '' : undefined}
        data-ran={flashed === row.key ? '' : undefined}
        data-danger={command.dangerous ? '' : undefined}
        onMouseMove={() => {
          if (index !== current) {
            setSelectedKey(row.key);
            setArmed(null);
          }
        }}
        onClick={() => {
          setSelectedKey(row.key);
          run(row);
          field.current?.focus({ preventScroll: true });
        }}
      >
        <span className="ptcgsim-command__icon" aria-hidden="true">
          <Icon weight="bold" />
        </span>
        <span className="ptcgsim-command__text">
          {entry.path.length > 0 ? (
            <span className="ptcgsim-command__path">
              {entry.path.join(PATH_SEPARATOR)}
              {PATH_SEPARATOR}
            </span>
          ) : null}
          <span className="ptcgsim-command__title">{titleOf(row.ranked)}</span>
          {command.detail ? (
            <span className="ptcgsim-command__detail">{command.detail}</span>
          ) : null}
        </span>
        <span className="ptcgsim-command__trail">
          {isArmed ? (
            <span className="ptcgsim-command__confirm">
              {touchOnly
                ? t`Press again to confirm`
                : t`Press Enter again to confirm`}
            </span>
          ) : command.status ? (
            <span className="ptcgsim-command__status">{command.status}</span>
          ) : command.active ? (
            <CheckIcon
              weight="bold"
              className="ptcgsim-command__check"
              aria-label={t`Current`}
            />
          ) : command.hint && !touchOnly ? (
            <kbd className="ptcgsim-command__key">{command.hint}</kbd>
          ) : command.submenu ? (
            <CaretRightIcon
              weight="bold"
              className="ptcgsim-command__more"
              aria-hidden="true"
            />
          ) : null}
        </span>
      </div>
    );
  };

  let index = 0;
  const body = asking ? (
    <div
      className="ptcgsim-command-palette__asking"
      role="status"
      data-problem={problem ? '' : undefined}
    >
      {problem ??
        (asking.kind === 'count'
          ? t`Enter a number, then press Enter.`
          : t`Type, then press Enter.`)}
    </div>
  ) : rows.length === 0 ? (
    <div className="ptcgsim-command-palette__empty" role="status">
      <strong>{t`No actions match`}</strong>
      <span>{t`Try other words, or press Escape to go back.`}</span>
    </div>
  ) : sections ? (
    sections.map((section) => (
      <div
        key={section.section}
        role="group"
        aria-labelledby={`${listId}-${section.section}`}
        className="ptcgsim-command-palette__section"
      >
        <div
          id={`${listId}-${section.section}`}
          className="ptcgsim-command-palette__heading"
        >
          {labels[section.section as CommandSection | 'recent']}
        </div>
        {section.entries.map(() => {
          const row = rows[index]!;
          const rendered = renderRow(row, index);
          index += 1;
          return rendered;
        })}
      </div>
    ))
  ) : (
    rows.map((row, at) => renderRow(row, at))
  );

  return (
    <div
      className="ptcgsim-command-palette-layer"
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'dialog' }}
    >
      <div
        className="ptcgsim-command-palette__scrim"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="ptcgsim-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t`Commands`}
        data-command-palette=""
      >
        <div className="ptcgsim-command-palette__search">
          <MagnifyingGlassIcon
            weight="bold"
            aria-hidden="true"
            className="ptcgsim-command-palette__glass"
          />
          {crumbs.map((crumb, at) => (
            <button
              key={`${at}:${crumb}`}
              type="button"
              className="ptcgsim-command-palette__crumb"
              tabIndex={-1}
              onClick={() => {
                // Back to this screen: its question, then deeper screens, go.
                setAsking(null);
                setProblem(null);
                setPath(path.slice(0, Math.min(at + 1, path.length)));
                setQuery('');
              }}
            >
              {crumb}
            </button>
          ))}
          <input
            ref={field}
            className="ptcgsim-command-palette__field"
            type="text"
            role="combobox"
            aria-expanded={!asking}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              !asking && rows[current] ? rows[current]!.id : undefined
            }
            aria-invalid={asking && problem ? true : undefined}
            aria-label={asking ? placeholder : t`Search for an action`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode={asking?.kind === 'count' ? 'numeric' : undefined}
            enterKeyHint={asking ? 'done' : 'go'}
            maxLength={
              asking?.kind === 'text'
                ? (asking.command.text!.maxLength ?? 500)
                : 120
            }
            placeholder={placeholder}
            value={asking ? draft : query}
            onChange={(event) => {
              if (asking) {
                setDraft(event.currentTarget.value);
                setProblem(null);
              } else setQuery(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={t`Actions`}
          className="ptcgsim-command-palette__list"
        >
          {body}
        </div>
        {touchOnly ? null : (
          <div className="ptcgsim-command-palette__footer" aria-hidden="true">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd>{' '}
              {t({
                message: 'Choose',
                comment: 'Command palette footer: arrow keys.',
              })}
            </span>
            <span>
              <kbd>↵</kbd>{' '}
              {t({
                message: 'Run',
                comment: 'Command palette footer: Enter key.',
              })}
            </span>
            <span>
              <kbd>Esc</kbd>{' '}
              {path.length > 0 || asking || query !== ''
                ? t({
                    message: 'Back',
                    comment: 'Command palette footer: Escape key.',
                  })
                : t({
                    message: 'Close',
                    comment: 'Command palette footer: Escape key.',
                  })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
