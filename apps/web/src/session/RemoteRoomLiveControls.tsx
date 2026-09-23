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
  readBrowserContinuationFileText,
  type BrowserContinuationFileLike,
  type BrowserContinuationFileReadResult,
} from './browser-continuation-file.js';
import {
  currentBrowserInvitationClipboard,
  type DeferredTextClipboardWriter,
} from './browser-invitation-clipboard.js';
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

const reportContinuationFailure = (action: 'save' | 'resume'): void =>
  globalThis.alert(
    action === 'save'
      ? 'Could not save this online game. Please try again.'
      : 'Could not resume this saved game. Please check the file and try again.'
  );

const reportContinuationResumeSuccess = (): void =>
  globalThis.alert(
    'Saved game resumed. A player invitation for the restored room was copied to your clipboard.'
  );

export type BrowserReplayFileReader = (
  file: BrowserReplayFileLike,
  options?: { readonly signal?: AbortSignal }
) => Promise<BrowserReplayFileReadResult>;

export type BrowserContinuationFileReader = (
  file: BrowserContinuationFileLike,
  options?: { readonly signal?: AbortSignal }
) => Promise<BrowserContinuationFileReadResult>;

export type OpponentInvitationDelivery = (text: string) => Promise<void>;

/** Existing connected-room controls backed only by authenticated session APIs. */
export const RemoteRoomLiveControls = ({
  session,
  presentation,
  roomMode = 'multiplayer',
  boardFlipped = false,
  actingPlayerId,
  onLeave,
  onExportState,
  onImportReplayFile,
  onSaveOnlineGame,
  onResumeSavedGame,
  confirmLeave = () =>
    globalThis.confirm(
      'Are you sure you want to leave the room? Current game state will be lost.'
    ),
  downloadTextFile = downloadBrowserTextFile,
  requestFullscreen = requestBrowserFullscreen,
  readReplayFile = readBrowserReplayFileBytes,
  readContinuationFile = readBrowserContinuationFileText,
  getInvitationClipboard = currentBrowserInvitationClipboard,
  reportReplayImportFailure = reportInvalidReplayFile,
  reportOnlineSaveFailure = () => reportContinuationFailure('save'),
  reportSavedGameResumeFailure = () => reportContinuationFailure('resume'),
  reportSavedGameResumeSuccess = reportContinuationResumeSuccess,
}: {
  readonly session: RemoteRoomLiveSession;
  readonly presentation: RemoteRoomLivePresentation;
  readonly roomMode?: 'solo' | 'multiplayer';
  /** v1 flipBoard swaps the seat colour of every sidebar action button. */
  readonly boardFlipped?: boolean;
  /**
   * The seat the sidebar acts for: v1's initiator, the seat at the bottom
   * of the board. Defaults to the viewer's own seat.
   */
  readonly actingPlayerId?: string;
  readonly onLeave?: () => void;
  readonly onExportState?: () => void;
  readonly onImportReplayFile?: (contents: Uint8Array) => Promise<boolean>;
  readonly onSaveOnlineGame?: (signal: AbortSignal) => Promise<void>;
  readonly onResumeSavedGame?: (
    contents: string,
    deliverOpponentInvitation: OpponentInvitationDelivery,
    signal: AbortSignal
  ) => Promise<void>;
  readonly confirmLeave?: () => boolean;
  readonly downloadTextFile?: (filename: string, contents: string) => boolean;
  readonly requestFullscreen?: () => boolean;
  readonly readReplayFile?: BrowserReplayFileReader;
  readonly readContinuationFile?: BrowserContinuationFileReader;
  readonly getInvitationClipboard?: () =>
    DeferredTextClipboardWriter | undefined;
  readonly reportReplayImportFailure?: () => void;
  readonly reportOnlineSaveFailure?: () => void;
  readonly reportSavedGameResumeFailure?: () => void;
  readonly reportSavedGameResumeSuccess?: () => void;
}) => {
  const state = useGameSession(session);
  const seatColor = boardFlipped ? 'opp-color' : 'self-color';
  const [message, setMessage] = useState('');
  const [pendingBoth, setPendingBoth] = useState<{
    readonly commandId: string;
    readonly action: 'setup' | 'reset';
    readonly targetPlayerId: string;
  }>();
  const [replayImportPending, setReplayImportPending] = useState(false);
  const [continuationPending, setContinuationPending] = useState<
    'save' | 'resume'
  >();
  const replayFileInputRef = useRef<HTMLInputElement>(null);
  const continuationFileInputRef = useRef<HTMLInputElement>(null);
  const replayImportAbortRef = useRef<AbortController | undefined>(undefined);
  const continuationAbortRef = useRef<AbortController | undefined>(undefined);
  const options = useDismissibleRoomOptions();
  const ownSeat = ownPlayerId(state);
  const playerId =
    ownSeat !== undefined &&
    actingPlayerId &&
    state.view?.players[actingPlayerId]
      ? actingPlayerId
      : ownSeat;
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
      const continuation = continuationAbortRef.current;
      continuationAbortRef.current = undefined;
      continuation?.abort();
    },
    []
  );
  const saveOnlineGame = async (): Promise<void> => {
    if (!onSaveOnlineGame || !ready || !playerControls || continuationPending) {
      return;
    }
    const controller = new AbortController();
    continuationAbortRef.current = controller;
    setContinuationPending('save');
    options.setOpen(false);
    try {
      await onSaveOnlineGame(controller.signal);
    } catch {
      if (!controller.signal.aborted) reportOnlineSaveFailure();
    } finally {
      if (continuationAbortRef.current === controller) {
        continuationAbortRef.current = undefined;
        setContinuationPending(undefined);
      }
    }
  };
  const resumeSavedGame = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (
      !file ||
      !onResumeSavedGame ||
      !ready ||
      !playerControls ||
      continuationPending
    ) {
      return;
    }

    const clipboard = getInvitationClipboard();
    if (!clipboard) {
      options.setOpen(false);
      reportSavedGameResumeFailure();
      return;
    }
    const controller = new AbortController();
    continuationAbortRef.current = controller;
    setContinuationPending('resume');
    options.setOpen(false);

    let resolveInvitation!: (text: string) => void;
    let rejectInvitation!: () => void;
    let invitationDelivered = false;
    const invitationText = new Promise<string>((resolve, reject) => {
      resolveInvitation = resolve;
      rejectInvitation = () => reject(new Error('Invitation unavailable'));
    });
    void invitationText.catch(() => undefined);
    let clipboardWrite: Promise<void>;
    try {
      clipboardWrite = clipboard.writeText(invitationText);
    } catch {
      rejectInvitation();
      continuationAbortRef.current = undefined;
      setContinuationPending(undefined);
      reportSavedGameResumeFailure();
      return;
    }
    void clipboardWrite.catch(() => undefined);
    const deliverOpponentInvitation: OpponentInvitationDelivery = async (
      text
    ) => {
      if (invitationDelivered) throw new Error('Invitation already delivered');
      invitationDelivered = true;
      resolveInvitation(text);
      await clipboardWrite;
    };

    try {
      let read: BrowserContinuationFileReadResult;
      try {
        read = await readContinuationFile(file, {
          signal: controller.signal,
        });
      } catch {
        read = { ok: false, reason: 'read_failed' };
      }
      if (
        controller.signal.aborted ||
        continuationAbortRef.current !== controller
      ) {
        if (!invitationDelivered) rejectInvitation();
        return;
      }
      if (!read.ok) throw new Error('Invalid continuation file');
      await onResumeSavedGame(
        read.text,
        deliverOpponentInvitation,
        controller.signal
      );
      if (
        controller.signal.aborted ||
        continuationAbortRef.current !== controller
      ) {
        return;
      }
      reportSavedGameResumeSuccess();
    } catch {
      if (!invitationDelivered) rejectInvitation();
      if (!controller.signal.aborted) reportSavedGameResumeFailure();
    } finally {
      if (continuationAbortRef.current === controller) {
        continuationAbortRef.current = undefined;
        setContinuationPending(undefined);
      }
    }
  };
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
    // v1 prefixes the line with `systemState.initiator`'s name, which a
    // flipped board moves to the other seat.
    if (session.sendChat(normalized, playerId)) setMessage('');
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
              className={seatColor}
              onClick={() => submitTable('attack')}
            >
              Attack
            </button>
            <button
              id={solo ? 'passButton' : 'p2PassButton'}
              type="button"
              className={seatColor}
              onClick={() => submitTable('pass')}
            >
              Pass
            </button>
            {solo && (
              <button
                id="undoButton"
                type="button"
                className={seatColor}
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
          className={playerControls ? seatColor : 'spectator-color'}
          disabled={!ready}
          aria-label="Send flower"
          onClick={() => session.sendChat('🌺', playerId)}
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
              className={seatColor}
              onClick={() => submitLifecycle('setup')}
            >
              Set Up
            </button>
            <button
              id={solo ? 'resetButton' : 'p2ResetButton'}
              type="button"
              className={seatColor}
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
        {/* v1 lists replay first, then the game-state items, then the log. */}
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
        {!solo && playerControls && onSaveOnlineGame && (
          <button
            id="saveOnlineGame"
            type="button"
            role="menuitem"
            disabled={!ready || continuationPending !== undefined}
            onClick={() => void saveOnlineGame()}
          >
            Save online game
          </button>
        )}
        {!solo && playerControls && onResumeSavedGame && (
          <div id="continuationSaveDiv" role="none">
            <button
              id="resumeSavedGame"
              type="button"
              role="menuitem"
              disabled={!ready || continuationPending !== undefined}
              onClick={() => continuationFileInputRef.current?.click()}
            >
              Resume saved game
            </button>
            <input
              id="continuationSaveFile"
              ref={continuationFileInputRef}
              type="file"
              accept=".ptcgsave"
              hidden
              onChange={(event) => void resumeSavedGame(event)}
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
