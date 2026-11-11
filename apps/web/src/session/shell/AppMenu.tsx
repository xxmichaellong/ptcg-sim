import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import type { Icon } from '@phosphor-icons/react';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GraduationCapIcon } from '@phosphor-icons/react/dist/csr/GraduationCap';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HashIcon } from '@phosphor-icons/react/dist/csr/Hash';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';

import {
  moveAlongToolbar,
  noteFocusArrival,
  RailButton,
} from '../../board/rail/TableRail.js';
import { useHotkeyHints } from '../../hotkeys/hotkey-preferences.js';
import { openCommandPalette } from '../../commands/palette-state.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import type { ActionMenuEntry } from '../../ui/ActionMenu.js';
import { DeckIcon } from '../../ui/DeckIcon.js';
import {
  COARSE_POINTER_QUERY,
  useCompactLayout,
  useMediaQuery,
} from '../../ui/breakpoints.js';
import type { SettingsTone } from '../../ui/SettingsList.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';
import { useModeSwitchSlide } from './mode-switch-motion.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';

/**
 * Where this table is played, named at the start of the bar: alone (Solo),
 * against someone (Online), watching a room, a replay or the tutorial.
 */
export interface TableMode {
  readonly kind: 'solo' | 'online' | 'watching' | 'replay' | 'tutorial';
  /** Online or watching: not (or no longer) connected to the room. */
  readonly connecting?: boolean;
  /** Shown on hover or a tap: the room ("Room K7PQ"), or "Connecting…". */
  readonly detail?: string;
  /** Online: the room's code (ADR-047), shown in place of "Online". */
  readonly code?: string;
}

/**
 * What can be done in the current room and mode: the app bar's buttons,
 * and the rest in Settings (ADR-045), which the bar's last button opens.
 */
export interface AppMenuModel {
  /** The room in a line: Settings heads the room's invites with it. */
  readonly heading?: string;
  /** The bar's label: Solo, Online and so on. */
  readonly mode?: TableMode;
  /** Back to the Solo table, from the lobby. */
  readonly onPlaySolo?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDeck?: () => void;
  /** Opens Settings, or puts it away while it is open. */
  readonly onSettings: () => void;
  /** Settings is open: its button shows it pressed. */
  readonly settingsOpen?: boolean;
  /**
   * The room's code and its invite (ADR-047): one link for everyone, who
   * chooses to play or watch on joining.
   */
  readonly invites?: {
    readonly code: string;
    readonly onInvite: () => void;
    readonly onCopyCode: () => void;
  };
  /** In a room: the bar's room code opens the room (its code, who's here). */
  readonly onRoom?: () => void;
  /** Saves and replays; each present only where it applies. */
  readonly game?: {
    readonly onImportReplay?: () => void;
    readonly onExportState?: () => void;
    readonly onSaveOnline?: () => void;
    readonly onResumeSaved?: () => void;
    /** Resumes a save kept in the account, from its text. */
    readonly onResumeSavedText?: (text: string, onResumed?: () => void) => void;
    readonly onExitReplay?: () => void;
    /** A save or import is in flight. */
    readonly busy?: boolean;
  };
  readonly onLeave?: () => void;
  /** Opens the tutorial (from a Solo table or Play online, not a room). */
  readonly onTutorial?: () => void;
  /** On the tutorial's practice table: back to the player's own table. */
  readonly onExitTutorial?: () => void;
}

/** A toolbar button, and the same row in Settings on a phone. */
export interface ToolbarEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: Icon;
  readonly hint?: string;
  readonly onSelect: () => void;
}

/** Opens an outside page in a new tab, keeping this one. */
const openOutside = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * What the toolbar shows as buttons: where to play, the deck and the
 * command palette. Worded when the toolbar renders, in the language up
 * then.
 */
