import {
  type RemoteGameSession,
  type SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import type { BoardIntent, BoardPreferences } from '@ptcgsim/renderer-contract';
import { useCallback, useMemo } from 'react';

import {
  RendererSpikeBoard,
  type RendererKind,
} from '../RendererSpikeBoard.js';
import type { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import { useReplaySession } from '../replay/useReplaySession.js';
import { applySoloOpponentHandVisibility } from './solo-opponent-hand-visibility.js';

export type ReplayBlockedSubmissionResult = {
  readonly queued: false;
  readonly reason: 'replay_mode';
};

export type RemoteBoardSubmissionResult =
  SubmitCommandResult | ReplayBlockedSubmissionResult;

export type RemoteBoardSession = Pick<RemoteGameSession, 'submit'>;

export const RemoteSessionBoard = ({
  session,
  replay,
  rendererKind,
  onIntent,
  onSubmission,
  preferences,
  roomMode = 'multiplayer',
  hideOpponentHand = false,
}: {
  readonly session: RemoteBoardSession;
  readonly replay: ReplaySessionCoordinator;
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
  readonly preferences?: BoardPreferences;
  readonly roomMode?: 'solo' | 'multiplayer';
  readonly hideOpponentHand?: boolean;
}) => {
  const state = useReplaySession(replay);
  const displayView = useMemo(
    () =>
      state.view && state.mode === 'live' && roomMode === 'solo'
        ? applySoloOpponentHandVisibility(state.view, hideOpponentHand)
        : state.view,
    [hideOpponentHand, roomMode, state.mode, state.view]
  );
  const replaySubmissionsBlocked =
    state.mode === 'replay' || state.requestPhase !== 'idle';
  const submissionsBlocked =
    replaySubmissionsBlocked || state.sessionPhase !== 'ready';
  const forwardIntent = useCallback(
    (intent: BoardIntent) => {
      if (submissionsBlocked && intent.kind === 'CardDropRequested') return;
      onIntent(intent);
    },
    [onIntent, submissionsBlocked]
  );
  const submitCommand = useCallback(
    (command: WireGameCommand) => {
      const result: RemoteBoardSubmissionResult = replaySubmissionsBlocked
        ? { queued: false, reason: 'replay_mode' }
        : session.submit(command);
      onSubmission?.(command, result);
      return result;
    },
    [onSubmission, replaySubmissionsBlocked, session]
  );

  if (!displayView) {
    return (
      <div className="board-spike-host">
        <span
          className="renderer-status"
          role="status"
          data-session-phase={state.sessionPhase}
        >
          {state.sessionPhase}
        </span>
      </div>
    );
  }

  return (
    <RendererSpikeBoard
      key={`${displayView.matchId}:${
        displayView.viewer.kind === 'player'
          ? displayView.viewer.playerId
          : 'spectator'
      }`}
      view={displayView}
      rendererKind={rendererKind}
      onIntent={forwardIntent}
      submitCommand={submitCommand}
      allowRevisionRegression={state.mode === 'replay'}
      sessionReady={state.sessionPhase === 'ready'}
      {...(preferences ? { preferences } : {})}
    />
  );
};
