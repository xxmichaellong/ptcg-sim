import type { BoardIntent } from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';

import type { RendererKind } from '../RendererSpikeBoard.js';
import { LegacyPresentationSurface } from '../presentation/LegacyPresentationSurface.js';
import { ReplayModeShell } from '../replay/ReplayModeShell.js';
import {
  RemoteSessionBoard,
  type RemoteBoardSubmissionResult,
} from './RemoteSessionBoard.js';
import { RemoteRoomLiveControls } from './RemoteRoomLiveControls.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import {
  downloadBrowserTextFile,
  requestBrowserFullscreen,
  serializeBattleLog,
} from './browser-room-options.js';
import { useDismissibleRoomOptions } from './useDismissibleRoomOptions.js';

const ignoreIntent = (_intent: BoardIntent): void => undefined;

export interface RemoteRoomRouteProps {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly onIntent?: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly onLeave?: () => void;
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
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
}: RemoteRoomRouteProps) => {
  const options = useDismissibleRoomOptions();

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
          <main className="app-shell" data-app-route="remote-room">
            <section className="board-column" aria-label="Game board">
              <RemoteSessionBoard
                session={runtime.session}
                replay={runtime.replay}
                rendererKind={rendererKind}
                onIntent={onIntent}
                {...(onSubmission ? { onSubmission } : {})}
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
                    chrome.active ? 'selected-page' : 'not-selected-page'
                  }
                  style={{ width: chrome.primaryTabWidth }}
                  aria-current={chrome.active ? 'page' : undefined}
                >
                  {chrome.primaryTabLabel}
                </button>
                {chrome.visibility.multiplayerTab && (
                  <button
                    id="p2Button"
                    type="button"
                    className="selected-page"
                    aria-current="page"
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
                  className="not-selected-page"
                  style={{ width: chrome.settingsTabWidth }}
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
            </aside>
          </main>
        );
      }}
    </ReplayModeShell>
  );
};
