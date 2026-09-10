import {
  DEFAULT_BOARD_PREFERENCES,
  type BoardIntent,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { useState } from 'react';

import type { RendererKind } from '../RendererSpikeBoard.js';
import { LegacyPresentationSurface } from '../presentation/LegacyPresentationSurface.js';
import { ReplayModeShell } from '../replay/ReplayModeShell.js';
import {
  RemoteSessionBoard,
  type RemoteBoardSubmissionResult,
} from './RemoteSessionBoard.js';
import { RemoteRoomLiveControls } from './RemoteRoomLiveControls.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import { RemoteRoomSettings } from './RemoteRoomSettings.js';
import {
  downloadBrowserTextFile,
  requestBrowserFullscreen,
  serializeBattleLog,
} from './browser-room-options.js';
import { useDismissibleRoomOptions } from './useDismissibleRoomOptions.js';

const ignoreIntent = (_intent: BoardIntent): void => undefined;
const confirmConnectedRoomExit = (): boolean =>
  globalThis.confirm(
    'Are you sure you want to leave the room? Battle log will be erased.'
  );

export interface RemoteRoomRouteProps {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly onIntent?: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly onLeave?: () => void;
  /** When supplied with onPreferencesChange, ownership remains above the route. */
  readonly preferences?: BoardPreferences;
  readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
  /** Source-shaped local checkbox state; multiplayer projections stay unchanged. */
  readonly hideOpponentHand?: boolean;
  readonly onHideOpponentHandChange?: (hidden: boolean) => void;
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
  onIntent = ignoreIntent,
  onSubmission,
  onLeave,
  preferences: ownedPreferences,
  onPreferencesChange,
  hideOpponentHand: ownedHideOpponentHand,
  onHideOpponentHandChange,
  confirmHeaderLeave = confirmConnectedRoomExit,
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
}: RemoteRoomRouteProps) => {
  const options = useDismissibleRoomOptions();
  const [activePanel, setActivePanel] = useState<'room' | 'settings'>('room');
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

  return (
    <ReplayModeShell coordinator={runtime.replay}>
      {({ state, chrome, controls, exitReplay }) => {
        const feedId = chrome.active ? 'chatbox' : 'p2Chatbox';
        const status =
          state.failure?.message ??
          (state.sessionPhase === 'ready'
            ? `Room ${runtime.roomCode}`
            : state.sessionPhase);
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
            data-dark-mode={String(effectivePreferences.darkMode)}
          >
            <section className="board-column" aria-label="Game board">
              <RemoteSessionBoard
                session={runtime.session}
                replay={runtime.replay}
                rendererKind={rendererKind}
                onIntent={onIntent}
                {...(onSubmission ? { onSubmission } : {})}
                {...(preferences ? { preferences } : {})}
              />
            </section>
            <aside className="legacy-sidebar legacy-room-sidebar">
              <nav
                id="topButtonContainer"
                className="legacy-tabs legacy-room-tabs"
                aria-label="Application sections"
              >
                <button
                  id="p1Button"
                  type="button"
                  className={
                    chrome.active && activePanel === 'room'
                      ? 'selected-page'
                      : 'not-selected-page'
                  }
                  style={{ width: chrome.primaryTabWidth }}
                  aria-current={
                    chrome.active && activePanel === 'room' ? 'page' : undefined
                  }
                  onClick={() => {
                    if (chrome.active) {
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
                      activePanel === 'room'
                        ? 'selected-page'
                        : 'not-selected-page'
                    }
                    aria-current={activePanel === 'room' ? 'page' : undefined}
                    onClick={() => setActivePanel('room')}
                  >
                    Multiplayer
                  </button>
                )}
                {chrome.visibility.deckImport && (
                  <button
                    id="deckImportButton"
                    type="button"
                    className="not-selected-page"
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
                id={chrome.active ? 'p1Box' : 'p2Box'}
                className={`legacy-room-sidebox${
                  chrome.active ? '' : ' legacy-room-sidebox--live'
                }`}
                data-replay-active={String(chrome.active)}
                hidden={activePanel !== 'room'}
              >
                {!chrome.active && (
                  <div id="roomHeader">
                    <div
                      id="roomHeaderText"
                      data-session-phase={state.sessionPhase}
                    >
                      {status}
                    </div>
                  </div>
                )}
                <LegacyPresentationSurface
                  key={feedId}
                  runtime={runtime.presentation}
                  perspective={state.view}
                  feedId={feedId}
                />
                {!chrome.active && (
                  <RemoteRoomLiveControls
                    session={runtime.session}
                    presentation={runtime.presentation}
                    {...(onLeave ? { onLeave } : {})}
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
              />
            </aside>
          </main>
        );
      }}
    </ReplayModeShell>
  );
};
