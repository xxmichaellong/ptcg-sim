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
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import { useMemo, type CSSProperties, type ReactNode } from 'react';

import {
  moveAlongToolbar,
  noteFocusArrival,
  RailButton,
} from '../../board/rail/TableRail.js';
import { useHotkeyHints } from '../../hotkeys/hotkey-preferences.js';
import { openCommandPalette } from '../../commands/palette-state.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { DeckIcon } from '../../ui/DeckIcon.js';
import {
  COARSE_POINTER_QUERY,
  TOUCH_ONLY_QUERY,
  useCompactLayout,
  useMediaQuery,
} from '../../ui/breakpoints.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';
import type { RoomInviteRole } from '../room-invites.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';
import './app-menu.css';

/**
 * Where this table is played, named at the start of the bar: alone (Solo),
 * against someone (Online), watching a room, a replay or the tutorial.
 */
export interface TableMode {
  readonly kind: 'solo' | 'online' | 'watching' | 'replay' | 'tutorial';
  /** Online or watching: not (or no longer) connected to the room. */
  readonly connecting?: boolean;
  /** Shown on hover or a tap: the room ("Room K7PQ2M"), or "Connecting…". */
  readonly detail?: string;
}

/** What the app menu can do in the current room and mode. */
export interface AppMenuModel {
  /** The room in a line, at the top of the menu. */
  readonly heading?: ReactNode;
  /** The bar's label: Solo, Online and so on. */
  readonly mode?: TableMode;
  /** Back to the Solo table, from the lobby. */
  readonly onPlaySolo?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDeck?: () => void;
  readonly onSettings: () => void;
  /**
   * The room's invites (ADR-020): a link for the opponent's seat, off once
   * it is taken, and one for a spectator, where the room can mint them.
   */
  readonly invites?: {
    readonly roles: readonly RoomInviteRole[];
    readonly seatTaken: boolean;
    readonly onInvite: (role: RoomInviteRole) => void;
  };
  /** Saves and replays; each present only where it applies. */
  readonly game?: {
    readonly onImportReplay?: () => void;
    readonly onExportState?: () => void;
    readonly onSaveOnline?: () => void;
    readonly onResumeSaved?: () => void;
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

/** A toolbar button, and the same row in the narrow rail's menu. */
interface ToolbarEntry {
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

/** The groups that have entries, a separator between each two. */
const grouped = (
  ...groups: readonly (readonly ActionMenuEntry[])[]
): ActionMenuEntry[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0 ? [...group] : [{ kind: 'separator' as const }, ...group]
    );

/**
 * The menu (☰): what can be done here, Settings among it. In a room the
 * invites, the game's saves, Settings and the way out; at a Solo table
 * Settings first, then the replays. A replay's way out leads; the
 * tutorial's comes last.
 */
export const restEntries = (
  model: AppMenuModel,
  settingsHint?: string
): ActionMenuEntry[] => {
  const game = model.game;
  const exit: ActionMenuEntry[] = [];
  if (game?.onExitReplay) {
    exit.push({
      // The rail's Exit keeps v1's `#exitReplay`.
      id: 'exitReplayMenuItem',
      label: t`Exit replay`,
      icon: XCircleIcon,
      onSelect: game.onExitReplay,
    });
  }
  const gameEntries: ActionMenuEntry[] = [];
  if (game?.onImportReplay) {
    gameEntries.push({
      id: 'importReplay',
      label: t`Watch replay…`,
      icon: FilmReelIcon,
      disabled: game.busy === true,
      onSelect: game.onImportReplay,
    });
  }
  if (game?.onSaveOnline) {
    gameEntries.push({
      id: 'saveOnlineGame',
      label: t`Save game`,
      icon: CloudArrowUpIcon,
      disabled: game.busy === true,
      onSelect: game.onSaveOnline,
    });
  }
  if (game?.onResumeSaved) {
    gameEntries.push({
      id: 'resumeSavedGame',
      label: t`Resume saved game…`,
      icon: FolderOpenIcon,
      disabled: game.busy === true,
      onSelect: game.onResumeSaved,
    });
  }
  if (game?.onExportState) {
    gameEntries.push({
      id: 'exportState',
      label: t`Download replay`,
      icon: DownloadSimpleIcon,
      onSelect: game.onExportState,
    });
  }

  const page: ActionMenuEntry[] = [
    {
      id: 'settingsButton',
      label: t`Settings`,
      icon: GearSixIcon,
      hint: settingsHint,
      onSelect: model.onSettings,
    },
  ];
  if (model.onTutorial && !model.onExitTutorial) {
    page.push({
      id: 'tutorialButton',
      label: t`Tutorial`,
      icon: GraduationCapIcon,
      onSelect: model.onTutorial,
    });
  }

  const invites = model.invites;
  const inviteEntries: ActionMenuEntry[] = [];
  if (invites?.roles.includes('player')) {
    inviteEntries.push({
      id: 'inviteOpponentMenuItem',
      // Taken, the seat can't be offered again: the row says why.
      label: invites.seatTaken ? (
        <>
          {t`Invite opponent`}{' '}
          <span className="app-menu-detail">{t`Seat taken`}</span>
        </>
      ) : (
        t`Invite opponent`
      ),
      icon: UserPlusIcon,
      disabled: invites.seatTaken,
      onSelect: () => invites.onInvite('player'),
    });
  }
  if (invites?.roles.includes('spectator')) {
    inviteEntries.push({
      id: 'inviteSpectatorMenuItem',
      label: t`Invite spectator`,
      icon: EyeIcon,
      onSelect: () => invites.onInvite('spectator'),
    });
  }

  const leave: ActionMenuEntry[] = [];
  if (model.onExitTutorial) {
    leave.push({
      id: 'leaveTutorialButton',
      label: t`Leave tutorial`,
      icon: GraduationCapIcon,
      onSelect: model.onExitTutorial,
    });
  }
  if (model.onLeave) {
    leave.push({
      id: 'leaveRoomButton',
      label: t`Leave room`,
      icon: SignOutIcon,
      mirrored: true,
      danger: true,
      onSelect: model.onLeave,
    });
  }

  return inviteEntries.length > 0 || model.onLeave
    ? grouped(exit, inviteEntries, gameEntries, page, leave)
    : grouped(exit, page, gameEntries, leave);
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
 * the log and the menu; elsewhere also the deck. Where to play is the
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
  /** The room ("Room K7PQ2M"), on the online side's tooltip. */
  readonly detail?: string;
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
    };
  }
  return undefined;
};

/**
 * Where this table is played, as a switch at the start of the bar: Solo
 * or Online, the one in play pressed. The other side goes there -- Play
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
  const onlineName = mode.watching
    ? t({ message: 'Watching', context: 'spectating a room' })
    : t({ message: 'Online', context: 'playing against someone' });
  const solo = mode.current === 'solo';
  const soloTip = solo
    ? soloName
    : mode.onSolo && mode.current === 'online' && mode.detail !== undefined
      ? t`Leave room`
      : t`Solo table`;
  const onlineTip = solo ? t`Play online` : (mode.detail ?? onlineName);
  return (
    <div
      className="ptcgsim-app-bar__switch"
      role="group"
      aria-label={t({ message: 'Mode', context: 'solo or online play' })}
      data-current={mode.current}
    >
      <Tooltip content={soloTip} side="bottom">
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
      <Tooltip content={onlineTip} side="bottom" tapToShow={!solo}>
        <button
          id="p2Button"
          type="button"
          className="ptcgsim-app-bar__switch-option"
          aria-pressed={!solo}
          aria-disabled={solo && !mode.onOnline ? true : undefined}
          data-connecting={mode.connecting ? 'true' : undefined}
          onClick={() => {
            if (solo) mode.onOnline?.();
          }}
        >
          {solo ? (
            <UsersThreeIcon aria-hidden="true" weight="bold" />
          ) : (
            <span className="ptcgsim-app-bar__mode-light" aria-hidden="true" />
          )}
          <span className="ptcgsim-app-bar__switch-name">{onlineName}</span>
        </button>
      </Tooltip>
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
    online: t({ message: 'Online', context: 'playing against someone' }),
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
 * The app bar (ADR-036), in the table's top-right corner, clear of the
 * play: where this table is played (Solo, Online…), the deck and where to
 * play, then the command palette and the log,
 * then the menu (☰) with what else can be done here -- Settings, full
 * screen, saves and replays, invites, leaving. On a phone the bar keeps
 * the palette, the log and the menu, and the menu leads with the rest. The
 * game's own actions are not here: they lie on the table, along the seam.
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
  const hint = useHotkeyHints();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const compact = useCompactLayout();
  const narrow = useMediaQuery(NARROW_BAR_QUERY);
  // Solo or Online, as a switch where the bar has room for it; a phone held
  // upright keeps only the light, and where to play leads its menu.
  const modeSwitch = narrow ? undefined : modeSwitchOf(model);
  const primary = primaryEntries(model, hint('table.commands')).filter(
    (entry) =>
      !modeSwitch || (entry.id !== 'p1Button' && entry.id !== 'p2Button')
  );
  // A phone's bar keeps only the palette of these.
  const onBar = (entry: ToolbarEntry): boolean =>
    !compact || entry.id === 'commandsButton';
  const places = primary.filter(
    (entry) => onBar(entry) && entry.id !== 'commandsButton'
  );
  const commands = primary.find((entry) => entry.id === 'commandsButton');
  const inMenu = primary.filter((entry) => !onBar(entry));
  // A touch screen has no keys to hint at.
  const rest = restEntries(
    model,
    touchOnly ? undefined : hint('table.settings')
  );
  const entries: ActionMenuEntry[] =
    inMenu.length > 0 ? [...inMenu, { kind: 'separator' }, ...rest] : rest;
  const header = model.heading ? (
    <div className="ptcgsim-app-menu-heading">{model.heading}</div>
  ) : undefined;
  const menuLabel = t({ message: 'Menu', context: 'the app menu' });
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
        <ActionMenu
          label={menuLabel}
          side="bottom"
          align="end"
          entries={entries}
          {...(header ? { header } : {})}
          tooltip={menuLabel}
          trigger={
            <RailButton
              id="appMenuButton"
              icon={ListIcon}
              label={menuLabel}
              iconOnly
            />
          }
        />
      </div>
    </div>
  );
};
