import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { MAX_CHAT_CODE_UNITS } from '@ptcgsim/protocol';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

import { resolveLifecycleAction } from '../board/resolveLifecycleAction.js';
import { resolveSoloUndoAction } from '../board/resolveSoloUndoAction.js';
import { resolveTableAction } from '../board/resolveTableAction.js';
import type { LegacyGamePresentationRuntime } from '../presentation/LegacyGamePresentationRuntime.js';
import {
  downloadBrowserTextFile,
  requestBrowserFullscreen,
  serializeBattleLog,
} from './browser-room-options.js';
import {
  readBrowserReplayFileBytes,
  type BrowserReplayFileLike,
  type BrowserReplayFileReadResult,
} from './browser-replay-file.js';
import { useDismissibleRoomOptions } from './useDismissibleRoomOptions.js';
import { useGameSession } from './useGameSession.js';

export type RemoteRoomLiveSession = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'sendChat' | 'submit'
>;

export type RemoteRoomLivePresentation = Pick<
  LegacyGamePresentationRuntime,
  'activityFeed' | 'clearActivity'
>;

const ownPlayerId = (state: ClientSessionState): string | undefined =>
  state.phase === 'ready' &&
  state.role === 'player' &&
  state.view?.viewer.kind === 'player'
    ? state.view.viewer.playerId
    : undefined;

const reportInvalidReplayFile = (): void =>
  globalThis.alert('Error reading file. Please make sure the file is valid.');

export type BrowserReplayFileReader = (
  file: BrowserReplayFileLike,
  options?: { readonly signal?: AbortSignal }
) => Promise<BrowserReplayFileReadResult>;

