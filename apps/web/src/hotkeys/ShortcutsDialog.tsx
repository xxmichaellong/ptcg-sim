import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsOutCardinalIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutCardinal';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CursorClickIcon } from '@phosphor-icons/react/dist/csr/CursorClick';
import { HandGrabbingIcon } from '@phosphor-icons/react/dist/csr/HandGrabbing';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/csr/LockSimple';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { Icon } from '@phosphor-icons/react';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Fragment,
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import {
  preferences as pagePreferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { DeckIcon } from '../ui/DeckIcon.js';
import { Dialog } from '../ui/Dialog.js';
import { Tooltip, withKeyHint } from '../ui/Tooltip.js';
import {
  chordFromInput,
  chordHint,
  chordKeycaps,
  chordText,
  detectKeyboardPlatform,
  isModifierKey,
  keyLabel,
  modifierLabel,
  parseChord,
  type KeyboardPlatform,
  type KeyChord,
} from './chords.js';
import {
  HOTKEY_ACTIONS,
  HOTKEY_GROUPS,
  hotkeyAction,
  scopeIncludes,
  type HotkeyActionEntry,
  type HotkeyActionId,
  type HotkeyGroupId,
  type HotkeyScope,
} from './hotkey-catalogue.js';
import {
  HOTKEY_PREFERENCES,
  SHORTCUTS_DIALOG_PREFERENCES,
} from './hotkey-preferences.js';
import {
  assignHotkey,
  canSwap,
  hotkeyConflicts,
  keymapFor,
  NO_HOTKEY_OVERRIDES,
  reservedChord,
  resetHotkey,
  type HotkeyMode,
  type Keymap,
} from './keymap.js';
import {
  closeShortcutsDialog,
  useIsShortcutsDialogHost,
  useShortcutsDialogState,
} from './shortcuts-dialog-state.js';
import '../design/panel-controls.css';
import './ShortcutsDialog.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

const GROUP_ICONS: Readonly<Record<HotkeyGroupId, Icon>> = {
  move: ArrowsOutCardinalIcon,
  card: CardsIcon,
  deck: DeckIcon,
  hand: HandGrabbingIcon,
  board: SquaresFourIcon,
  table: TableIcon,
};

const MODE_LABELS: Readonly<Record<HotkeyMode, MessageDescriptor>> = {
  card: msg({ message: 'Card selected', context: 'when a shortcut works' }),
  table: msg({ message: 'Nothing selected', context: 'when a shortcut works' }),
};

const SCOPE_LABELS: Readonly<Record<HotkeyScope, MessageDescriptor>> = {
  card: msg({ message: 'Card selected', context: 'when a shortcut works' }),
  table: msg({ message: 'Nothing selected', context: 'when a shortcut works' }),
  any: msg({ message: 'Any time', context: 'when a shortcut works' }),
};

/* ---- Keycaps ------------------------------------------------------------ */

const DIGIT_ROW = '1–9';

const keyTextFor = (entry: HotkeyActionEntry, chord: KeyChord): string =>
  'digits' in entry ? DIGIT_ROW : keyLabel(chord.key);

/** One shortcut drawn as keys: `Alt` + `D`. */
export const Keycaps = ({
  chord,
  entry,
  platform,
}: {
  readonly chord: KeyChord;
  readonly entry: HotkeyActionEntry;
  readonly platform: KeyboardPlatform;
}) => (
  <span className="ptcgsim-keycaps" aria-hidden="true">
    {chordKeycaps(chord, platform, keyTextFor(entry, chord)).map(
      (cap, index) => (
        <Fragment key={`${cap}:${index}`}>
          {index > 0 ? <span className="ptcgsim-keycaps__plus">+</span> : null}
          <kbd className="ptcgsim-keycap">{cap}</kbd>
        </Fragment>
      )
    )}
  </span>
);

/** "A and B", "A, B and C", in the player's language. */
const listOf = (names: readonly string[]): string =>
  new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(names);

/** What a screen reader hears for a shortcut: "Alt+D", "1–9", "not set". */
const spokenChord = (
  chord: KeyChord | null,
  entry: HotkeyActionEntry,
  platform: KeyboardPlatform
): string =>
  chord
    ? chordHint(chord, platform, keyTextFor(entry, chord))
    : t({ message: 'not set', context: 'a shortcut with no key' });

/* ---- The keyboard map -------------------------------------------------- */

type Layer = 'plain' | 'shift' | 'alt' | 'ctrl';

const LAYERS: readonly Layer[] = ['plain', 'shift', 'alt', 'ctrl'];

const layerModifiers = (layer: Layer) => ({
  ctrl: layer === 'ctrl',
  alt: layer === 'alt',
  shift: layer === 'shift',
  meta: false,
});

/** The map's layer a chord sits on, or `null` for one it cannot show. */
const layerOf = (chord: KeyChord): Layer | null => {
  const count = [chord.ctrl, chord.alt, chord.shift, chord.meta].filter(
    Boolean
  ).length;
  if (count > 1 || chord.meta) return null;
  return chord.ctrl
    ? 'ctrl'
    : chord.alt
      ? 'alt'
      : chord.shift
        ? 'shift'
        : 'plain';
};

interface MapKey {
  readonly key: string;
  /** Width in key units. */
  readonly width?: number;
  /** What Shift types on a US layout (`?` on `/`). */
  readonly shifted?: string;
  /** A modifier: pressing it switches the map's layer. */
  readonly layer?: Exclude<Layer, 'plain'>;
  /** Drawn for shape only. */
  readonly blank?: MessageDescriptor;
}

const row = (keys: string, shifted = ''): MapKey[] =>
  [...keys].map((key, index) => ({
    key,
    ...(shifted[index] && shifted[index] !== ' '
      ? { shifted: shifted[index] }
      : {}),
  }));

const MAP_ROWS: readonly (readonly MapKey[])[] = [
  [{ key: 'escape', width: 1.25 }, ...row('1234567890-=', '!@#$%^&*()_+')],
  [
    {
      key: 'tab',
      blank: msg({ message: 'Tab', context: 'keyboard key' }),
      width: 1.5,
    },
    ...row('qwertyuiop[]', '          {}'),
  ],
  [
    {
      key: 'caps',
      blank: msg({ message: 'Caps', context: 'keyboard key (Caps Lock)' }),
      width: 1.75,
    },
    ...row("asdfghjkl;'", '         :"'),
    { key: 'enter', width: 2 },
  ],
  [
    { key: 'shift', layer: 'shift', width: 2.25 },
    ...row('zxcvbnm,./', '       <>?'),
    { key: 'arrowup', width: 1 },
  ],
  [
    { key: 'ctrl', layer: 'ctrl', width: 1.5 },
    { key: 'alt', layer: 'alt', width: 1.5 },
    { key: 'space', width: 6.5 },
    { key: 'arrowleft' },
    { key: 'arrowdown' },
    { key: 'arrowright' },
  ],
];

const damageText = (mode: HotkeyMode, layer: Layer, key: string) =>
  mode === 'card' &&
  /^[1-9]$/u.test(key) &&
  (layer === 'plain' || layer === 'alt')
    ? `${layer === 'alt' ? '−' : '+'}${key}0`
    : null;

const actionOnMapKey = (
  keymap: Keymap,
  mode: HotkeyMode,
  layer: Layer,
  mapKey: MapKey
): HotkeyActionId | null => {
  const direct = keymap.actionAt(
    { key: mapKey.key, ...layerModifiers(layer) },
    mode
  );
  if (direct) return direct;
  // `?` lives on `/` once Shift is down.
  if (layer === 'shift' && mapKey.shifted) {
    return keymap.actionAt(
      {
        key: mapKey.shifted === '+' ? 'plus' : mapKey.shifted,
        ...layerModifiers('plain'),
      },
      mode
    );
  }
  return null;
};

const KeyboardMap = memo(function KeyboardMap({
  keymap,
  mode,
  layer,
  platform,
  highlighted,
  onLayer,
  onHover,
  onPick,
}: {
  readonly keymap: Keymap;
  readonly mode: HotkeyMode;
  readonly layer: Layer;
  readonly platform: KeyboardPlatform;
  readonly highlighted: HotkeyActionId | null;
  readonly onLayer: (layer: Layer) => void;
  readonly onHover: (action: HotkeyActionId | null) => void;
  readonly onPick: (action: HotkeyActionId) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div
      className="ptcgsim-keyboard-map"
      data-layer={layer}
      aria-hidden="true"
      // A keyboard is the same way round in every language.
      dir="ltr"
      onPointerLeave={() => onHover(null)}
    >
      {MAP_ROWS.map((keys, rowIndex) => (
        <div className="ptcgsim-keyboard-map__row" key={rowIndex}>
          {keys.map((mapKey) => {
            const style = {
              '--key-width': mapKey.width ?? 1,
            } as CSSProperties;
            if (mapKey.layer) {
              const active = layer === mapKey.layer;
              return (
                <button
                  key={mapKey.key}
                  type="button"
                  tabIndex={-1}
                  className="ptcgsim-map-key is-modifier"
                  data-active={active ? 'true' : undefined}
                  style={style}
                  onClick={() => onLayer(active ? 'plain' : mapKey.layer!)}
                >
                  <span className="ptcgsim-map-key__cap">
                    {modifierLabel(mapKey.layer, platform)}
                  </span>
                </button>
              );
            }
            if (mapKey.blank) {
              return (
                <span
                  key={mapKey.key}
                  className="ptcgsim-map-key is-blank"
                  style={style}
                >
                  <span className="ptcgsim-map-key__cap">
                    {i18n._(mapKey.blank)}
                  </span>
                </span>
              );
            }
            const action = actionOnMapKey(keymap, mode, layer, mapKey);
            const entry = action ? hotkeyAction(action) : undefined;
            const cap =
              layer === 'shift' && mapKey.shifted
                ? mapKey.shifted
                : keyLabel(mapKey.key);
            return (
              <span
                key={mapKey.key}
                className="ptcgsim-map-key"
                data-group={entry?.group}
                data-highlighted={
                  action !== null && action === highlighted ? 'true' : undefined
                }
                style={style}
                onPointerEnter={() => onHover(action)}
                onClick={() => {
                  if (action) onPick(action);
                }}
              >
                <span className="ptcgsim-map-key__cap">{cap}</span>
                {entry ? (
                  <span className="ptcgsim-map-key__action">
                    {damageText(mode, layer, mapKey.key) ?? i18n._(entry.short)}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
});

/* ---- One shortcut ------------------------------------------------------ */

interface PendingConflict {
  readonly id: HotkeyActionId;
  readonly chord: KeyChord;
  readonly clashes: readonly HotkeyActionId[];
  readonly swappable: boolean;
}

interface RowProps {
  readonly entry: HotkeyActionEntry;
  readonly keymap: Keymap;
  readonly platform: KeyboardPlatform;
  readonly showScope: boolean;
  readonly highlighted: boolean;
  readonly recording: boolean;
  readonly flash: boolean;
  readonly conflict: PendingConflict | null;
  readonly error: string | null;
  readonly onHover: (id: HotkeyActionId | null) => void;
  readonly onRecord: (id: HotkeyActionId) => void;
  readonly onRecorded: (id: HotkeyActionId, chord: KeyChord) => void;
  readonly onStop: () => void;
  readonly onClear: (id: HotkeyActionId) => void;
  readonly onReset: (id: HotkeyActionId) => void;
  readonly onResolveConflict: (choice: 'swap' | 'clear' | 'cancel') => void;
}

const ShortcutRow = memo(function ShortcutRow({
  entry,
  keymap,
  platform,
  showScope,
  highlighted,
  recording,
  flash,
  conflict,
  error,
  onHover,
  onRecord,
  onRecorded,
  onStop,
  onClear,
  onReset,
  onResolveConflict,
}: RowProps) {
  const { t, i18n } = useLingui();
  const label = i18n._(entry.label);
  const chord = keymap.chord(entry.id);
  const spoken = spokenChord(chord, entry, platform);
  const clashNames = conflict
    ? listOf(conflict.clashes.map((clash) => i18n._(hotkeyAction(clash).label)))
    : '';
  const custom = !keymap.isDefault(entry.id);
  const fixed = 'fixed' in entry;
  const [held, setHeld] = useState<KeyChord | null>(null);
  const describedBy = useId();
  const recordKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return;
    if (event.key === 'Tab' && !event.shiftKey && !event.altKey) {
      onStop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      onStop();
      return;
    }
    const native = event.nativeEvent;
    if (isModifierKey(event.key)) {
      setHeld({
        key: '',
        ctrl: native.ctrlKey,
        alt: native.altKey,
        shift: native.shiftKey,
        meta: native.metaKey,
      });
      return;
    }
    const next = chordFromInput(native);
    if (next) onRecorded(entry.id, next);
  };
  const defaultChord = keymapFor(NO_HOTKEY_OVERRIDES).chord(entry.id);
  const defaultHint = defaultChord
    ? chordHint(defaultChord, platform)
    : undefined;
  return (
    <li
      className="ptcgsim-shortcut-row"
      data-group={entry.group}
      data-action={entry.id}
      data-highlighted={highlighted ? 'true' : undefined}
      data-custom={custom ? 'true' : undefined}
      data-flash={flash ? 'true' : undefined}
      onPointerEnter={() => onHover(entry.id)}
      onPointerLeave={() => onHover(null)}
    >
      <div className="ptcgsim-shortcut-row__text">
        <span className="ptcgsim-shortcut-row__label">{label}</span>
        {'detail' in entry || showScope ? (
          <span className="ptcgsim-shortcut-row__detail" id={describedBy}>
            {showScope ? (
              <span className="ptcgsim-shortcut-row__scope">
                {i18n._(SCOPE_LABELS[entry.scope])}
              </span>
            ) : null}
            {entry.detail ? i18n._(entry.detail) : null}
          </span>
        ) : null}
      </div>
      <div className="ptcgsim-shortcut-row__keys">
        {fixed ? (
          <span
            className="ptcgsim-shortcut-key is-fixed"
            title={t`Can't be changed`}
          >
            {chord ? (
              <Keycaps chord={chord} entry={entry} platform={platform} />
            ) : null}
            <LockSimpleIcon {...decorative} className="ptcgsim-lock" />
            <span className="ds-visually-hidden">
              {t({
                message: `${spoken}, fixed`,
                comment: '{spoken} is the shortcut\'s keys, such as "Alt+1".',
              })}
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="ptcgsim-shortcut-key"
            data-recording={recording ? 'true' : undefined}
            aria-label={
              recording
                ? t`Press the new keys for ${label}. Escape cancels.`
                : t({
                    message: `${label}: ${spoken}. Change`,
                    comment:
                      'A button naming a shortcut and its keys; pressing it changes the keys.',
                  })
            }
            onClick={() => {
              setHeld(null);
              if (!recording) onRecord(entry.id);
            }}
            onKeyDown={recordKey}
            onKeyUp={(event) => {
              if (!recording) return;
              const native = event.nativeEvent;
              setHeld(
                native.ctrlKey || native.altKey || native.shiftKey
                  ? {
                      key: '',
                      ctrl: native.ctrlKey,
                      alt: native.altKey,
                      shift: native.shiftKey,
                      meta: native.metaKey,
                    }
                  : null
              );
            }}
            onBlur={() => {
              if (recording) onStop();
            }}
          >
            {recording ? (
              <span className="ptcgsim-shortcut-key__prompt">
                {held
                  ? `${chordKeycaps(held, platform, '…').join(' + ')}`
                  : t`Press keys…`}
              </span>
            ) : chord ? (
              <Keycaps chord={chord} entry={entry} platform={platform} />
            ) : (
              <span className="ptcgsim-shortcut-key__unset">
                <Trans context="a shortcut with no key">Not set</Trans>
              </span>
            )}
          </button>
        )}
        {recording && chord ? (
          <button
            type="button"
            className="ptcgsim-shortcut-row__clear"
            // Keep focus on the recorder until the click lands.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onClear(entry.id)}
          >
            <Trans context="remove a shortcut's key">Clear</Trans>
          </button>
        ) : null}
        {custom && !recording ? (
          <Tooltip
            content={withKeyHint(
              defaultChord
                ? t({
                    message: 'Reset to',
                    comment:
                      'Followed by the default key drawn as a keycap, as in "Reset to Alt+D".',
                  })
                : t`Reset to no key`,
              defaultHint
            )}
            side="inline-start"
          >
            <button
              type="button"
              className="ds-icon-button ptcgsim-shortcut-row__reset"
              aria-label={
                defaultHint
                  ? t`Reset ${label} to ${defaultHint}`
                  : t`Reset ${label} to its default`
              }
              onClick={() => onReset(entry.id)}
            >
              <ArrowCounterClockwiseIcon {...decorative} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {error ? (
        <p className="ptcgsim-shortcut-row__message" role="alert">
          <WarningIcon {...decorative} weight="fill" />
          {error}
        </p>
      ) : null}
      {conflict ? (
        <div className="ptcgsim-shortcut-conflict" role="alert">
          <p>
            <WarningIcon {...decorative} weight="fill" />
            <span>
              <Trans
                comment={
                  'The keys drawn as keycaps, then the names of the shortcuts already on them, as in "Alt+D already does To discard."'
                }
              >
                <Keycaps
                  chord={conflict.chord}
                  entry={entry}
                  platform={platform}
                />{' '}
                already does <strong>{clashNames}</strong>.
              </Trans>
            </span>
          </p>
          <div className="ptcgsim-shortcut-conflict__actions">
            {conflict.swappable ? (
              <button
                type="button"
                className="ds-button ds-button--primary"
                onClick={() => onResolveConflict('swap')}
              >
                <Trans>Swap keys</Trans>
              </button>
            ) : null}
            <button
              type="button"
              className={`ds-button ${conflict.swappable ? 'ds-button--secondary' : 'ds-button--primary'}`}
              onClick={() => onResolveConflict('clear')}
            >
              <Trans context="give the keys to this shortcut">Use here</Trans>
            </button>
            <button
              type="button"
              className="ds-button ds-button--ghost"
              onClick={() => onResolveConflict('cancel')}
            >
              <Trans>Cancel</Trans>
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
});

/* ---- The dialog ------------------------------------------------------- */

const KEY_ALIASES: Readonly<Record<string, string>> = {
  option: 'alt',
  opt: 'alt',
  '⌥': 'alt',
  control: 'ctrl',
  '⌃': 'ctrl',
  '⇧': 'shift',
  cmd: 'meta',
  command: 'meta',
  '⌘': 'meta',
  win: 'meta',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  '↑': 'arrowup',
  '↓': 'arrowdown',
  '←': 'arrowleft',
  '→': 'arrowright',
  '+': 'plus',
};

/** A query that names keys ("alt d", "Shift+G", "?") as a chord. */
const queryChord = (query: string): string | null => {
  const parts = query
    .trim()
    .toLowerCase()
    .split(/\s*\+\s*|\s+/u)
    .filter(Boolean)
    .map((part) => KEY_ALIASES[part] ?? part);
  const chord = parseChord(parts.join('+'));
  if (!chord) return null;
  // A number names its row: "alt 5" is Alt+1–9.
  return chordText(/^[1-9]$/u.test(chord.key) ? { ...chord, key: '1' } : chord);
};

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * A shortcut matches when its keys are the query ("alt d"), or when every
 * word of the query starts a word of its name ("disc hand").
 */
const matchesQuery = (
  entry: HotkeyActionEntry,
  keymap: Keymap,
  query: string
): boolean => {
  const chord = keymap.chord(entry.id);
  const asChord = queryChord(query);
  if (chord && asChord !== null && chordText(chord) === asChord) return true;
  const terms = words(query);
  if (terms.length === 0) return asChord === null;
  const group = HOTKEY_GROUPS.find((candidate) => candidate.id === entry.group);
  const haystack = words(
    [
      i18n._(entry.label),
      i18n._(entry.short),
      entry.detail ? i18n._(entry.detail) : '',
      group ? i18n._(group.title) : '',
    ].join(' ')
  );
  return terms.every((term) => haystack.some((word) => word.startsWith(term)));
};

const reservationMessage = (
  chord: KeyChord,
  scope: HotkeyScope
): string | null => {
  const reservation = reservedChord(chord, scope);
  if (!reservation) return null;
  if (reservation.kind === 'focus') {
    return t`Tab can't be a shortcut.`;
  }
  const key = keyLabel(chord.key);
  const name = i18n._(hotkeyAction(reservation.action).label);
  // English names the shortcut in the sentence's own case ("kept for add
  // damage"); other languages keep its name as written (German nouns stay
  // capitalised).
  const action = i18n.locale === 'en' ? name.toLowerCase() : name;
  return t({
    message: `${key} is reserved for ${action}.`,
    comment:
      '{key} is a key ("5"); {action} is the name of the shortcut that owns it, such as "Add damage".',
  });
};

export interface ShortcutsDialogProps {
  readonly open: boolean;
  /** The list it opens on. */
  readonly mode: HotkeyMode;
  readonly onOpenChange: (open: boolean) => void;
  readonly store?: PreferenceStore;
  readonly platform?: KeyboardPlatform;
}

/**
 * Every keyboard shortcut, and the place to change them. A map of the
 * keyboard shows what each key does with or without a card selected (and
 * under Shift, Alt or Ctrl); the list beside it changes a shortcut with a
 * click and a key press. Changes are saved in this browser.
 */
export const ShortcutsDialog = ({
  open,
  mode: initialMode,
  onOpenChange,
  store = pagePreferences(),
  platform = detectKeyboardPlatform(),
}: ShortcutsDialogProps) => {
  const { t, i18n } = useLingui();
  const overrides = usePreference(HOTKEY_PREFERENCES, store);
  const { showKeyboard } = usePreference(SHORTCUTS_DIALOG_PREFERENCES, store);
  const keymap = keymapFor(overrides);
  const [mode, setMode] = useState<HotkeyMode>(initialMode);
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<Layer>('plain');
  const [hovered, setHovered] = useState<HotkeyActionId | null>(null);
  const [recording, setRecording] = useState<HotkeyActionId | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [error, setError] = useState<{
    readonly id: HotkeyActionId;
    readonly message: string;
  } | null>(null);
  const [flash, setFlash] = useState<HotkeyActionId | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  // Each opening starts on what the keys do right now.
  const [trackedOpen, setTrackedOpen] = useState(open);
  if (open !== trackedOpen) {
    setTrackedOpen(open);
    if (open) {
      setMode(initialMode);
      setQuery('');
      setLayer('plain');
      setHovered(null);
      setRecording(null);
      setConflict(null);
      setError(null);
      setConfirmingReset(false);
    }
  }

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = setTimeout(() => setConfirmingReset(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmingReset]);

  const save = (next: typeof overrides): void =>
    store.set(HOTKEY_PREFERENCES, next);

  const stopRecording = (): void => {
    setRecording(null);
  };
  const startRecording = (id: HotkeyActionId): void => {
    setConflict(null);
    setError(null);
    setRecording(id);
  };
  const recorded = (id: HotkeyActionId, chord: KeyChord): void => {
    const reserved = reservationMessage(chord, hotkeyAction(id).scope);
    if (reserved) {
      setError({ id, message: reserved });
      return;
    }
    setError(null);
    setRecording(null);
    const clashes = hotkeyConflicts(keymap, id, chord);
    if (clashes.length === 0) {
      save(assignHotkey(overrides, id, chord));
      setFlash(id);
      return;
    }
    const previous = keymap.chord(id);
    setConflict({
      id,
      chord,
      clashes,
      swappable:
        previous !== null &&
        clashes.every((clash) => canSwap(keymap, clash, id, previous)),
    });
  };
  const resolveConflict = (choice: 'swap' | 'clear' | 'cancel'): void => {
    if (conflict && choice !== 'cancel') {
      save(assignHotkey(overrides, conflict.id, conflict.chord, choice));
      setFlash(conflict.id);
    }
    setConflict(null);
  };

  // Hovering a shortcut shows the layer its key sits on.
  const hoveredChord = hovered ? keymap.chord(hovered) : null;
  const shownLayer = hoveredChord ? (layerOf(hoveredChord) ?? layer) : layer;

  const searching = query.trim().length > 0;
  const groups = useMemo(
    () =>
      HOTKEY_GROUPS.map((group) => ({
        group,
        entries: HOTKEY_ACTIONS.filter(
          (entry) =>
            entry.group === group.id &&
            (searching
              ? matchesQuery(entry, keymap, query)
              : scopeIncludes(entry.scope, mode))
        ),
      })).filter(({ entries }) => entries.length > 0),
    // A search matches the names in the language shown.
    [keymap, mode, query, searching, i18n.locale]
  );

  const pick = (id: HotkeyActionId): void => {
    if (!scopeIncludes(hotkeyAction(id).scope, mode) && !searching) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-action="${CSS.escape(id)}"]`
    );
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFlash(id);
  };

  const changed = Object.keys(overrides).length;
  const opener = keymap.chord('table.shortcuts');

  const handleDialogKeyDown = (event: ReactKeyboardEvent): void => {
    if (recordingRef.current || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (keymap.resolve(event.nativeEvent, mode) === 'table.shortcuts') {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  let body: ReactNode;
  if (groups.length === 0) {
    const search = query.trim();
    body = (
      <p className="ptcgsim-shortcuts__empty">
        <Trans>No shortcut matches “{search}”.</Trans>
      </p>
    );
  } else {
    body = groups.map(({ group, entries }) => {
      const GroupIcon = GROUP_ICONS[group.id];
      return (
        <section
          className="ptcgsim-shortcut-group"
          data-group={group.id}
          key={group.id}
          aria-labelledby={`shortcut-group-${group.id}`}
        >
          <h3 id={`shortcut-group-${group.id}`}>
            <GroupIcon {...decorative} weight="duotone" />
            {i18n._(group.title)}
          </h3>
          <ul>
            {entries.map((entry) => (
              <ShortcutRow
                key={entry.id}
                entry={entry}
                keymap={keymap}
                platform={platform}
                showScope={searching}
                highlighted={hovered === entry.id}
                recording={recording === entry.id}
                flash={flash === entry.id}
                conflict={conflict?.id === entry.id ? conflict : null}
                error={error?.id === entry.id ? error.message : null}
                onHover={setHovered}
                onRecord={startRecording}
                onRecorded={recorded}
                onStop={stopRecording}
                onClear={(id) => {
                  setRecording(null);
                  save(assignHotkey(overrides, id, null));
                }}
                onReset={(id) => {
                  save(resetHotkey(overrides, id));
                  setFlash(id);
                }}
                onResolveConflict={resolveConflict}
              />
            ))}
          </ul>
        </section>
      );
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc while choosing a key cancels the choice, not the dialog.
        if (!next && recordingRef.current) {
          setRecording(null);
          return;
        }
        onOpenChange(next);
      }}
      className="ptcgsim-shortcuts"
      // The list takes focus, so arrow keys and Page Down scroll it.
      initialFocus={listRef}
      title={
        <>
          <span className="ptcgsim-shortcuts__title-icon">
            <KeyboardIcon {...decorative} weight="duotone" />
          </span>
          <Trans>Keyboard shortcuts</Trans>
        </>
      }
      description={
        <>
          <Trans>Click a shortcut to change it.</Trans>
          {opener ? (
            <>
              {' '}
              <Trans
                comment={
                  'The keys that open this list, drawn as keycaps (usually "?").'
                }
              >
                <Keycaps
                  chord={opener}
                  entry={hotkeyAction('table.shortcuts')}
                  platform={platform}
                />{' '}
                opens this list.
              </Trans>
            </>
          ) : null}
        </>
      }
    >
      <div className="ptcgsim-shortcuts__tools" onKeyDown={handleDialogKeyDown}>
        <label className="ptcgsim-shortcuts__search">
          <MagnifyingGlassIcon {...decorative} />
          <span className="ds-visually-hidden">
            <Trans>Find a shortcut</Trans>
          </span>
          <input
            type="search"
            className="ds-input"
            placeholder={t`Find a shortcut or key`}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
        </label>
        <Tooltip
          content={withKeyHint(t`Close`, keyLabel('escape'))}
          side="bottom"
        >
          <button
            type="button"
            className="ds-icon-button ptcgsim-shortcuts__close"
            aria-label={t`Close keyboard shortcuts`}
            onClick={() => onOpenChange(false)}
          >
            <XIcon {...decorative} />
          </button>
        </Tooltip>
      </div>
      <div className="ptcgsim-shortcuts__body" onKeyDown={handleDialogKeyDown}>
        <div className="ptcgsim-shortcuts__bar">
          <div
            className="ptcgsim-segmented"
            role="radiogroup"
            aria-label={t`Show the keys for`}
            data-disabled={searching ? 'true' : undefined}
          >
            {(['card', 'table'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className="ptcgsim-segmented__option"
                onClick={() => setMode(value)}
              >
                {value === 'card' ? (
                  <CursorClickIcon {...decorative} />
                ) : (
                  <TableIcon {...decorative} />
                )}
                {i18n._(MODE_LABELS[value])}
              </button>
            ))}
          </div>
          <div className="ptcgsim-shortcuts__map-tools">
            {showKeyboard ? (
              <div
                className="ptcgsim-layer-switch"
                role="radiogroup"
                aria-label={t`Keyboard map layer`}
              >
                {LAYERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={shownLayer === value}
                    className="ptcgsim-layer-switch__option"
                    onClick={() => setLayer(value)}
                  >
                    {value === 'plain'
                      ? t({
                          message: 'Keys',
                          context: 'the keyboard map with no modifier held',
                        })
                      : modifierLabel(value, platform)}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="ptcgsim-map-toggle"
              aria-pressed={showKeyboard}
              onClick={() =>
                store.patch(SHORTCUTS_DIALOG_PREFERENCES, {
                  showKeyboard: !showKeyboard,
                })
              }
            >
              <KeyboardIcon {...decorative} />
              {showKeyboard ? t`Hide keyboard` : t`Show keyboard`}
            </button>
          </div>
        </div>
        {showKeyboard ? (
          <KeyboardMap
            keymap={keymap}
            mode={mode}
            layer={shownLayer}
            platform={platform}
            highlighted={hovered ?? flash}
            onLayer={setLayer}
            onHover={setHovered}
            onPick={pick}
          />
        ) : null}
        <div
          className="ptcgsim-shortcuts__list"
          ref={listRef}
          tabIndex={-1}
          aria-label={t`Shortcuts`}
          data-searching={searching ? 'true' : undefined}
        >
          <div className="ptcgsim-shortcuts__columns">{body}</div>
        </div>
      </div>
      <footer className="ptcgsim-shortcuts__footer">
        <p>
          {changed > 0 ? (
            <Plural
              value={changed}
              one="# shortcut changed"
              other="# shortcuts changed"
            />
          ) : null}
        </p>
        {confirmingReset ? (
          <div className="ptcgsim-shortcuts__confirm" role="group">
            <span>
              <Trans>Reset all shortcuts?</Trans>
            </span>
            <button
              type="button"
              className="ds-button ds-button--ghost"
              onClick={() => setConfirmingReset(false)}
            >
              <Trans context="keep the changed shortcuts">Keep</Trans>
            </button>
            <button
              type="button"
              className="ds-button ds-button--danger"
              onClick={() => {
                save(NO_HOTKEY_OVERRIDES);
                setConfirmingReset(false);
                setConflict(null);
                setError(null);
              }}
            >
              <Trans>Reset all</Trans>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ds-button ds-button--secondary"
            disabled={changed === 0}
            onClick={() => setConfirmingReset(true)}
          >
            <ArrowCounterClockwiseIcon {...decorative} />
            <Trans>Reset to defaults</Trans>
          </button>
        )}
      </footer>
    </Dialog>
  );
};

/** The page's one shortcuts dialog, opened from anywhere. */
export const ShortcutsDialogHost = () => {
  const { open, mode } = useShortcutsDialogState();
  const drawsTheDialog = useIsShortcutsDialogHost();
  if (!drawsTheDialog) return null;
  return (
    <ShortcutsDialog
      open={open}
      mode={mode}
      onOpenChange={(next) => {
        if (!next) closeShortcutsDialog();
      }}
    />
  );
};
