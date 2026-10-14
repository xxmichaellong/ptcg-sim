import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { PlayCircleIcon } from '@phosphor-icons/react/dist/csr/PlayCircle';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import type { ReactNode } from 'react';

import { RailButton } from '../../board/rail/TableRail.js';
import { useHotkeyHints } from '../../hotkeys/hotkey-preferences.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { TOUCH_ONLY_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import { openHelpPage } from './help-pages.js';

/** What the app menu can do in the current room and mode. */
export interface AppMenuModel {
  /** The room in a line, at the top of the menu. */
  readonly heading?: ReactNode;
  /** Back to the Solo table, from the lobby. */
  readonly onPlaySolo?: () => void;
  readonly onPlayOnline?: () => void;
  readonly onDeck?: () => void;
  readonly onSettings: () => void;
  readonly onReloadImages?: () => void;
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
}

const entriesFor = (
  model: AppMenuModel,
  shortcutsHint: string | undefined,
  reloadHint: string | undefined,
  touchOnly: boolean
): ActionMenuEntry[] => {
  const entries: ActionMenuEntry[] = [];
  if (model.onPlaySolo) {
    entries.push({
      id: 'p1Button',
      label: 'Solo table',
      icon: UserIcon,
      onSelect: model.onPlaySolo,
    });
  }
  if (model.onPlayOnline) {
    entries.push({
      id: 'p2Button',
      label: 'Play online…',
      icon: UsersThreeIcon,
      onSelect: model.onPlayOnline,
    });
  }
  if (model.onDeck) {
    entries.push({
      id: 'deckImportButton',
      label: 'Deck…',
      icon: CardsIcon,
      onSelect: model.onDeck,
    });
  }
  entries.push({
    id: 'settingsButton',
    label: 'Settings…',
    icon: GearSixIcon,
    onSelect: model.onSettings,
  });
  // A phone or a tablet without a pointer has no keys to list; Settings
  // still reaches them for one with a keyboard attached.
  if (!touchOnly) {
    entries.push({
      id: 'shortcutsButton',
      label: 'Keyboard shortcuts',
      icon: KeyboardIcon,
      ...(shortcutsHint ? { hint: shortcutsHint } : {}),
      onSelect: () => openShortcutsDialog(),
    });
  }

  const game = model.game;
  const gameEntries: ActionMenuEntry[] = [];
  if (game?.onExitReplay) {
    gameEntries.push({
      // The rail's Exit keeps v1's `#exitReplay`.
      id: 'exitReplayMenuItem',
      label: 'Exit replay',
      icon: XCircleIcon,
      onSelect: game.onExitReplay,
    });
  }
  if (game?.onImportReplay) {
    gameEntries.push({
      id: 'importReplay',
      label: 'Watch a replay…',
      icon: FilmReelIcon,
      disabled: game.busy === true,
      onSelect: game.onImportReplay,
    });
  }
  if (game?.onSaveOnline) {
    gameEntries.push({
      id: 'saveOnlineGame',
      label: 'Save online game',
      icon: CloudArrowUpIcon,
      disabled: game.busy === true,
      onSelect: game.onSaveOnline,
    });
  }
  if (game?.onResumeSaved) {
    gameEntries.push({
      id: 'resumeSavedGame',
      label: 'Resume a saved game…',
      icon: FolderOpenIcon,
      disabled: game.busy === true,
      onSelect: game.onResumeSaved,
    });
  }
  if (game?.onExportState) {
    gameEntries.push({
      id: 'exportState',
      label: 'Download replay',
      icon: DownloadSimpleIcon,
      onSelect: game.onExportState,
    });
  }
  if (gameEntries.length > 0) {
    entries.push({ kind: 'separator' }, { kind: 'label', label: 'Game' });
    entries.push(...gameEntries);
  }

  const viewEntries: ActionMenuEntry[] = [];
  if (model.onFullscreen) {
    viewEntries.push({
      id: 'fullscreenButton',
      label: 'Full screen',
      icon: CornersOutIcon,
      onSelect: model.onFullscreen,
    });
  }
  if (model.onReloadImages) {
    viewEntries.push({
      id: 'reloadImagesButton',
      label: 'Reload card images',
      icon: ArrowClockwiseIcon,
      ...(reloadHint ? { hint: reloadHint } : {}),
      onSelect: model.onReloadImages,
    });
  }
  if (viewEntries.length > 0) {
    entries.push({ kind: 'separator' }, ...viewEntries);
  }

  entries.push(
    { kind: 'separator' },
    {
      label: 'Tutorial',
      icon: PlayCircleIcon,
      onSelect: () => openHelpPage('tutorial'),
    },
    {
      label: "What's new",
      icon: SparkleIcon,
      onSelect: () => openHelpPage('changelog'),
    }
  );

  if (model.onCopyInvitation || model.onLeave) {
    entries.push({ kind: 'separator' });
    if (model.onCopyInvitation) {
      entries.push({
        id: 'copyInvitationMenuItem',
        label: 'Copy an invitation',
        icon: CopyIcon,
        onSelect: model.onCopyInvitation,
      });
    }
    if (model.onLeave) {
      entries.push({
        id: 'leaveRoomButton',
        label: 'Leave room',
        icon: SignOutIcon,
        danger: true,
        onSelect: model.onLeave,
      });
    }
  }
  return entries;
};

/**
 * The app menu (ADR-030), at the rail's left end: where to play, the deck,
 * settings, saves and replays, view and help. Everything that is not a game
 * action and not the log lives here; the log's own actions live with it.
 */
export const AppMenu = ({ model }: { readonly model: AppMenuModel }) => {
  const hint = useHotkeyHints();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  return (
    <ActionMenu
      label="Menu"
      // Beside the button, centred on the seam, it has the window's whole
      // height to use.
      side="right"
      align="center"
      entries={entriesFor(
        model,
        hint('table.shortcuts'),
        hint('table.refreshImages'),
        touchOnly
      )}
      {...(model.heading
        ? {
            header: (
              <div className="ptcgsim-app-menu-heading">{model.heading}</div>
            ),
          }
        : {})}
      trigger={
        <RailButton id="appMenuButton" icon={ListIcon} label="Menu" iconOnly />
      }
    />
  );
};