export const primaryEntries = (
  model: AppMenuModel,
  commandsHint?: string
): ToolbarEntry[] => {
  const entries: ToolbarEntry[] = [];
  if (model.onPlaySolo) {
    entries.push({
      id: 'p1Button',
      label: t`Solo table`,
      icon: UserIcon,
      onSelect: model.onPlaySolo,
    });
  }
  if (model.onDeck) {
    entries.push({
      id: 'deckImportButton',
      label: t({ message: 'Deck', context: 'the deck screen' }),
      icon: DeckIcon,
      onSelect: model.onDeck,
    });
  }
  if (model.onPlayOnline) {
    entries.push({
      id: 'p2Button',
      label: t`Play online`,
      icon: UsersThreeIcon,
      onSelect: model.onPlayOnline,
    });
  }
  // Every action, searched for: the command palette (ADR-035).
  entries.push({
    id: 'commandsButton',
    label: t({ message: 'Commands', context: 'the command palette' }),
    icon: MagnifyingGlassIcon,
    ...(commandsHint ? { hint: commandsHint } : {}),
    onSelect: openCommandPalette,
  });
  return entries;
};

/**
 * The page's help, in no menu: the keys (in Settings, and on their own
 * key) and the links at the foot of Settings. The palette lists them.
 */
export const helpEntries = (shortcutsHint?: string): ToolbarEntry[] => [
  {
    id: 'shortcutsButton',
    label: t`Keyboard shortcuts`,
    icon: KeyboardIcon,
    ...(shortcutsHint ? { hint: shortcutsHint } : {}),
    onSelect: () => openShortcutsDialog(),
  },
  {
    id: 'changelogButton',
    label: RELEASE_NAME,
    icon: SparkleIcon,
    onSelect: () => openHelpPage('changelog'),
  },
  {
    id: 'donationsButton',
    label: t`Sponsors`,
    icon: HeartIcon,
    onSelect: () => openHelpPage('donations'),
  },
  {
    id: 'discordButton',
    label: t`Discord`,
    icon: DiscordLogoIcon,
    onSelect: () => openOutside(DISCORD_URL),
  },
];

/**
 * One thing the room lets the player do, as Settings lists it (ADR-045):
 * its row's icon on a tile of this colour, and the palette's command.
 */
export interface SettingsAction {
  readonly id: string;
  readonly label: string;
  /** Under the label: why it can't be done ("Seat taken"). */
  readonly detail?: string;
  readonly icon: Icon;
  readonly tone: SettingsTone;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** The icon points the way the line reads (leaving): it turns round RTL. */
  readonly mirrored?: boolean;
  readonly onSelect: () => void;
}

/**
 * What the room lets the player do, grouped as Settings shows it: the
 * room's invites, the game's saves and replays (a page of their own), the
 * tutorial (with the help), and the ways out, at the foot.
 */
export const menuActions = (
  model: AppMenuModel
): {
  readonly room: readonly SettingsAction[];
  readonly saves: readonly SettingsAction[];
  readonly tutorial: readonly SettingsAction[];
  readonly leave: readonly SettingsAction[];
} => {
  const game = model.game;
  const room: SettingsAction[] = [];
  const invites = model.invites;
  // The room (its code, who is here, a new code) where the bar has no room
  // for its code: a phone held upright. There before its code has come,
  // which Room says, and asks for again.
  if (model.onRoom) {
    room.push({
      id: 'roomMenuItem',
      label: t({ message: 'Room', context: 'an online room' }),
      ...(invites ? { detail: invites.code } : {}),
      icon: HashIcon,
      tone: 'indigo',
      onSelect: model.onRoom,
    });
  } else if (invites) {
    room.push({
      id: 'roomCodeMenuItem',
      label: t`Copy room code`,
      detail: invites.code,
      icon: HashIcon,
      tone: 'indigo',
      onSelect: invites.onCopyCode,
    });
  }
  if (invites) {
    room.push({
      id: 'inviteMenuItem',
      label: t`Copy invite link`,
      icon: UserPlusIcon,
      tone: 'blue',
      onSelect: invites.onInvite,
    });
  }
  const tutorial: SettingsAction[] =
    model.onTutorial && !model.onExitTutorial
      ? [
          {
            id: 'tutorialButton',
            label: t`Tutorial`,
            icon: GraduationCapIcon,
            tone: 'orange',
            onSelect: model.onTutorial,
          },
        ]
      : [];
  const saves: SettingsAction[] = [];
  if (game?.onImportReplay) {
    saves.push({
      id: 'importReplay',
      label: t`Watch replay…`,
      icon: FilmReelIcon,
      tone: 'purple',
      disabled: game.busy === true,
      onSelect: game.onImportReplay,
    });
  }
  if (game?.onSaveOnline) {
    saves.push({
      id: 'saveOnlineGame',
      label: t`Save game`,
      icon: CloudArrowUpIcon,
      tone: 'cyan',
      disabled: game.busy === true,
      onSelect: game.onSaveOnline,
    });
  }
  if (game?.onResumeSaved) {
    saves.push({
      id: 'resumeSavedGame',
      label: t`Resume saved game…`,
      icon: FolderOpenIcon,
      tone: 'brown',
      disabled: game.busy === true,
      onSelect: game.onResumeSaved,
    });
  }
  if (game?.onExportState) {
    saves.push({
      id: 'exportState',
      label: t`Download replay`,
      icon: DownloadSimpleIcon,
      tone: 'slate',
      onSelect: game.onExportState,
    });
  }
  const leave: SettingsAction[] = [];
  if (game?.onExitReplay) {
    leave.push({
      // The rail's Exit keeps v1's `#exitReplay`.
      id: 'exitReplayMenuItem',
      label: t`Exit replay`,
      icon: XCircleIcon,
      tone: 'red',
      onSelect: game.onExitReplay,
    });
  }
  if (model.onExitTutorial) {
    leave.push({
      id: 'leaveTutorialButton',
      label: t`Leave tutorial`,
      icon: GraduationCapIcon,
      tone: 'orange',
      onSelect: model.onExitTutorial,
    });
  }
  if (model.onLeave) {
    leave.push({
      id: 'leaveRoomButton',
      label: t`Leave room`,
      icon: SignOutIcon,
      tone: 'red',
      mirrored: true,
      danger: true,
      onSelect: model.onLeave,
    });
  }
  return { room, saves, tutorial, leave };
};

