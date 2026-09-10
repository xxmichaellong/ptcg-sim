import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { MAX_CHAT_CODE_UNITS } from '@ptcgsim/protocol';
import { useState, type KeyboardEvent } from 'react';

import { resolveLifecycleAction } from '../board/resolveLifecycleAction.js';
import { resolveTableAction } from '../board/resolveTableAction.js';
import { useGameSession } from './useGameSession.js';

export type RemoteRoomLiveSession = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'sendChat' | 'submit'
>;

const ownPlayerId = (state: ClientSessionState): string | undefined =>
  state.phase === 'ready' &&
  state.role === 'player' &&
  state.view?.viewer.kind === 'player'
    ? state.view.viewer.playerId
    : undefined;

/** Existing connected-room controls backed only by authenticated session APIs. */
export const RemoteRoomLiveControls = ({
  session,
  onLeave,
  confirmLeave = () =>
    globalThis.confirm(
      'Are you sure you want to leave the room? Current game state will be lost.'
    ),
}: {
  readonly session: RemoteRoomLiveSession;
  readonly onLeave?: () => void;
  readonly confirmLeave?: () => boolean;
}) => {
  const state = useGameSession(session);
  const [message, setMessage] = useState('');
  const playerId = ownPlayerId(state);
  const playerControls = playerId !== undefined;
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
      <div id="p2ChatboxButtonContainer" className="chat-button-container">
        {playerControls && (
          <>
            <button
              id="p2AttackButton"
              type="button"
              className="self-color"
              onClick={() => submitTable('attack')}
            >
              Attack
            </button>
            <button
              id="p2PassButton"
              type="button"
              className="self-color"
              onClick={() => submitTable('pass')}
            >
              Pass
            </button>
          </>
        )}
        <button
          id="p2FREEBUTTON"
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
        id="p2MessageInput"
        type="text"
        placeholder="Type your message here..."
        aria-label="Chat message"
        maxLength={MAX_CHAT_CODE_UNITS}
        disabled={!ready}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleMessageKeyDown}
      />
      <div id="p2BottomButtonContainer" className="sidebox-button-container">
        {playerControls && (
          <>
            <button
              id="p2SetupButton"
              type="button"
              className="self-color"
              onClick={() => submitLifecycle('setup')}
            >
              Set Up
            </button>
            <button
              id="p2ResetButton"
              type="button"
              className="self-color"
              onClick={() => submitLifecycle('reset')}
            >
              Reset
            </button>
          </>
        )}
        {onLeave && (
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
      </div>
    </>
  );
};
