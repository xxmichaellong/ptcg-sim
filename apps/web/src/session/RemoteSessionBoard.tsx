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
import { useGameSession } from './useGameSession.js';

export const RemoteSessionBoard = ({
  session,
  rendererKind,
  onIntent,
  onSubmission,
}: {
  readonly session: RemoteGameSession;
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly onSubmission?: (
    command: WireGameCommand,
    result: SubmitCommandResult
  ) => void;
}) => {
  const state = useGameSession(session);
  const submitCommand = useCallback(
    (command: WireGameCommand) => {
      const result = session.submit(command);
      onSubmission?.(command, result);
      return result;
    },
    [onSubmission, session]
  );

  if (!state.view) {
    return (
      <div className="board-spike-host">
        <span
          className="renderer-status"
          role="status"
          data-session-phase={state.phase}
        >
          {state.phase}
        </span>
      </div>
    );
  }

  return (
    <RendererSpikeBoard
      view={state.view}
      rendererKind={rendererKind}
      onIntent={onIntent}
      submitCommand={submitCommand}
    />
  );
};