/**
 * Settings' own entry, and what it lists that the room lets the player
 * do, as the palette offers them: `menu.<id>` commands (ADR-035).
 */
export const restEntries = (model: AppMenuModel): ActionMenuEntry[] => {
  const { room, saves, tutorial, leave } = menuActions(model);
  return [
    {
      id: 'settingsButton',
      label: t`Settings`,
      icon: GearSixIcon,
      onSelect: model.onSettings,
    },
    ...[...room, ...saves, ...tutorial, ...leave].map(
      (action): ActionMenuEntry => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        ...(action.disabled ? { disabled: true } : {}),
        ...(action.danger ? { danger: true } : {}),
        ...(action.mirrored ? { mirrored: true } : {}),
        onSelect: action.onSelect,
      })
    ),
  ];
};

/**
 * The app bar's buttons: 36px for a mouse, 44px under a finger, in a pill
 * with this gap between them and this padding (border included) round
 * them. The stylesheet takes the button size from the bar; the rest it
 * repeats (table-shell.css), so the corner the table keeps clear
 * (`appBarSize`) is the bar's own box.
 */
export const APP_BAR_GAP_PX = 4;
export const APP_BAR_PAD_PX = 3;
const appBarButtonPx = (coarse: boolean): number => (coarse ? 44 : 36);
/**
 * The mode at the start of the bar -- the Solo | Online switch, or a
 * replay's or the tutorial's name -- is at most this wide (a longer name
 * is cut short); the corner kept for the bar counts it at this width.
 */
export const APP_BAR_MODE_PX = 168;
/**
 * A phone held upright, where the opponent's hand needs every pixel beside
 * the bar: the mode takes no room, only a light in the bar's corner online.
 */
export const NARROW_BAR_QUERY = '(max-width: 479px)';

/**
 * The most buttons the bar shows after the mode: on a phone the palette,
 * the log and Settings; elsewhere also the deck. Where to play is the
 * mode's switch.
 */
export const APP_BAR_SLOTS = { full: 4, compact: 3 } as const;

/** The bar's box for that many buttons, after the mode's label if any. */
export const appBarSize = (
  slots: number,
  coarse: boolean,
  modeLabel = true
): { readonly width: number; readonly height: number } => {
  const button = appBarButtonPx(coarse);
  return {
    width:
      (modeLabel ? APP_BAR_MODE_PX + APP_BAR_GAP_PX : 0) +
      slots * button +
      Math.max(0, slots - 1) * APP_BAR_GAP_PX +
      2 * APP_BAR_PAD_PX,
    height: button + 2 * APP_BAR_PAD_PX,
  };
};

