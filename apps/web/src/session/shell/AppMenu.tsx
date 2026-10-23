import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import type { Icon } from '@phosphor-icons/react';
import { CornersInIcon } from '@phosphor-icons/react/dist/csr/CornersIn';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
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
import {
  exitBrowserFullscreen,
  useBrowserFullscreen,
} from '../browser-room-options.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';

/** What the app menu can do in the current room and mode. */
export interface AppMenuModel {
  /** The room in a line, at the top of the menu. */
  readonly heading?: ReactNode;
  /** Back to the Solo table, from the lobby. */
  readonly onPlaySolo?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDeck?: () => void;
  readonly onSettings: () => void;
  readonly onCopyInvitation?: () => void;
  readonly onFullscreen?: () => void;
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
 * What the toolbar shows as buttons while it is open: where to play, the
 * deck, the keys (not on a touch screen, which has none) and Settings.
 * Worded when the toolbar renders, in the language up then.
 */
export const primaryEntries = (
  model: AppMenuModel,
  shortcutsHint: string | undefined,
  touchOnly: boolean,
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
  if (!touchOnly) {
    entries.push({
      id: 'shortcutsButton',
      label: t`Keyboard shortcuts`,
      icon: KeyboardIcon,
      ...(shortcutsHint ? { hint: shortcutsHint } : {}),
      onSelect: () => openShortcutsDialog(),
    });
  }
  entries.push({
    id: 'settingsButton',
    label: t`Settings`,
    icon: GearSixIcon,
    onSelect: model.onSettings,
  });
  return entries;
};

/** Everything else, behind the toolbar's last button (More). */
export const restEntries = (
  model: AppMenuModel,
  fullscreen: boolean
): ActionMenuEntry[] => {
  const entries: ActionMenuEntry[] = [];
  const game = model.game;
  const gameEntries: ActionMenuEntry[] = [];
  if (game?.onExitReplay) {
    gameEntries.push({
      // The rail's Exit keeps v1's `#exitReplay`.
      id: 'exitReplayMenuItem',
      label: t`Exit replay`,
      icon: XCircleIcon,
      onSelect: game.onExitReplay,
    });
  }
  if (game?.onImportReplay) {
    gameEntries.push({
      id: 'importReplay',
      label: t`Watch a replay…`,
      icon: FilmReelIcon,
      disabled: game.busy === true,
      onSelect: game.onImportReplay,
    });
  }
  if (game?.onSaveOnline) {
    gameEntries.push({
      id: 'saveOnlineGame',
      label: t`Save online game`,
      icon: CloudArrowUpIcon,
      disabled: game.busy === true,
      onSelect: game.onSaveOnline,
    });
  }
  if (game?.onResumeSaved) {
    gameEntries.push({
      id: 'resumeSavedGame',
      label: t`Resume a saved game…`,
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
  entries.push(...gameEntries);

  const viewEntries: ActionMenuEntry[] = [];
  if (model.onFullscreen) {
    // Full screen already: the same entry takes the page back out.
    viewEntries.push(
      fullscreen
        ? {
            id: 'fullscreenButton',
            label: t`Exit full screen`,
            icon: CornersInIcon,
            onSelect: () => exitBrowserFullscreen(),
          }
        : {
            id: 'fullscreenButton',
            label: t`Full screen`,
            icon: CornersOutIcon,
            onSelect: model.onFullscreen,
          }
    );
  }
  if (viewEntries.length > 0) {
    if (entries.length > 0) entries.push({ kind: 'separator' });
    entries.push(...viewEntries);
  }

  if (entries.length > 0) entries.push({ kind: 'separator' });
  if (model.onExitTutorial) {
    entries.push({
      id: 'leaveTutorialButton',
      label: t`Leave tutorial`,
      icon: GraduationCapIcon,
      onSelect: model.onExitTutorial,
    });
  } else if (model.onTutorial) {
    entries.push({
      id: 'tutorialButton',
      label: t`Tutorial`,
      icon: GraduationCapIcon,
      onSelect: model.onTutorial,
    });
  }
  entries.push(
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
    }
  );

  if (model.onCopyInvitation || model.onLeave) {
    entries.push({ kind: 'separator' });
    if (model.onCopyInvitation) {
      entries.push({
        id: 'copyInvitationMenuItem',
        label: t`Copy an invitation`,
        icon: CopyIcon,
        onSelect: model.onCopyInvitation,
      });
    }
    if (model.onLeave) {
      entries.push({
        id: 'leaveRoomButton',
        label: t`Leave room`,
        icon: SignOutIcon,
        mirrored: true,
        danger: true,
        onSelect: model.onLeave,
      });
    }
  }
  return entries;
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
 * The most buttons the bar shows: on a phone the palette, the log and the
 * menu; elsewhere also the deck, where to play and Settings.
 */
export const APP_BAR_SLOTS = { full: 6, compact: 3 } as const;

/** The bar's box for that many buttons. */
export const appBarSize = (
  slots: number,
  coarse: boolean
): { readonly width: number; readonly height: number } => {
  const button = appBarButtonPx(coarse);
  return {
    width:
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
  return useMemo(
    () =>
      appBarSize(compact ? APP_BAR_SLOTS.compact : APP_BAR_SLOTS.full, coarse),
    [compact, coarse]
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

/**
 * The app bar (ADR-036), in the table's top-right corner, clear of the
 * play: the deck and where to play, then the command palette, the log and
 * Settings, then the menu (☰) with everything else -- the keys, full
 * screen, saves and replays, help, leaving. On a phone the bar keeps the
 * palette, the log and the menu, and the menu leads with the rest. The
 * game's own actions are not here: they lie on the table, along the seam.
 */
export const AppBar = ({
  model,
  log,
}: {
  readonly model: AppMenuModel;
  /** The log's button (ActivityLauncher), between the palette and Settings. */
  readonly log?: ReactNode;
}) => {
  const { t } = useLingui();
  const hint = useHotkeyHints();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const compact = useCompactLayout();
  const fullscreen = useBrowserFullscreen();
  const primary = primaryEntries(
    model,
    hint('table.shortcuts'),
    touchOnly,
    hint('table.commands')
  );
  // The keys have their own key (?) and the menu; a phone's bar keeps only
  // the palette of the rest.
  const onBar = (entry: ToolbarEntry): boolean =>
    compact ? entry.id === 'commandsButton' : entry.id !== 'shortcutsButton';
  const places = primary.filter(
    (entry) =>
      onBar(entry) &&
      entry.id !== 'commandsButton' &&
      entry.id !== 'settingsButton'
  );
  const commands = primary.find(
    (entry) => entry.id === 'commandsButton' && onBar(entry)
  );
  const settings = primary.find(
    (entry) => entry.id === 'settingsButton' && onBar(entry)
  );
  const inMenu = primary.filter((entry) => !onBar(entry));
  const rest = restEntries(model, fullscreen);
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
        } as CSSProperties
      }
    >
      {places.length > 0 ? (
        <div className="ptcgsim-app-bar__group">
          {places.map((entry) => (
            <BarButton key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
      {commands || log || settings ? (
        <div className="ptcgsim-app-bar__group">
          {commands ? <BarButton entry={commands} /> : null}
          {log}
          {settings ? <BarButton entry={settings} /> : null}
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
