import {
  type RemoteGameSession,
  type SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import type { BoardIntent } from '@ptcgsim/renderer-contract';
import { useCallback } from 'react';

import {
  RendererSpikeBoard,
  type RendererKind,
} from '../RendererSpikeBoard.js';
import type { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import { useReplaySession } from '../replay/useReplaySession.js';

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
}: {
  readonly session: RemoteBoardSession;
  readonly replay: ReplaySessionCoordinator;
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: RemoteBoardSubmissionResult
  ) => void;
}) => {
  const state = useReplaySession(replay);
  const submissionsBlocked =
    state.mode === 'replay' || state.requestPhase !== 'idle';
  const forwardIntent = useCallback(
    (intent: BoardIntent) => {
      if (submissionsBlocked && intent.kind === 'CardDropRequested') return;
      onIntent(intent);
    },
    [onIntent, submissionsBlocked]
  );
  const submitCommand = useCallback(
    (command: WireGameCommand) => {
      const result: RemoteBoardSubmissionResult = submissionsBlocked
        ? { queued: false, reason: 'replay_mode' }
        : session.submit(command);
      onSubmission?.(command, result);
      return result;
    },
    [onSubmission, session, submissionsBlocked]
  );

  if (!state.view) {
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
      key={`${state.view.matchId}:${
        state.view.viewer.kind === 'player'
          ? state.view.viewer.playerId
          : 'spectator'
      }`}
      view={state.view}
      rendererKind={rendererKind}
      onIntent={forwardIntent}
      submitCommand={submitCommand}
      allowRevisionRegression={state.mode === 'replay'}
    />
  );
};