/**
 * The corner the table keeps clear for the bar (layout `appBarPx`): room
 * for as many buttons as it can show here, whichever the room needs.
 */
export const useAppBarReserve = (): {
  readonly width: number;
  readonly height: number;
} => {
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const compact = useCompactLayout();
  const narrow = useMediaQuery(NARROW_BAR_QUERY);
  return useMemo(
    () =>
      appBarSize(
        compact ? APP_BAR_SLOTS.compact : APP_BAR_SLOTS.full,
        coarse,
        !narrow
      ),
    [compact, coarse, narrow]
  );
};

/** A button on the bar, with its tooltip below it. */
const BarButton = ({ entry }: { readonly entry: ToolbarEntry }) => (
  <Tooltip content={withKeyHint(entry.label, entry.hint)} side="bottom">
    <RailButton
      id={entry.id}
      icon={entry.icon}
      label={entry.label}
      iconOnly
      onClick={() => entry.onSelect()}
    />
  </Tooltip>
);

/** What the Solo | Online switch shows and does, where the bar has one. */
export interface ModeSwitchModel {
  readonly current: 'solo' | 'online';
  /** Back to the Solo table, or out of the room (which asks first). */
  readonly onSolo?: () => void;
  /** Play online: create or join a room. */
  readonly onOnline?: () => void;
  readonly watching?: boolean;
  readonly connecting?: boolean;
  /** The room ("Room K7PQ"), on the online side's tooltip. */
  readonly detail?: string;
  /** The room's code, shown in place of "Online" (ADR-047). */
  readonly code?: string;
  /** In a room: opens it (its code, invite, who is here). */
  readonly onRoom?: () => void;
}

/**
 * The switch for this table, if it has one: a Solo table, a room, or Play
 * online's page (whose way back is the Solo side). A replay and the
 * tutorial keep their names.
 */
export const modeSwitchOf = (
  model: AppMenuModel
): ModeSwitchModel | undefined => {
  const kind = model.mode?.kind;
  if (kind === 'replay' || kind === 'tutorial') return undefined;
  if (model.onPlaySolo) return { current: 'online', onSolo: model.onPlaySolo };
  if (kind === 'solo') {
    return {
      current: 'solo',
      ...(model.onPlayOnline ? { onOnline: model.onPlayOnline } : {}),
    };
  }
  if (kind === 'online' || kind === 'watching') {
    return {
      current: 'online',
      ...(model.onLeave ? { onSolo: model.onLeave } : {}),
      ...(kind === 'watching' ? { watching: true } : {}),
      ...(model.mode?.connecting ? { connecting: true } : {}),
      ...(model.mode?.detail ? { detail: model.mode.detail } : {}),
      ...(model.mode?.code ? { code: model.mode.code } : {}),
      ...(model.onRoom ? { onRoom: model.onRoom } : {}),
    };
  }
  return undefined;
};

/**
 * Where this table is played, as a switch at the start of the bar: Solo
 * or Online, the one in play pressed and first (they slide past each
 * other when it changes). The other side goes there -- Play
 * online's page from a Solo table, the Solo table from that page, and out
 * of a room (asked first). Online, a light says whether the room is
 * connected.
 */
