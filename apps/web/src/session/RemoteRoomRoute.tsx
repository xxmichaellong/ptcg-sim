import {
  serializeProjectedReplayFile,
  type ProjectedReplayArtifact,
} from '@ptcgsim/client-session';
import {
  DEFAULT_BOARD_PREFERENCES,
  type BoardIntent,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import type { RendererKind } from '../RendererSpikeBoard.js';
import type { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import type { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
import type { LegacyDeckBuilderCustody } from '../features/deck/LegacyDeckBuilderSession.js';
import { LegacyPresentationSurface } from '../presentation/LegacyPresentationSurface.js';
import { LegacyWelcome } from './LegacyWelcome.js';
import { ReplayModeShell } from '../replay/ReplayModeShell.js';
import {
  RemoteSessionBoard,
  type RemoteBoardSubmissionResult,
} from './RemoteSessionBoard.js';
import {
  RemoteRoomLiveControls,
  type OpponentInvitationDelivery,
} from './RemoteRoomLiveControls.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import { RemoteRoomSettings } from './RemoteRoomSettings.js';
import {
  roomBackgroundCssImage,
  type BrowserRoomBackgroundRequest,
  type RoomBackground,
} from './browser-room-background.js';
import type { BrowserCardBackRequest } from './browser-card-back.js';
import {
  downloadBrowserTextFile,
  requestBrowserFullscreen,
  serializeBattleLog,
} from './browser-room-options.js';
import { useDismissibleRoomOptions } from './useDismissibleRoomOptions.js';
import { useRoomBackground } from './useRoomBackground.js';

const LegacyDeckBuilderSession = lazy(async () => ({
  default: (await import('../features/deck/LegacyDeckBuilderSession.js'))
    .LegacyDeckBuilderSession,
}));

const ignoreIntent = (_intent: BoardIntent): void => undefined;
const confirmConnectedRoomExit = (): boolean =>
  globalThis.confirm(
    'Are you sure you want to leave the room? Battle log will be erased.'
  );

export interface RemoteRoomRouteProps {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly roomMode?: 'solo' | 'multiplayer';
  /** Retained above the route when lobby/room transitions share Deck custody. */
  readonly deckStore?: DeckBuilderStore;
  readonly cardBackStore?: CardBackCustodyStore;
  readonly requestCardBack?: BrowserCardBackRequest;
  readonly deckSurfaceActivated?: boolean;
  readonly onDeckSurfaceActivate?: () => void;
  readonly onDeckCustodyChange?: (custody: LegacyDeckBuilderCustody) => void;
  readonly deckSessionPrepared?: boolean;
  readonly onDeckSessionAttach?: () => void;
  readonly onIntent?: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly onLeave?: () => void;
  /** Atomic owner-level replacement after a server-held save is restored. */
  readonly onResumeSavedGame?: (
    contents: string,
    deliverOpponentInvitation: OpponentInvitationDelivery,
    signal: AbortSignal
  ) => Promise<void>;
  /** Parks a live solo authority while the source Multiplayer tab is open. */
  readonly onMultiplayerNavigate?: () => void;
  /**
   * Mints and copies a fresh invitation from inside the room, for the seat
   * that holds creator custody. v1's room header has a copy button; here it
   * copies an invitation rather than the bare room code, which cannot admit.
   */
  readonly onCopyInvitation?: (
    role: 'player' | 'spectator'
  ) => Promise<boolean>;
  /** When supplied with onPreferencesChange, ownership remains above the route. */
  readonly preferences?: BoardPreferences;
  readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
  /** Source-shaped local checkbox state; multiplayer projections stay unchanged. */
  readonly hideOpponentHand?: boolean;
  readonly onHideOpponentHandChange?: (hidden: boolean) => void;
  /** Page-local visual only; no room, replay, renderer, or storage ownership. */
  readonly background?: RoomBackground;
  readonly onBackgroundChange?: (background: RoomBackground) => void;
  readonly requestBackground?: BrowserRoomBackgroundRequest;
  readonly confirmHeaderLeave?: () => boolean;
  readonly downloadTextFile?: (filename: string, contents: string) => boolean;
  readonly requestFullscreen?: () => boolean;
}

/**
 * First real room screen: effective live/replay board, exact replay tab chrome,
 * recipient-safe activity, and route-owned transport/controller composition.
 */
export const RemoteRoomRoute = ({
  runtime,
  rendererKind,
  roomMode = 'multiplayer',
  deckStore,
  cardBackStore,
  requestCardBack,
  deckSurfaceActivated = false,
  onDeckSurfaceActivate,
  onDeckCustodyChange,
  deckSessionPrepared = false,
  onDeckSessionAttach,
  onIntent = ignoreIntent,
  onSubmission,
  onLeave,
  onResumeSavedGame,
  onMultiplayerNavigate,
  onCopyInvitation,
  preferences: ownedPreferences,
  onPreferencesChange,
  hideOpponentHand: ownedHideOpponentHand,
  onHideOpponentHandChange,
  background: ownedBackground,
  onBackgroundChange,
  requestBackground,
  confirmHeaderLeave = confirmConnectedRoomExit,
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
}: RemoteRoomRouteProps) => {
  const options = useDismissibleRoomOptions();
  const backgroundSelection = useRoomBackground({
    ...(ownedBackground ? { background: ownedBackground } : {}),
    ...(onBackgroundChange ? { onBackgroundChange } : {}),
    ...(requestBackground ? { requestBackground } : {}),
  });
  const [activePanel, setActivePanel] = useState<'room' | 'deck' | 'settings'>(
    'room'
  );
  const [playmatExpanded, setPlaymatExpanded] = useState(false);
  const [perspective, setPerspective] = useState<{
    readonly flipped: boolean;
    readonly actingPlayerId: string | undefined;
  }>({ flipped: false, actingPlayerId: undefined });
  const [locallyActivatedDeck, setLocallyActivatedDeck] = useState(false);
  const deckActivated = deckSurfaceActivated || locallyActivatedDeck;
  const openDeck = (): void => {
    setLocallyActivatedDeck(true);
    onDeckSurfaceActivate?.();
    setActivePanel('deck');
  };
  const [localPreferences, setLocalPreferences] = useState<
    BoardPreferences | undefined
  >(ownedPreferences);
  const [localHideOpponentHand, setLocalHideOpponentHand] = useState(
    ownedHideOpponentHand ?? false
  );
  const preferences = onPreferencesChange ? ownedPreferences : localPreferences;
  const hideOpponentHand = onHideOpponentHandChange
    ? (ownedHideOpponentHand ?? false)
    : localHideOpponentHand;
  const effectivePreferences = preferences ?? DEFAULT_BOARD_PREFERENCES;
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
  const setZoneOutlines = (visible: boolean): void => {
    publishPreferences({
      ...effectivePreferences,
      showZoneOutlines: visible,
    });
  };
  const setHideOpponentHand = (hidden: boolean): void => {
    if (onHideOpponentHandChange) onHideOpponentHandChange(hidden);
    else setLocalHideOpponentHand(hidden);
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
  const [copyNotice, setCopyNotice] = useState<string>();
  const copyNoticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      if (copyNoticeTimer.current !== undefined) {
        clearTimeout(copyNoticeTimer.current);
      }
    },
    []
  );
  const copyInvitation = async (
    role: 'player' | 'spectator'
  ): Promise<void> => {
    if (!onCopyInvitation) return;
    const copied = await onCopyInvitation(role).catch(() => false);
    setCopyNotice(
      copied ? 'Invitation copied' : 'Could not copy an invitation'
    );
    if (copyNoticeTimer.current !== undefined) {
      clearTimeout(copyNoticeTimer.current);
    }
    copyNoticeTimer.current = setTimeout(() => setCopyNotice(undefined), 2500);
  };
  const exportLivePerspective = (): void => {
    void runtime.replay.requestReplayArtifact().then((result) => {
      if (result.ok) downloadPerspectiveReplay(result.artifact);
    });
  };

  return (
    <ReplayModeShell coordinator={runtime.replay}>
      {({ state, chrome, controls, exitReplay }) => {
        const soloLive = !chrome.active && roomMode === 'solo';
        const feedId = chrome.active || soloLive ? 'chatbox' : 'p2Chatbox';
        // The header names the room once it is live ("id: CODE", as v1's
        // joinGame handler writes it), or reports a failure. Connection phases
        // in between are not narrated -- v1 shows nothing while it connects,
        // and the tabs already tell where you are.
        const status =
          state.failure?.message ??
          (state.sessionPhase === 'ready'
            ? `id: ${runtime.roomCode}`
            : undefined);
        const leaveReplay = (): void => {
          options.setOpen(false);
          exitReplay();
        };

        return (
          <main
            className={`app-shell remote-room-route${
              effectivePreferences.darkMode ? ' remote-room-route--dark' : ''
            }`}
            data-app-route="remote-room"
            data-session-phase={soloLive ? state.sessionPhase : undefined}
            data-dark-mode={String(effectivePreferences.darkMode)}
            data-room-background={
              backgroundSelection.background?.kind ?? 'default'
            }
            style={
              backgroundSelection.background
                ? {
                    backgroundImage: roomBackgroundCssImage(
                      backgroundSelection.background
                    ),
                    backgroundSize: '100% 100%',
                    backgroundRepeat: 'no-repeat',
                  }
                : undefined
            }
          >
            <section
              className={`board-column${
                playmatExpanded ? ' board-column--fullscreen' : ''
              }`}
              aria-label="Game board"
              data-board-shell={playmatExpanded ? 'fullscreen' : 'sidebar'}
            >
              <RemoteSessionBoard
                session={runtime.session}
                replay={runtime.replay}
                rendererKind={rendererKind}
                onIntent={onIntent}
                {...(onSubmission ? { onSubmission } : {})}
                {...(preferences ? { preferences } : {})}
                roomMode={roomMode}
                hideOpponentHand={hideOpponentHand}
                playmatExpanded={playmatExpanded}
                onPlaymatExpandedChange={setPlaymatExpanded}
                onPerspectiveChange={setPerspective}
              />
            </section>
            <aside
              className="legacy-sidebar legacy-room-sidebar"
              hidden={playmatExpanded}
            >
              <nav
                id="topButtonContainer"
                className="legacy-tabs legacy-room-tabs"
                aria-label="Application sections"
              >
                <button
                  id="p1Button"
                  type="button"
                  className={
                    (chrome.active || soloLive) && activePanel === 'room'
                      ? 'selected-page'
                      : 'not-selected-page'
                  }
                  style={{ width: chrome.primaryTabWidth }}
                  aria-current={
                    (chrome.active || soloLive) && activePanel === 'room'
                      ? 'page'
                      : undefined
                  }
                  onClick={() => {
                    if (chrome.active) {
                      setActivePanel('room');
                    } else if (soloLive) {
                      setActivePanel('room');
                    } else if (onLeave && confirmHeaderLeave()) {
                      onLeave();
                    }
                  }}
                >
                  {chrome.primaryTabLabel}
                </button>
                {chrome.visibility.multiplayerTab && (
                  <button
                    id="p2Button"
                    type="button"
                    className={
                      !soloLive && activePanel === 'room'
                        ? 'selected-page'
                        : 'not-selected-page'
                    }
                    aria-current={
                      !soloLive && activePanel === 'room' ? 'page' : undefined
                    }
                    onClick={() => {
                      if (soloLive) onMultiplayerNavigate?.();
                      else setActivePanel('room');
                    }}
                  >
                    Multiplayer
                  </button>
                )}
                {chrome.visibility.deckImport && (
                  <button
                    id="deckImportButton"
                    type="button"
                    className={
                      activePanel === 'deck'
                        ? 'selected-page'
                        : 'not-selected-page'
                    }
                    aria-current={activePanel === 'deck' ? 'page' : undefined}
                    onClick={openDeck}
                  >
                    Deck
                  </button>
                )}
                <button
                  id="settingsButton"
                  type="button"
                  className={
                    activePanel === 'settings'
                      ? 'selected-page'
                      : 'not-selected-page'
                  }
                  style={{ width: chrome.settingsTabWidth }}
                  aria-current={activePanel === 'settings' ? 'page' : undefined}
                  onClick={() => setActivePanel('settings')}
                >
                  Settings
                </button>
              </nav>
              <section
                id={chrome.active || soloLive ? 'p1Box' : 'p2Box'}
                className={`legacy-room-sidebox${
                  chrome.active || soloLive ? '' : ' legacy-room-sidebox--live'
                }`}
                data-replay-active={String(chrome.active)}
                hidden={activePanel !== 'room'}
              >
                {!chrome.active &&
                  (!soloLive || state.failure !== undefined) &&
                  (status !== undefined || copyNotice !== undefined) && (
                    <div id="roomHeader">
                      <div
                        id="roomHeaderText"
                        data-session-phase={state.sessionPhase}
                      >
                        {copyNotice ?? status}
                      </div>
                      {onCopyInvitation && state.sessionPhase === 'ready' && (
                        <button
                          id="roomHeaderCopyButton"
                          type="button"
                          title="Copy an invitation"
                          aria-label="Copy an invitation"
                          onClick={() => void copyInvitation('player')}
                        >
                          ⧉
                        </button>
                      )}
                    </div>
                  )}
                <LegacyPresentationSurface
                  key={feedId}
                  runtime={runtime.presentation}
                  perspective={state.view}
                  feedId={feedId}
                  {...(soloLive ? { intro: <LegacyWelcome /> } : {})}
                />
                {!chrome.active && (
                  <RemoteRoomLiveControls
                    session={runtime.session}
                    presentation={runtime.presentation}
                    roomMode={roomMode}
                    boardFlipped={perspective.flipped}
                    {...(perspective.actingPlayerId
                      ? { actingPlayerId: perspective.actingPlayerId }
                      : {})}
                    {...(onLeave ? { onLeave } : {})}
                    onExportState={exportLivePerspective}
                    onImportReplayFile={(contents) =>
                      runtime.replay.importReplayFileBytes(contents)
                    }
                    onSaveOnlineGame={(signal) =>
                      runtime.saveOnlineGame(downloadTextFile, signal)
                    }
                    {...(onResumeSavedGame ? { onResumeSavedGame } : {})}
                    downloadTextFile={downloadTextFile}
                    requestFullscreen={requestFullscreen}
                  />
                )}
                {controls && (
                  <div
                    id="bottomP1ButtonContainer"
                    className="sidebox-button-container"
                  >
                    {controls}
                    <button
                      id="optionsButton"
                      ref={options.buttonRef}
                      type="button"
                      className="neutral-color"
                      aria-expanded={options.open}
                      aria-controls="optionsContextMenu"
                      onClick={() => options.setOpen((open) => !open)}
                    >
                      Options
                    </button>
                  </div>
                )}
                {chrome.visibility.exitReplay && (
                  <div
                    id="optionsContextMenu"
                    ref={options.menuRef}
                    role="menu"
                    hidden={!options.open}
                  >
                    <button
                      id="exportState"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const artifact = runtime.replay.getReplayArtifact();
                        options.setOpen(false);
                        if (artifact) downloadPerspectiveReplay(artifact);
                      }}
                    >
                      Export game state
                    </button>
                    <button
                      id="exportLog"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        downloadTextFile(
                          'battle-log.txt',
                          serializeBattleLog(
                            runtime.presentation.activityFeed.getSnapshot()
                              .items
                          )
                        );
                        options.setOpen(false);
                      }}
                    >
                      Export battle log
                    </button>
                    <button
                      id="fullscreenButton"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        requestFullscreen();
                        options.setOpen(false);
                      }}
                    >
                      Full screen
                    </button>
                    <button id="exitReplay" type="button" onClick={leaveReplay}>
                      Exit replay mode
                    </button>
                  </div>
                )}
              </section>
              <RemoteRoomSettings
                hidden={activePanel !== 'settings'}
                preferences={effectivePreferences}
                hideOpponentHand={hideOpponentHand}
                onDarkModeChange={setDarkMode}
                onZoneOutlinesChange={setZoneOutlines}
                onHideOpponentHandChange={setHideOpponentHand}
                onChangeBackground={backgroundSelection.chooseBackground}
              />
              {deckActivated && (
                <Suspense fallback={null}>
                  <LegacyDeckBuilderSession
                    session={runtime.session}
                    open={!chrome.active && activePanel === 'deck'}
                    alternateEnabled={roomMode === 'solo'}
                    installOnSessionAttach
                    prepareForNewSessionOnAttach={!deckSessionPrepared}
                    onSessionAttach={onDeckSessionAttach}
                    onRequestClose={() => setActivePanel('room')}
                    {...(onDeckCustodyChange
                      ? { onCustodyChange: onDeckCustodyChange }
                      : {})}
                    {...(deckStore ? { store: deckStore } : {})}
                    {...(cardBackStore ? { cardBackStore } : {})}
                    {...(requestCardBack ? { requestCardBack } : {})}
                  />
                </Suspense>
              )}
            </aside>
          </main>
        );
      }}
    </ReplayModeShell>
  );
};
