import { useCallback, useMemo, type ReactNode } from 'react';

import type {
  ReplaySessionCoordinator,
  ReplaySessionCoordinatorState,
} from './ReplaySessionCoordinator.js';
import { useReplaySession } from './useReplaySession.js';

export const LEGACY_REPLAY_PRIVATE_MUTATION_ACTION_IDS = [
  'shuffleDeckButton',
  'shuffleDiscardButton',
  'discardViewCardsButton',
  'shuffleViewCardsButton',
  'shuffleBottomViewCardsButton',
  'lostZoneViewCardsButton',
  'handViewCardsButton',
  'discardAttachedCardsButton',
  'shuffleAttachedCardsButton',
  'lostZoneAttachedCardsButton',
  'handAttachedCardsButton',
  'leaveAttachedCardsButton',
] as const;

export interface ReplayModeChromeVisibility {
  readonly multiplayerTab: boolean;
  readonly deckImport: boolean;
  readonly chatActions: boolean;
  readonly messageInput: boolean;
  readonly exitReplay: boolean;
  readonly replayImport: boolean;
  readonly stateImport: boolean;
  readonly stateExport: boolean;
  readonly logExport: boolean;
  readonly clearLog: boolean;
  readonly turnAction: boolean;
  readonly coinAction: boolean;
  readonly privateMutationActions: boolean;
  readonly optionsAction: boolean;
}

export interface ReplayModeChromeState {
  readonly active: boolean;
  readonly replayControls: boolean;
  readonly visibility: ReplayModeChromeVisibility;
  readonly hiddenPrivateMutationActionIds: readonly string[];
}

const LIVE_CHROME: ReplayModeChromeState = {
  active: false,
  replayControls: false,
  visibility: {
    multiplayerTab: true,
    deckImport: true,
    chatActions: true,
    messageInput: true,
    exitReplay: false,
    replayImport: true,
    stateImport: true,
    stateExport: true,
    logExport: true,
    clearLog: true,
    turnAction: true,
    coinAction: true,
    privateMutationActions: true,
    optionsAction: true,
  },
  hiddenPrivateMutationActionIds: [],
};

const REPLAY_CHROME: ReplayModeChromeState = {
  active: true,
  replayControls: true,
  visibility: {
    multiplayerTab: false,
    deckImport: false,
    chatActions: false,
    messageInput: false,
    exitReplay: true,
    replayImport: false,
    stateImport: false,
    stateExport: true,
    logExport: true,
    clearLog: false,
    turnAction: false,
    coinAction: false,
    privateMutationActions: false,
    optionsAction: true,
  },
  hiddenPrivateMutationActionIds: LEGACY_REPLAY_PRIVATE_MUTATION_ACTION_IDS,
};

/** The request/discard phases retain live chrome until replay is installed. */
export const selectReplayModeChrome = (
  state: Pick<ReplaySessionCoordinatorState, 'mode'>
): ReplayModeChromeState =>
  state.mode === 'replay' ? REPLAY_CHROME : LIVE_CHROME;

export type ReplayModeShellCoordinator = Pick<
  ReplaySessionCoordinator,
  | 'getSnapshot'
  | 'subscribe'
  | 'restart'
  | 'stepPrevious'
  | 'stepNext'
  | 'fastForward'
  | 'exitReplay'
>;

/** Replay's transport: back to the start, one step either way, the end. */
export interface ReplayTransportHandlers {
  readonly restart: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly fastForward: () => void;
}

export interface ReplayModeShellContext {
  readonly state: ReplaySessionCoordinatorState;
  readonly chrome: ReplayModeChromeState;
  /** Bound to the coordinator; shown only while `chrome.replayControls`. */
  readonly handlers: ReplayTransportHandlers;
  readonly exitReplay: () => boolean;
}

export interface ReplayModeShellProps {
  readonly coordinator: ReplayModeShellCoordinator;
  readonly children: (context: ReplayModeShellContext) => ReactNode;
}

/**
 * Headless bridge between the replay coordinator and the room's chrome. It
 * adds no DOM of its own and keeps coordinator methods bound for React.
 */
export const ReplayModeShell = ({
  coordinator,
  children,
}: ReplayModeShellProps) => {
  const state = useReplaySession(coordinator);
  const chrome = selectReplayModeChrome(state);
  const handlers = useMemo(
    (): ReplayTransportHandlers => ({
      restart: () => coordinator.restart(),
      previous: () => coordinator.stepPrevious(),
      next: () => coordinator.stepNext(),
      fastForward: () => coordinator.fastForward(),
    }),
    [coordinator]
  );
  const exitReplay = useCallback(() => coordinator.exitReplay(), [coordinator]);

  return <>{children({ state, chrome, handlers, exitReplay })}</>;
};