const ModeSwitch = ({ mode }: { readonly mode: ModeSwitchModel }) => {
  const { t } = useLingui();
  const soloName = t({
    message: 'Solo',
    context: 'playing alone at this table',
  });
  // In a room it says the room's code, which is how others join it.
  const onlineName =
    mode.code ??
    (mode.watching
      ? t({ message: 'Watching', context: 'spectating a room' })
      : t({ message: 'Online', context: 'playing against someone' }));
  const solo = mode.current === 'solo';
  const group = useRef<HTMLDivElement>(null);
  useModeSwitchSlide(group, mode.current);
  const soloTip = solo
    ? soloName
    : mode.onSolo && mode.current === 'online' && mode.detail !== undefined
      ? t`Leave room`
      : t`Solo table`;
  const onlineTip = solo
    ? t`Play online`
    : mode.onRoom
      ? t({ message: 'Room', context: 'an online room' })
      : (mode.detail ?? onlineName);
  // The side in play comes first, the other after it; they slide past
  // each other when it changes.
  const soloSide = (
    <Tooltip key="solo" content={soloTip} side="bottom">
      <button
        id="p1Button"
        type="button"
        className="ptcgsim-app-bar__switch-option"
        aria-pressed={solo}
        aria-disabled={!solo && !mode.onSolo ? true : undefined}
        onClick={() => {
          if (!solo) mode.onSolo?.();
        }}
      >
        <UserIcon aria-hidden="true" weight="bold" />
        <span className="ptcgsim-app-bar__switch-name">{soloName}</span>
      </button>
    </Tooltip>
  );
  const onlineSide = (
    <Tooltip key="online" content={onlineTip} side="bottom" tapToShow={!solo}>
      <button
        id="p2Button"
        type="button"
        className="ptcgsim-app-bar__switch-option"
        aria-pressed={!solo}
        aria-disabled={
          (solo && !mode.onOnline) || (!solo && !mode.onRoom) ? true : undefined
        }
        data-connecting={mode.connecting ? 'true' : undefined}
        data-room-code={mode.code}
        data-watching={mode.watching ? 'true' : undefined}
        {...(mode.watching && mode.code
          ? {
              'aria-label': t({
                message: `Watching room ${mode.code}`,
                comment: 'mode.code is a short room code like K7PQ',
              }),
            }
          : {})}
        onClick={() => {
          if (solo) mode.onOnline?.();
          else mode.onRoom?.();
        }}
      >
        {solo ? (
          <UsersThreeIcon aria-hidden="true" weight="bold" />
        ) : (
          <span className="ptcgsim-app-bar__mode-light" aria-hidden="true" />
        )}
        {/* Watching a room by its code: an eye says so. */}
        {!solo && mode.watching && mode.code ? (
          <EyeIcon aria-hidden="true" weight="bold" />
        ) : null}
        <span
          className="ptcgsim-app-bar__switch-name"
          data-code={mode.code ? 'true' : undefined}
        >
          {onlineName}
        </span>
      </button>
    </Tooltip>
  );
  return (
    <div
      ref={group}
      className="ptcgsim-app-bar__switch"
      role="group"
      aria-label={t({ message: 'Mode', context: 'solo or online play' })}
      data-current={mode.current}
    >
      {solo ? [soloSide, onlineSide] : [onlineSide, soloSide]}
    </div>
  );
};

const MODE_ICONS: Partial<Record<TableMode['kind'], Icon>> = {
  solo: UserIcon,
  watching: EyeIcon,
  replay: FilmReelIcon,
  tutorial: GraduationCapIcon,
};

/**
 * Where this table is played, at the start of the bar: a name, not a
 * button. Online it leads with a light, green while the room is connected
 * and amber until it is. On a phone held upright only that light shows, in
 * the bar's corner, and the name is left to assistive technology.
 */
const ModeLabel = ({
  mode,
  lightOnly,
}: {
  readonly mode: TableMode;
  readonly lightOnly: boolean;
}) => {
  const { t } = useLingui();
  const name = {
    solo: t({ message: 'Solo', context: 'playing alone at this table' }),
    online:
      mode.code ?? t({ message: 'Online', context: 'playing against someone' }),
    watching: t({ message: 'Watching', context: 'spectating a room' }),
    replay: t({ message: 'Replay', context: 'the table is showing a replay' }),
    tutorial: t`Tutorial`,
  }[mode.kind];
  const ModeIcon = MODE_ICONS[mode.kind];
  const lit = mode.connecting || !ModeIcon;
  const label = (
    <span
      className="ptcgsim-app-bar__mode"
      data-table-mode={mode.kind}
      data-connecting={mode.connecting ? 'true' : undefined}
      data-light-only={lightOnly ? 'true' : undefined}
    >
      {lit ? (
        <span className="ptcgsim-app-bar__mode-light" aria-hidden="true" />
      ) : lightOnly ? null : (
        <ModeIcon aria-hidden="true" weight="bold" />
      )}
      <span
        className={
          lightOnly ? 'ds-visually-hidden' : 'ptcgsim-app-bar__mode-name'
        }
      >
        {name}
      </span>
    </span>
  );
  return mode.detail && !lightOnly ? (
    <Tooltip content={mode.detail} side="bottom" tapToShow>
      {label}
    </Tooltip>
  ) : (
    label
  );
};

