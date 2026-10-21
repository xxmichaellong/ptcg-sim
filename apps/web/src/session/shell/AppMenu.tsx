import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { DiscordLogoIcon } from '@phosphor-icons/react/dist/csr/DiscordLogo';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import type { Icon } from '@phosphor-icons/react';
import { CornersInIcon } from '@phosphor-icons/react/dist/csr/CornersIn';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { PlayCircleIcon } from '@phosphor-icons/react/dist/csr/PlayCircle';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import { RailButton, useRailWidth } from '../../board/rail/TableRail.js';
import { useHotkeyHints } from '../../hotkeys/hotkey-preferences.js';
import { openCommandPalette } from '../../commands/palette-state.js';
import { openShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { DeckIcon } from '../../ui/DeckIcon.js';
import { TOUCH_ONLY_QUERY, useMediaQuery } from '../../ui/breakpoints.js';
import {
  exitBrowserFullscreen,
  useBrowserFullscreen,
} from '../browser-room-options.js';
import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';
import { DISCORD_URL, openHelpPage, RELEASE_NAME } from './help-pages.js';
import { SHELL_PREFERENCES } from './shell-preferences.js';

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
  entries.push(
    {
      id: 'tutorialButton',
      label: t`Tutorial`,
      icon: PlayCircleIcon,
      onSelect: () => openHelpPage('tutorial'),
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

/** A rail at least this wide has room to open the toolbar along it. */
const TOOLBAR_MIN_RAIL_PX = 820;

/**
 * Opens and closes the drawer by its width, so the rail's game actions
 * (which start clear of the toolbar, TableRail.tsx) move with it frame by
 * frame. Open and at rest it is as wide as its buttons (`auto`), so a
 * button coming or going is never clipped; a press mid-way turns it round
 * from where it is. With motion reduced the transition is instant.
 */
const useDrawerWidth = (
  drawer: RefObject<HTMLDivElement | null>,
  items: RefObject<HTMLDivElement | null>,
  open: boolean
): void => {
  const settled = useRef(false);
  useLayoutEffect(() => {
    const element = drawer.current;
    const content = items.current;
    if (!element || !content) return;
    if (!settled.current) {
      settled.current = true;
      element.style.width = open ? 'auto' : '0px';
      return;
    }
    const from = element.getBoundingClientRect().width;
    const to = open ? content.offsetWidth : 0;
    const finish = (): void => {
      element.style.width = open ? 'auto' : '0px';
    };
    element.style.width = `${from}px`;
    // Commit the starting width, so the change below is a transition.
    void element.offsetWidth;
    element.style.width = `${to}px`;
    const seconds = Number.parseFloat(
      getComputedStyle(element).transitionDuration
    );
    if (!(seconds > 0) || from === to) {
      finish();
      return;
    }
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === 'width') {
        finish();
      }
    };
    element.addEventListener('transitionend', onEnd);
    // Should the end never come (a hidden tab), it is settled anyway.
    const fallback = window.setTimeout(finish, seconds * 1000 + 80);
    return () => {
      element.removeEventListener('transitionend', onEnd);
      window.clearTimeout(fallback);
    };
  }, [drawer, items, open]);
};

/**
 * The app toolbar (ADR-030), at the rail's left end. Its first button
 * opens it along the rail and closes it again, and the table keeps the
 * player's choice: open, it shows the deck, where to play, the keys and
 * Settings, with everything else -- saves and replays, view, help, leaving
 * -- behind its last button. A rail too narrow to open it along has the
 * first button open one menu holding it all. Everything that is not a game
 * action and not the log lives here; the log's own actions live with it.
 */
export const AppMenu = ({ model }: { readonly model: AppMenuModel }) => {
  const { t } = useLingui();
  const hint = useHotkeyHints();
  const touchOnly = useMediaQuery(TOUCH_ONLY_QUERY);
  const fullscreen = useBrowserFullscreen();
  const shell = usePreference(SHELL_PREFERENCES);
  const railWidth = useRailWidth();
  const roomy = railWidth === undefined || railWidth >= TOOLBAR_MIN_RAIL_PX;
  const open = roomy && !shell.toolbarCollapsed;
  const drawer = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLDivElement>(null);
  useDrawerWidth(drawer, items, open);
  const primary = primaryEntries(
    model,
    hint('table.shortcuts'),
    touchOnly,
    hint('table.commands')
  );
  const rest = restEntries(model, fullscreen);
  const header = model.heading ? (
    <div className="ptcgsim-app-menu-heading">{model.heading}</div>
  ) : undefined;
  if (!roomy) {
    // A rail button of its own, as finger-sized as the game actions.
    return (
      <ActionMenu
        label={t({ message: 'Menu', context: 'the app menu' })}
        // Beside the button, centred on the seam, it has the window's whole
        // height to use.
        side="right"
        align="center"
        entries={[...primary, { kind: 'separator' }, ...rest]}
        {...(header ? { header } : {})}
        tooltip={t({ message: 'Menu', context: 'the app menu' })}
        trigger={
          <RailButton
            id="appMenuButton"
            icon={ListIcon}
            label={t({ message: 'Menu', context: 'the app menu' })}
            iconOnly
          />
        }
      />
    );
  }
  return (
    <div
      className="ptcgsim-app-toolbar"
      role="toolbar"
      aria-label={t({ message: 'App', context: 'the app toolbar' })}
      data-open={open ? 'true' : 'false'}
    >
      <Tooltip content={open ? t`Hide toolbar` : t`Show toolbar`} side="top">
        <RailButton
          id="appMenuButton"
          className="ptcgsim-app-toolbar__toggle"
          icon={ListIcon}
          label={t({ message: 'Menu', context: 'the app menu' })}
          iconOnly
          aria-expanded={open}
          aria-controls="appToolbarDrawer"
          onClick={() =>
            preferences().patch(SHELL_PREFERENCES, { toolbarCollapsed: open })
          }
        />
      </Tooltip>
      <div
        ref={drawer}
        id="appToolbarDrawer"
        className="ptcgsim-app-toolbar__drawer"
        inert={!open}
      >
        <div ref={items} className="ptcgsim-app-toolbar__items">
          {primary.map((entry, index) => (
            <Tooltip
              key={entry.id}
              content={withKeyHint(entry.label, entry.hint)}
              side="top"
            >
              <RailButton
                id={entry.id}
                icon={entry.icon}
                label={entry.label}
                iconOnly
                style={{ '--i': index } as CSSProperties}
                onClick={() => entry.onSelect()}
              />
            </Tooltip>
          ))}
          <ActionMenu
            // Named for its button, as the menu itself is.
            label={t({ message: 'More', context: 'more options' })}
            side="right"
            align="center"
            entries={rest}
            {...(header ? { header } : {})}
            tooltip={t`More options`}
            trigger={
              <RailButton
                id="appMoreButton"
                icon={DotsThreeIcon}
                label={t({ message: 'More', context: 'more options' })}
                iconOnly
                style={{ '--i': primary.length } as CSSProperties}
              />
            }
          />
        </div>
      </div>
    </div>
  );
};