/** Existing connected-room controls backed only by authenticated session APIs. */
export const RemoteRoomLiveControls = ({
  session,
  presentation,
  roomMode = 'multiplayer',
  onLeave,
  onExportState,
  onImportReplayFile,
  confirmLeave = () =>
    globalThis.confirm(
      'Are you sure you want to leave the room? Current game state will be lost.'
    ),
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
  readReplayFile = readBrowserReplayFileBytes,
  reportReplayImportFailure = reportInvalidReplayFile,
}: {
  readonly session: RemoteRoomLiveSession;
  readonly presentation: RemoteRoomLivePresentation;
  readonly roomMode?: 'solo' | 'multiplayer';
  readonly onLeave?: () => void;
  readonly onExportState?: () => void;
  readonly onImportReplayFile?: (contents: Uint8Array) => Promise<boolean>;
  readonly confirmLeave?: () => boolean;
  readonly downloadTextFile?: (filename: string, contents: string) => boolean;
  readonly requestFullscreen?: () => boolean;
  readonly readReplayFile?: BrowserReplayFileReader;
  readonly reportReplayImportFailure?: () => void;
}) => {
  const state = useGameSession(session);
  const [message, setMessage] = useState('');
  const [pendingBoth, setPendingBoth] = useState<{
    readonly commandId: string;
    readonly action: 'setup' | 'reset';
    readonly targetPlayerId: string;
  }>();
  const [replayImportPending, setReplayImportPending] = useState(false);
  const replayFileInputRef = useRef<HTMLInputElement>(null);
  const replayImportAbortRef = useRef<AbortController | undefined>(undefined);
  const options = useDismissibleRoomOptions();
  const playerId = ownPlayerId(state);
  const playerControls = playerId !== undefined;
  const solo = roomMode === 'solo';
  const ready = state.phase === 'ready';

  const submitTable = (action: 'attack' | 'pass'): void => {
    if (!playerId || !state.view) return;
    const resolution = resolveTableAction(state.view, playerId, action);
    if (resolution.ok) session.submit(resolution.command);
  };
  const submitLifecycle = (action: 'setup' | 'reset'): void => {
    if (!playerId || !state.view) return;
    const resolution = resolveLifecycleAction(state.view, playerId, action);
    if (resolution.ok) session.submit(resolution.command);
  };
  const submitBothLifecycle = (action: 'setup' | 'reset'): void => {
    if (!playerId || !state.view || !solo || pendingBoth) return;
    const targets = [
      playerId,
      ...state.view.playerOrder.filter((candidate) => candidate !== playerId),
    ];
    const firstPlayerId = targets[0];
    const secondPlayerId = targets[1];
    if (!firstPlayerId) return;
    const resolution = resolveLifecycleAction(
      state.view,
      firstPlayerId,
      action
    );
    if (!resolution.ok) return;
    const submission = session.submit(resolution.command);
    if (submission.queued && secondPlayerId) {
      setPendingBoth({
        commandId: submission.commandId,
        action,
        targetPlayerId: secondPlayerId,
      });
    }
  };
  const submitSoloUndo = (): void => {
    if (!playerId || !state.view || !solo) return;
    const resolution = resolveSoloUndoAction(state.view, playerId);
    if (resolution.ok) session.submit(resolution.command);
  };
  useEffect(() => {
    if (!pendingBoth) return;
    if (state.phase !== 'ready') {
      setPendingBoth(undefined);
      return;
    }
    const completed = state.completedCommands.find(
      (candidate) => candidate.commandId === pendingBoth.commandId
    );
    if (!completed) return;
    setPendingBoth(undefined);
    if (!completed.accepted || !state.view) return;
    const resolution = resolveLifecycleAction(
      state.view,
      pendingBoth.targetPlayerId,
      pendingBoth.action
    );
    if (resolution.ok) session.submit(resolution.command);
  }, [pendingBoth, session, state]);
  useEffect(
    () => () => {
      replayImportAbortRef.current?.abort();
    },
    []
  );
  const importReplayFile = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (
      !file ||
      !onImportReplayFile ||
      !ready ||
      state.replayLoading ||
      replayImportPending
    ) {
      return;
    }

    replayImportAbortRef.current?.abort();
    const controller = new AbortController();
    replayImportAbortRef.current = controller;
    setReplayImportPending(true);
    let read: BrowserReplayFileReadResult;
    try {
      read = await readReplayFile(file, { signal: controller.signal });
    } catch {
      read = { ok: false, reason: 'read_failed' };
    }
    if (
      controller.signal.aborted ||
      replayImportAbortRef.current !== controller
    ) {
      return;
    }

    let imported = false;
    if (read.ok) {
      try {
        imported = await onImportReplayFile(read.bytes);
      } catch {
        imported = false;
      }
    }
    if (
      controller.signal.aborted ||
      replayImportAbortRef.current !== controller
    ) {
      return;
    }
    replayImportAbortRef.current = undefined;
    setReplayImportPending(false);
    options.setOpen(false);
    if (!read.ok || !imported) reportReplayImportFailure();
  };
  const sendMessage = (): void => {
    const normalized = message.trim();
    if (normalized.length === 0 || normalized.length > MAX_CHAT_CODE_UNITS) {
      return;
    }
    if (session.sendChat(normalized)) setMessage('');
  };
  const handleMessageKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendMessage();
  };

  return (
    <>
      <div
        id={solo ? 'chatboxButtonContainer' : 'p2ChatboxButtonContainer'}
        className="chat-button-container"
      >
        {playerControls && (
          <>
            <button
              id={solo ? 'attackButton' : 'p2AttackButton'}
              type="button"
              className="self-color"
              onClick={() => submitTable('attack')}
            >
              Attack
            </button>
            <button
              id={solo ? 'passButton' : 'p2PassButton'}
              type="button"
              className="self-color"
              onClick={() => submitTable('pass')}
            >
              Pass
            </button>
            {solo && (
              <button
                id="undoButton"
                type="button"
                className="self-color"
                onClick={submitSoloUndo}
              >
                Undo
              </button>
            )}
          </>
        )}
        <button
          id={solo ? 'FREEBUTTON' : 'p2FREEBUTTON'}
          type="button"
          className={playerControls ? 'self-color' : 'spectator-color'}
          disabled={!ready}
          aria-label="Send flower"
          onClick={() => session.sendChat('🌺')}
        >
          🌺
        </button>
      </div>
      <input
        id={solo ? 'messageInput' : 'p2MessageInput'}
        type="text"
        placeholder="Type your message here..."
        aria-label="Chat message"
        maxLength={MAX_CHAT_CODE_UNITS}
        disabled={!ready}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleMessageKeyDown}
      />
      <div
        id={solo ? 'bottomP1ButtonContainer' : 'p2BottomButtonContainer'}
        className="sidebox-button-container"
      >
        {playerControls && (
          <>
            <button
              id={solo ? 'setupButton' : 'p2SetupButton'}
              type="button"
              className="self-color"
              onClick={() => submitLifecycle('setup')}
            >
              Set Up
            </button>
            <button
              id={solo ? 'resetButton' : 'p2ResetButton'}
              type="button"
              className="self-color"
              onClick={() => submitLifecycle('reset')}
            >
              Reset
            </button>
            {solo && (
              <>
                <button
                  id="setupBothButton"
                  type="button"
                  className="neutral-color"
                  disabled={pendingBoth !== undefined}
                  onClick={() => submitBothLifecycle('setup')}
                >
                  Set Up Both
                </button>
                <button
                  id="resetBothButton"
                  type="button"
                  className="neutral-color"
                  disabled={pendingBoth !== undefined}
                  onClick={() => submitBothLifecycle('reset')}
                >
                  Reset Both
                </button>
              </>
            )}
          </>
        )}
        {onLeave && !solo && (
          <button
            id="leaveRoomButton"
            type="button"
            className="neutral-color"
            onClick={() => {
              if (confirmLeave()) onLeave();
            }}
          >
            Leave Room
          </button>
        )}
        <button
          id={solo ? 'optionsButton' : 'p2OptionsButton'}
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
      <div
        id="optionsContextMenu"
        ref={options.menuRef}
        role="menu"
        hidden={!options.open}
      >
        {onExportState && (
          <button
            id="exportState"
            type="button"
            role="menuitem"
            disabled={!ready}
            onClick={() => {
              options.setOpen(false);
              onExportState();
            }}
          >
            Export game state
          </button>
        )}
        {solo && onImportReplayFile && (
          <div id="jsonReplayDiv" role="none">
            <button
              id="importReplay"
              type="button"
              role="menuitem"
              disabled={!ready || state.replayLoading || replayImportPending}
              onClick={() => replayFileInputRef.current?.click()}
            >
              Enter replay mode
            </button>
            <input
              id="jsonReplay"
              ref={replayFileInputRef}
              type="file"
              accept=".json"
              hidden
              onChange={(event) => void importReplayFile(event)}
            />
          </div>
        )}
        <button
          id="exportLog"
          type="button"
          role="menuitem"
          onClick={() => {
            downloadTextFile(
              'battle-log.txt',
              serializeBattleLog(presentation.activityFeed.getSnapshot().items)
            );
            options.setOpen(false);
          }}
        >
          Export battle log
        </button>
        <button
          id="clearLog"
          type="button"
          role="menuitem"
          onClick={() => {
            presentation.clearActivity();
            options.setOpen(false);
          }}
        >
          Clear battle log
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
      </div>
    </>
  );
};