/**
 * What the bar shows of `model`, and what it leaves to Settings: on a
 * phone the bar keeps the palette, the log and Settings, so the deck (and,
 * held upright, where to play) are Settings' first rows.
 */
export const useAppBarPlacement = (
  model: AppMenuModel
): {
  readonly modeSwitch: ModeSwitchModel | undefined;
  readonly places: readonly ToolbarEntry[];
  readonly commands: ToolbarEntry | undefined;
  readonly inSettings: readonly ToolbarEntry[];
  readonly narrow: boolean;
} => {
  const hint = useHotkeyHints();
  const compact = useCompactLayout();
  const narrow = useMediaQuery(NARROW_BAR_QUERY);
  // Solo or Online, as a switch where the bar has room for it; a phone held
  // upright keeps only the light, and where to play leads Settings.
  const modeSwitch = narrow ? undefined : modeSwitchOf(model);
  const primary = primaryEntries(model, hint('table.commands')).filter(
    (entry) =>
      !modeSwitch || (entry.id !== 'p1Button' && entry.id !== 'p2Button')
  );
  // A phone's bar keeps only the palette of these.
  const onBar = (entry: ToolbarEntry): boolean =>
    !compact || entry.id === 'commandsButton';
  return {
    modeSwitch,
    places: primary.filter(
      (entry) => onBar(entry) && entry.id !== 'commandsButton'
    ),
    commands: primary.find((entry) => entry.id === 'commandsButton'),
    inSettings: primary.filter((entry) => !onBar(entry)),
    narrow,
  };
};

/**
 * The app bar (ADR-036), in the table's top-right corner, clear of the
 * play: where this table is played (Solo, Online…), the deck, the command
 * palette and the log, then Settings (ADR-045), which holds everything
 * else -- invites, saves and replays, the tutorial, how the table looks,
 * help, leaving. On a phone the bar keeps the palette, the log and
 * Settings. The game's own actions are not here: they lie on the table,
 * along the seam.
 */
export const AppBar = ({
  model,
  log,
}: {
  readonly model: AppMenuModel;
  /** The log's button (ActivityLauncher), after the palette. */
  readonly log?: ReactNode;
}) => {
  const { t } = useLingui();
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const compact = useCompactLayout();
  const { modeSwitch, places, commands, narrow } = useAppBarPlacement(model);
  const settingsLabel = t`Settings`;
  return (
    <div
      className="ptcgsim-app-bar"
      role="toolbar"
      aria-label={t({ message: 'App', context: 'the app toolbar' })}
      onFocus={noteFocusArrival}
      onKeyDown={moveAlongToolbar}
      data-compact={compact ? 'true' : undefined}
      style={
        {
          '--app-bar-button': `${String(appBarButtonPx(coarse))}px`,
          '--app-bar-mode': `${String(APP_BAR_MODE_PX)}px`,
        } as CSSProperties
      }
    >
      {modeSwitch ? (
        <div className="ptcgsim-app-bar__group">
          <ModeSwitch mode={modeSwitch} />
        </div>
      ) : model.mode && narrow ? (
        <ModeLabel mode={model.mode} lightOnly />
      ) : model.mode ? (
        <div className="ptcgsim-app-bar__group">
          <ModeLabel mode={model.mode} lightOnly={false} />
        </div>
      ) : null}
      {places.length > 0 ? (
        <div className="ptcgsim-app-bar__group">
          {places.map((entry) => (
            <BarButton key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
      {commands || log ? (
        <div className="ptcgsim-app-bar__group">
          {commands ? <BarButton entry={commands} /> : null}
          {log}
        </div>
      ) : null}
      <div className="ptcgsim-app-bar__group">
        {/* Quiet while Settings is open, as a menu's button is: the bar
            may move under a resting pointer as the drawer docks. */}
        <Tooltip
          content={settingsLabel}
          side="bottom"
          disabled={model.settingsOpen === true}
        >
          <RailButton
            id="settingsButton"
            icon={GearSixIcon}
            label={settingsLabel}
            iconOnly
            aria-expanded={model.settingsOpen === true}
            aria-controls={model.settingsOpen ? 'settings' : undefined}
            onClick={() => model.onSettings()}
          />
        </Tooltip>
      </div>
    </div>
  );
};
