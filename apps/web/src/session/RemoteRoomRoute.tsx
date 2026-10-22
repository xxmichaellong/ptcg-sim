import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  serializeProjectedReplayFile,
  type ClientSessionFailure,
  type ProjectedReplayArtifact,
} from '@ptcgsim/client-session';
import {
  type BoardIntent,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { FastForwardIcon } from '@phosphor-icons/react/dist/csr/FastForward';
import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag';
import { SkipBackIcon } from '@phosphor-icons/react/dist/csr/SkipBack';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { SwordIcon } from '@phosphor-icons/react/dist/csr/Sword';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';
import type { RendererKind } from '../RendererSpikeBoard.js';
import type { RailAction } from '../board/rail/TableRail.js';
import { useBoardLook } from './useBoardLook.js';
import { boardViewSettings } from '../board/view/board-view-settings.js';
import type { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import type {
  DeckBuilderStore,
  DeckBuilderTarget,
} from '../features/deck/deck-builder-store.js';
import type { DeckBuilderCustody } from '../features/deck/DeckBuilderSession.js';
import {
  DeckScreenWarmup,
  LazyDeckBuilderSession,
} from '../features/deck/LazyDeckBuilderSession.js';
import { useHotkeyHints } from '../hotkeys/hotkey-preferences.js';
import { preferences as pagePreferences } from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { PresentationAnnouncer } from '../presentation/LegacyPresentationSurface.js';
import { ReplayModeShell } from '../replay/ReplayModeShell.js';
import type { ReplaySessionFailure } from '../replay/ReplaySessionCoordinator.js';
import {
  RAIL_PRIORITY,
  RemoteSessionBoard,
  type BoardCommands,
  type BoardOwnRailActions,
  type BoardRailModel,
  type RemoteBoardSubmissionResult,
} from './RemoteSessionBoard.js';
import {
  useLiveRoomControls,
  type OpponentInvitationDelivery,
} from './RemoteRoomLiveControls.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import type {
  BrowserRoomBackgroundRequest,
  RoomBackground,
} from './browser-room-background.js';
import type { BrowserCardBackRequest } from './browser-card-back.js';
import {
  downloadBrowserTextFile,
  fullscreenRefusedNotice,
  onFullscreenRefused,
  requestBrowserFullscreen,
  serializeBattleLog,
} from './browser-room-options.js';
import { useRoomBackground } from './useRoomBackground.js';
import { ActivityLauncher, ActivityPanel } from './shell/ActivitySheet.js';
import { AppBar, type AppMenuModel } from './shell/AppMenu.js';
import { DeckLayer } from './shell/DeckLayer.js';
import { OnlineSheet } from './shell/OnlineSheet.js';
import { SettingsSheet } from './shell/SettingsSheet.js';
import { seatStage } from '../board/seat-stage.js';
import { SHELL_PREFERENCES } from './shell/shell-preferences.js';
import { TableWelcome } from './shell/TableWelcome.js';
import { TutorialHost } from '../tutorial/TutorialHost.js';
import { startTutorial } from '../tutorial/tutorial-state.js';
import { lessonsFor } from '../tutorial/tutorial-lessons.js';
import { useInputMode } from '../tutorial/TutorialHost.js';
import { TableBanner, TableCentre, TableShell } from './shell/TableShell.js';
import { useActivityDocking } from './shell/useActivityDocking.js';
import type { ActionMenuEntry } from '../ui/ActionMenu.js';
import { DeckIcon } from '../ui/DeckIcon.js';
import { toast } from '../ui/toast.js';
import { Tooltip } from '../ui/Tooltip.js';
import { CommandSourceRegistration } from '../commands/registry.js';
import { roomCommands } from '../commands/room-commands.js';
import { tutorialLessonCommands } from '../commands/ui-commands.js';

const ignoreIntent = (_intent: BoardIntent): void => undefined;

export interface RemoteRoomRouteProps {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly roomMode?: 'solo' | 'multiplayer';
  /**
   * This Solo room is the tutorial's practice table (ADR-038): the coach
   * runs over it, at the lesson asked for (or the list of lessons).
   */
  readonly tutorial?: {
    readonly lesson?: string;
    readonly serial: number;
    readonly onExit: () => void;
  };
  /**
   * What opens over the table as it mounts: Play online, for a player who
   * left the tutorial's practice table for it.
   */
  readonly initialSheet?: 'online';
  /** Retained above the route when lobby/room transitions share Deck custody. */
  readonly deckStore?: DeckBuilderStore;
  readonly cardBackStore?: CardBackCustodyStore;
  readonly requestCardBack?: BrowserCardBackRequest;
  readonly deckSurfaceActivated?: boolean;
  readonly onDeckSurfaceActivate?: () => void;
  readonly onDeckCustodyChange?: (custody: DeckBuilderCustody) => void;
  readonly deckSessionPrepared?: boolean;
  /** Restored games retain the saved table rather than auto-installing editor state. */
  readonly installDeckOnSessionAttach?: boolean;
  readonly onDeckSessionAttach?: () => void;
  readonly onIntent?: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly onLeave?: () => void;
  /**
   * A fresh Solo table in place of one whose room was lost: what a failed
   * Solo session offers instead of leaving.
   */
  readonly onNewSoloTable?: () => void;
  /**
   * Whether the table is ready to be seen: the board has painted (or
   * failed), or the room has a failure to show over it. The lobby lifts the
   * loading screen on it (table-curtain.ts).
   */
  readonly onTableSettledChange?: (settled: boolean) => void;
  /** Atomic owner-level replacement after a server-held save is restored. */
  readonly onResumeSavedGame?: (
    contents: string,
    deliverOpponentInvitation: OpponentInvitationDelivery,
    signal: AbortSignal
  ) => Promise<void>;
  /**
   * Online save and resume are default-off on the Worker; their controls
   * appear only once it reports them enabled, never as buttons that fail.
   */
  readonly continuationAvailable?: boolean;
  /** Parks a live solo authority while the source Multiplayer tab is open. */
  readonly onMultiplayerNavigate?: () => void;
  /**
   * The lobby's Play online panel, shown in a sheet over a live Solo table
   * so the table stays mounted while its owner reads it. Parking happens
   * only when they act on it. Without this, Play online falls back to
   * `onMultiplayerNavigate`.
   */
  readonly multiplayerPanel?: (hidden: boolean) => ReactNode;
  readonly onMultiplayerPanelOpen?: () => void;
  /**
   * Mints and copies a fresh invitation from inside the room, for the seat
   * that holds creator custody.
   */
  readonly onCopyInvitation?: (
    role: 'player' | 'spectator'
  ) => Promise<boolean>;
  /** When supplied with onPreferencesChange, ownership remains above the route. */
  readonly preferences?: BoardPreferences;
  readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
  /** Page-local visual only; no room, replay, renderer, or storage ownership. */
  readonly background?: RoomBackground;
  readonly onBackgroundChange?: (background: RoomBackground) => void;
  /** Back to the default wallpaper; offered in Settings when supplied. */
  readonly onBackgroundReset?: () => void;
  readonly requestBackground?: BrowserRoomBackgroundRequest;
  readonly downloadTextFile?: (filename: string, contents: string) => boolean;
  readonly requestFullscreen?: () => boolean;
}

type RouteSheet = 'deck' | 'settings' | 'online';

/** A failure the room must show is reason enough to show the table. */
/** What a failed session says over the table, in the player's terms. */
const failureText = (failure: ClientSessionFailure): MessageDescriptor =>
  failure.retryable
    ? msg`Connection lost.`
    : failure.code === 'admission_rejected'
      ? msg`The room no longer has this seat.`
      : msg`Out of sync with the room.`;

/**
 * What a replay that failed says over the table. Its own message is a
 * developer's, in English, and stays in the banner's tooltip.
 */
const replayFailureText = (
  code: ReplaySessionFailure['code']
): MessageDescriptor => {
  switch (code) {
    case 'invalid_artifact':
      return msg`That replay file couldn't be opened.`;
    case 'interrupted':
      return msg`Replay interrupted. Try again.`;
    case 'session_failed':
      return msg`Lost the room during the replay.`;
    default:
      return msg`Replays aren't available right now.`;
  }
};

const SettledByFailure = ({
  onSettledChange,
}: {
  readonly onSettledChange?: (settled: boolean) => void;
}) => {
  const report = useRef(onSettledChange);
  report.current = onSettledChange;
  useEffect(() => {
    report.current?.(true);
  }, []);
  return null;
};

/**
 * The room screen (ADR-030): the table fills the window. Its rail holds the
 * turn's actions between the app menu and the activity log; everything else
 * opens over it -- the deck screen, Settings, Play online, the log.
 */
export const RemoteRoomRoute = ({
  runtime,
  rendererKind,
  roomMode = 'multiplayer',
  tutorial,
  initialSheet,
  deckStore,
  cardBackStore,
  requestCardBack,
  deckSurfaceActivated = false,
  onDeckSurfaceActivate,
  onDeckCustodyChange,
  deckSessionPrepared = false,
  installDeckOnSessionAttach = true,
  onDeckSessionAttach,
  onIntent = ignoreIntent,
  onSubmission,
  onLeave,
  onNewSoloTable,
  onTableSettledChange,
  onResumeSavedGame,
  continuationAvailable = false,
  onMultiplayerNavigate,
  multiplayerPanel,
  onMultiplayerPanelOpen,
  onCopyInvitation,
  preferences: ownedPreferences,
  onPreferencesChange,
  background: ownedBackground,
  onBackgroundChange,
  onBackgroundReset,
  requestBackground,
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
}: RemoteRoomRouteProps) => {
  const { t, i18n } = useLingui();
  const solo = roomMode === 'solo';
  const inputMode = useInputMode();
  const backgroundSelection = useRoomBackground({
    ...(ownedBackground ? { background: ownedBackground } : {}),
    ...(onBackgroundChange ? { onBackgroundChange } : {}),
    ...(requestBackground ? { requestBackground } : {}),
  });
  const [sheet, setSheet] = useState<RouteSheet | undefined>(initialSheet);
  const closeSheet = (): void => setSheet(undefined);
  const activity = useActivityDocking();
  const [perspective, setPerspective] = useState<{
    readonly flipped: boolean;
    readonly actingPlayerId: string | undefined;
  }>({ flipped: false, actingPlayerId: undefined });
  const [locallyActivatedDeck, setLocallyActivatedDeck] = useState(false);
  const deckActivated = deckSurfaceActivated || locallyActivatedDeck;
  const [deckTarget, setDeckTarget] = useState<DeckBuilderTarget>();
  const openDeck = (target?: DeckBuilderTarget): void => {
    setLocallyActivatedDeck(true);
    onDeckSurfaceActivate?.();
    setDeckTarget(target);
    setSheet('deck');
  };
  const boardCommands = useRef<BoardCommands>(null);
  const [localPreferences, setLocalPreferences] = useState<
    BoardPreferences | undefined
  >(ownedPreferences);
  const preferences = onPreferencesChange ? ownedPreferences : localPreferences;
  // How the table is shown is the player's own, kept on this device and
  // edited from Settings.
  const boardView = useSyncExternalStore(
    boardViewSettings().subscribe,
    boardViewSettings().getSnapshot
  );
  const hideOpponentHand = boardView.hideOpponentHand;
  // The live session's own failure (the replay state only passes on its
  // message): whether the connection failed, so the seat can be asked for
  // again.
  const sessionFailure = useSyncExternalStore(
    runtime.session.subscribe,
    () => runtime.session.getSnapshot().failure
  );

  // Reduced motion is the player's (or the system's) choice, never stored in
  // the board preferences the route publishes upward.
  const storedPreferences = preferences ?? ROOM_DEFAULT_PREFERENCES;
  const effectivePreferences = useBoardLook(storedPreferences);
  // The whole page wears the table's theme (Night or Day). Its motion
  // choice is published page-wide from main.tsx (installPageMotion).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectivePreferences.darkMode ? 'night' : 'day';
  }, [effectivePreferences.darkMode]);
  const publishPreferences = (next: BoardPreferences): void => {
    if (onPreferencesChange) onPreferencesChange(next);
    else setLocalPreferences(next);
  };
  const setDarkMode = (enabled: boolean): void => {
    publishPreferences({
      ...effectivePreferences,
      darkMode: enabled,
    });
  };
  const downloadPerspectiveReplay = (
    artifact: ProjectedReplayArtifact
  ): void => {
    void serializeProjectedReplayFile(artifact)
      .then((contents) =>
        downloadTextFile('ptcgsim-perspective-replay.json', contents)
      )
      .catch(() => undefined);
  };
  const copyInvitation = async (
    role: 'player' | 'spectator'
  ): Promise<void> => {
    if (!onCopyInvitation) return;
    const copied = await onCopyInvitation(role).catch(() => false);
    toast(
      copied
        ? { title: t`Invitation copied`, tone: 'success' }
        : { title: t`Couldn't copy the invitation`, tone: 'danger' }
    );
  };
  const exportLivePerspective = (): void => {
    void runtime.exportReplay().then((result) => {
      if (result.ok) downloadPerspectiveReplay(result.artifact);
    });
  };
  const live = useLiveRoomControls({
    session: runtime.session,
    presentation: runtime.presentation,
    roomMode,
    boardFlipped: perspective.flipped,
    ...(perspective.actingPlayerId
      ? { actingPlayerId: perspective.actingPlayerId }
      : {}),
    ...(onLeave ? { onLeave } : {}),
    onExportState: exportLivePerspective,
    onImportReplayFile: (contents) =>
      runtime.replay.importReplayFileBytes(contents),
    ...(continuationAvailable
      ? {
          onSaveOnlineGame: (signal: AbortSignal) =>
            runtime.saveOnlineGame(downloadTextFile, signal),
          ...(onResumeSavedGame ? { onResumeSavedGame } : {}),
        }
      : {}),
    downloadTextFile,
    requestFullscreen,
  });
  const hint = useHotkeyHints();
  // A browser that takes the request and then declines it says so only
  // with an event; the player hears it too.
  useEffect(
    () => onFullscreenRefused(() => toast(fullscreenRefusedNotice())),
    []
  );
  const shellPreferences = usePreference(SHELL_PREFERENCES);
  const exportBattleLog = (): void => {
    downloadTextFile(
      'battle-log.txt',
      serializeBattleLog(runtime.presentation.activityFeed.getSnapshot().items)
    );
  };
  const openPlayOnline =
    solo && multiplayerPanel
      ? () => {
          setSheet('online');
          onMultiplayerPanelOpen?.();
        }
      : solo && onMultiplayerNavigate
        ? onMultiplayerNavigate
        : undefined;

  return (
    <ReplayModeShell coordinator={runtime.replay}>
      {({ state, chrome, handlers, exitReplay }) => {
        const replaying = chrome.active;
        const soloLive = !replaying && solo;
        const feedId = replaying || soloLive ? 'chatbox' : 'p2Chatbox';
        const stage = seatStage(state.view, live.playerId);
        // Both sides are set up or reset only once either has a deck to use;
        // before that the pair would only report two invalid decks.
        const anySeatHasDeck =
          state.view?.playerOrder.some(
            (playerId) => seatStage(state.view, playerId) !== 'empty'
          ) ?? false;
        const roomCode = runtime.roomCode;
        const roomName = replaying
          ? t({ message: 'Replay', context: 'the table is showing a replay' })
          : solo
            ? t`Solo table`
            : state.sessionPhase === 'ready'
              ? t({
                  message: `Room ${roomCode}`,
                  comment: 'roomCode is a short code like K7PQ2M',
                })
              : t`Connecting…`;
        const canCopy =
          !replaying &&
          onCopyInvitation !== undefined &&
          state.sessionPhase === 'ready';
        const deckOpen = sheet === 'deck' && !replaying;
        // The deck the rail loads or changes is the acting seat's: P2's at a
        // Solo table turned around.
        const actingTarget: DeckBuilderTarget =
          live.playerId !== undefined && live.playerId !== live.ownSeat
            ? 'alternate'
            : 'main';
        const ids = solo
          ? {
              setup: 'setupButton',
              reset: 'resetButton',
              attack: 'attackButton',
              pass: 'passButton',
              undo: 'undoButton',
            }
          : {
              setup: 'p2SetupButton',
              reset: 'p2ResetButton',
              attack: 'p2AttackButton',
              pass: 'p2PassButton',
              undo: 'p2UndoButton',
            };

        const compose = (
          own: BoardOwnRailActions
        ): ReturnType<BoardRailModel['compose']> => {
          if (replaying) {
            return {
              actions: [
                {
                  id: 'setupButton',
                  label: t({ message: 'Restart', context: 'replay' }),
                  title: t`Restart replay`,
                  icon: SkipBackIcon,
                  priority: 3,
                  onSelect: handlers.restart,
                },
                {
                  id: 'resetButton',
                  label: t({
                    message: 'Back',
                    context: 'replay: one step back',
                  }),
                  title: t`Previous replay action`,
                  icon: CaretLeftIcon,
                  priority: 1,
                  onSelect: handlers.previous,
                },
                {
                  id: 'setupBothButton',
                  label: t({ message: 'Next', context: 'replay: one step on' }),
                  title: t`Next replay action`,
                  icon: CaretRightIcon,
                  primary: true,
                  priority: 0,
                  onSelect: handlers.next,
                },
                {
                  id: 'resetBothButton',
                  label: t({
                    message: 'End',
                    context: 'replay: go to the end',
                  }),
                  title: t`Fast-forward replay`,
                  icon: FastForwardIcon,
                  priority: 2,
                  onSelect: handlers.fastForward,
                },
                ...(own.switchSide ? [own.switchSide] : []),
                {
                  id: 'exitReplay',
                  label: t({ message: 'Exit', context: 'leave the replay' }),
                  title: t`Exit replay mode`,
                  icon: XCircleIcon,
                  priority: 4,
                  onSelect: exitReplay,
                },
              ],
            };
          }
          if (!live.playerControls) {
            return { actions: own.switchSide ? [own.switchSide] : [] };
          }
          const setup: RailAction = {
            id: ids.setup,
            label: t({ message: 'Set up', context: 'set up the game' }),
            title: t`Shuffle, draw 7, set 6 prizes`,
            icon: StackIcon,
            hint: hint('table.setup'),
            priority: RAIL_PRIORITY.lead,
            onSelect: () => live.submitLifecycle('setup'),
          };
          const actions: RailAction[] = [];
          if (stage === 'empty') {
            if (chrome.visibility.deckImport) {
              actions.push({
                id: 'loadDeckButton',
                label: t`Load a deck`,
                icon: DeckIcon,
                primary: true,
                priority: RAIL_PRIORITY.lead,
                onSelect: () => openDeck(actingTarget),
              });
            }
          } else if (stage === 'loaded') {
            actions.push({ ...setup, primary: true });
          } else {
            if (own.turn) actions.push(own.turn);
            actions.push(
              {
                id: ids.attack,
                label: t({ message: 'Attack', context: 'declare an attack' }),
                icon: SwordIcon,
                priority: RAIL_PRIORITY.attack,
                onSelect: () => live.submitTable('attack'),
              },
              {
                id: ids.pass,
                label: t({ message: 'Pass', context: 'end the turn' }),
                title: t`Pass the turn`,
                icon: FlagIcon,
                priority: RAIL_PRIORITY.pass,
                onSelect: () => live.submitTable('pass'),
              }
            );
          }
          if (own.coin) actions.push(own.coin);
          if (stage !== 'empty') {
            actions.push({
              id: ids.undo,
              label: t`Undo`,
              icon: ArrowCounterClockwiseIcon,
              priority: RAIL_PRIORITY.undo,
              hint: hint('table.undo'),
              onSelect: live.submitUndo,
            });
          }
          if (own.switchSide) actions.push(own.switchSide);

          const more: ActionMenuEntry[] = [];
          if (stage === 'playing') {
            more.push({ ...setup, label: t`Set up again` });
            if (own.mulligan) more.push(own.mulligan);
          }
          if (stage !== 'empty') {
            more.push({
              id: ids.reset,
              label: t({ message: 'Reset', context: 'reset the table' }),
              icon: ArrowsClockwiseIcon,
              hint: hint('table.reset'),
              onSelect: () => live.submitLifecycle('reset'),
            });
          }
          if (solo && anySeatHasDeck) {
            if (more.length > 0) more.push({ kind: 'separator' });
            more.push(
              {
                id: 'setupBothButton',
                label: t`Set up both sides`,
                icon: StackIcon,
                onSelect: () => live.submitBothLifecycle('setup'),
              },
              {
                id: 'resetBothButton',
                label: t`Reset both sides`,
                icon: ArrowsClockwiseIcon,
                onSelect: () => live.submitBothLifecycle('reset'),
              }
            );
          }
          return { actions, ...(more.length > 0 ? { more } : {}) };
        };

        const menu: AppMenuModel = {
          heading: tutorial ? t`Tutorial` : roomName,
          // The tutorial is for a Solo table: a room's other player would be
          // left waiting.
          ...(tutorial
            ? { onExitTutorial: tutorial.onExit }
            : solo && !replaying
              ? { onTutorial: () => startTutorial() }
              : {}),
          ...(openPlayOnline ? { onPlayOnline: openPlayOnline } : {}),
          // The toolbar's Deck is the acting seat's: P2's at a Solo table
          // turned around.
          ...(chrome.visibility.deckImport
            ? { onDeck: () => openDeck(actingTarget) }
            : {}),
          onSettings: () => setSheet('settings'),
          onFullscreen: () => {
            if (!requestFullscreen()) toast(fullscreenRefusedNotice());
          },
          ...(canCopy
            ? { onCopyInvitation: () => void copyInvitation('player') }
            : {}),
          ...(live.leaveRoom && !replaying ? { onLeave: live.leaveRoom } : {}),
          // The practice table keeps no saves or replays of its own.
          game: tutorial
            ? {}
            : replaying
              ? {
                  onExitReplay: exitReplay,
                  onExportState: () => {
                    const artifact = runtime.replay.getReplayArtifact();
                    if (artifact) downloadPerspectiveReplay(artifact);
                  },
                }
              : {
                  ...(live.canImportReplay
                    ? { onImportReplay: live.importReplay }
                    : {}),
                  ...(live.canSaveOnline
                    ? { onSaveOnline: live.saveOnlineGame }
                    : {}),
                  ...(live.canResumeSaved
                    ? { onResumeSaved: live.resumeSavedGame }
                    : {}),
                  ...(live.exportState
                    ? { onExportState: live.exportState }
                    : {}),
                  busy:
                    live.replayImportPending ||
                    live.continuationPending !== undefined,
                },
        };

        const rail: BoardRailModel = {
          bar: (
            <AppBar
              model={menu}
              log={
                <ActivityLauncher
                  presentation={runtime.presentation}
                  {...(state.view ? { perspective: state.view } : {})}
                  open={activity.open}
                  onToggle={() => activity.setOpen(!activity.open)}
                  ownSeat={live.ownSeat}
                  solo={solo}
                />
              }
            />
          ),
          ...(live.seatColor === 'opp-color' && !replaying
            ? { seat: 'opponent' as const }
            : {}),
          compose,
        };

        // An empty deck pile offers to load one: either seat at a Solo
        // table, a player's own seat in a room.
        const loadDeck =
          !replaying && chrome.visibility.deckImport && live.ownSeat
            ? {
                playerIds: (state.view?.playerOrder ?? []).filter(
                  (playerId) => solo || playerId === live.ownSeat
                ),
                onLoad: (playerId: string) =>
                  openDeck(playerId === live.ownSeat ? 'main' : 'alternate'),
              }
            : undefined;

        // The welcome is for a table nobody has started on: turning it round
        // to an empty seat does not bring it back.
        const tableEmpty = (state.view?.playerOrder ?? []).every(
          (playerId) => seatStage(state.view, playerId) === 'empty'
        );
        const welcome =
          soloLive &&
          !tutorial &&
          state.sessionPhase === 'ready' &&
          tableEmpty &&
          !shellPreferences.welcomeDismissed &&
          sheet === undefined;

        return (
          <TableShell
            route="remote-room"
            darkMode={effectivePreferences.darkMode}
            {...(backgroundSelection.background
              ? { background: backgroundSelection.background }
              : {})}
            sessionPhase={state.sessionPhase}
            docked={activity.docked && activity.open}
            dockSlide={activity.slide}
            board={
              <RemoteSessionBoard
                session={runtime.session}
                replay={runtime.replay}
                rendererKind={rendererKind}
                onIntent={onIntent}
                {...(onSubmission ? { onSubmission } : {})}
                preferences={effectivePreferences}
                roomMode={roomMode}
                hideOpponentHand={hideOpponentHand}
                onPerspectiveChange={setPerspective}
                coinFlip={runtime.presentation.coinFlip}
                rail={rail}
                commandsRef={boardCommands}
                sidePanel={activity.docked && activity.open}
                sidePanelSlide={activity.slide}
                keysSuspended={deckOpen}
                {...(loadDeck ? { loadDeck } : {})}
                showBothHalves={Boolean(tutorial)}
                {...(onTableSettledChange
                  ? { onSettledChange: onTableSettledChange }
                  : {})}
              />
            }
          >
            {state.failure ? (
              <>
                <TableBanner
                  action={
                    <>
                      {sessionFailure?.retryable ? (
                        <button
                          id="roomReconnectButton"
                          type="button"
                          className="ds-button ds-button--secondary"
                          onClick={() => runtime.session.retry()}
                        >
                          <Trans>Reconnect</Trans>
                        </button>
                      ) : null}
                      {solo && onNewSoloTable ? (
                        <button
                          id="roomNewTableButton"
                          type="button"
                          className="ds-button ds-button--secondary"
                          onClick={onNewSoloTable}
                        >
                          <Trans>New table</Trans>
                        </button>
                      ) : !solo && onLeave ? (
                        <button
                          id="roomLeaveButton"
                          type="button"
                          className="ds-button ds-button--secondary"
                          onClick={onLeave}
                        >
                          <Trans>Leave room</Trans>
                        </button>
                      ) : null}
                    </>
                  }
                >
                  <span title={state.failure.message}>
                    {i18n._(
                      sessionFailure
                        ? failureText(sessionFailure)
                        : replayFailureText(state.failure.code)
                    )}
                  </span>
                </TableBanner>
                <SettledByFailure onSettledChange={onTableSettledChange} />
              </>
            ) : null}
            {tutorial ? (
              <TutorialHost
                room={runtime}
                {...(tutorial.lesson !== undefined
                  ? { lesson: tutorial.lesson }
                  : {})}
                serial={tutorial.serial}
                flipped={perspective.flipped}
                flipBoard={() => boardCommands.current?.flipBoard()}
                onExit={tutorial.onExit}
              />
            ) : null}
            {welcome ? (
              <TableCentre
                {...(boardView.show === 'both'
                  ? { seam: 1 - boardView.split }
                  : {})}
              >
                <TableWelcome
                  {...(chrome.visibility.deckImport
                    ? { onLoadDeck: () => openDeck() }
                    : {})}
                  onTutorial={() => startTutorial()}
                  {...(openPlayOnline ? { onPlayOnline: openPlayOnline } : {})}
                  onDismiss={() =>
                    pagePreferences().patch(SHELL_PREFERENCES, {
                      welcomeDismissed: true,
                    })
                  }
                />
              </TableCentre>
            ) : null}
            <CommandSourceRegistration
              list={() => [
                ...roomCommands({
                  menu,
                  shortcutsHint: hint('table.shortcuts'),
                  log: {
                    open: activity.open,
                    setOpen: activity.setOpen,
                    download: replaying ? exportBattleLog : live.exportLog,
                    ...(replaying ? {} : { clear: live.clearLog }),
                  },
                  ...(!replaying && live.ready ? { say: live.say } : {}),
                  deckOpen,
                  closeDeck: closeSheet,
                }),
                // The tutorial's lessons, each by name (ADR-038).
                ...(tutorial || (solo && !replaying)
                  ? tutorialLessonCommands(
                      lessonsFor(inputMode).map((lesson) => ({
                        id: lesson.id,
                        title: i18n._(lesson.title),
                      })),
                      (lesson) => startTutorial(lesson)
                    )
                  : []),
              ]}
            />
            <ActivityPanel
              open={activity.open}
              onOpenChange={activity.setOpen}
              docked={activity.docked}
              slide={activity.slide}
              presentation={runtime.presentation}
              {...(state.view ? { perspective: state.view } : {})}
              feedId={feedId}
              status={roomName}
              {...(canCopy
                ? {
                    headerActions: (
                      <Tooltip content={t`Copy an invitation`} side="bottom">
                        <button
                          id="roomHeaderCopyButton"
                          type="button"
                          className="ds-icon-button"
                          aria-label={t`Copy an invitation`}
                          onClick={() => void copyInvitation('player')}
                        >
                          <CopyIcon aria-hidden="true" weight="bold" />
                        </button>
                      </Tooltip>
                    ),
                  }
                : {})}
              {...(replaying
                ? { onExportLog: exportBattleLog }
                : {
                    controls: live,
                    onExportLog: live.exportLog,
                    onClearLog: live.clearLog,
                  })}
            />
            <SettingsSheet
              open={sheet === 'settings'}
              onOpenChange={(open) => setSheet(open ? 'settings' : undefined)}
              solo={solo}
              darkMode={effectivePreferences.darkMode}
              onDarkModeChange={setDarkMode}
              onChangeBackground={backgroundSelection.chooseBackground}
              {...(onBackgroundReset && backgroundSelection.background
                ? { onUseDefaultBackground: onBackgroundReset }
                : {})}
            />
            {soloLive && multiplayerPanel ? (
              <OnlineSheet
                open={sheet === 'online'}
                onOpenChange={(open) => setSheet(open ? 'online' : undefined)}
              >
                {multiplayerPanel(false)}
              </OnlineSheet>
            ) : null}
            {deckActivated ? (
              <DeckLayer open={deckOpen} onClose={closeSheet}>
                <LazyDeckBuilderSession
                  session={runtime.session}
                  open={deckOpen}
                  {...(deckTarget ? { openTarget: deckTarget } : {})}
                  alternateEnabled={solo}
                  installOnSessionAttach={installDeckOnSessionAttach}
                  prepareForNewSessionOnAttach={!deckSessionPrepared}
                  onSessionAttach={onDeckSessionAttach}
                  onRequestClose={closeSheet}
                  {...(onDeckCustodyChange
                    ? { onCustodyChange: onDeckCustodyChange }
                    : {})}
                  {...(deckStore ? { store: deckStore } : {})}
                  {...(cardBackStore ? { cardBackStore } : {})}
                  {...(requestCardBack ? { requestCardBack } : {})}
                />
              </DeckLayer>
            ) : null}
            {live.fileInputs}
            {/* The deck screen opens ready: warmed up once the table has
                drawn, never while it is still arriving. */}
            <DeckScreenWarmup ready={state.sessionPhase === 'ready'} />
            <PresentationAnnouncer runtime={runtime.presentation} />
          </TableShell>
        );
      }}
    </ReplayModeShell>
  );
};
