import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import { LegacyReplayControls } from './LegacyReplayControls.js';
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
  readonly primaryTabLabel: 'Solo' | 'Replay';
  /** Empty string represents the legacy/default stylesheet width. */
  readonly primaryTabWidth: '' | '50%';
  readonly settingsTabWidth: '' | '50%';
  readonly replayControls: boolean;
  readonly visibility: ReplayModeChromeVisibility;
  readonly hiddenPrivateMutationActionIds: readonly string[];
}

const LIVE_CHROME: ReplayModeChromeState = {
  active: false,
  primaryTabLabel: 'Solo',
  primaryTabWidth: '',
  settingsTabWidth: '',
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
  primaryTabLabel: 'Replay',
  primaryTabWidth: '50%',
  settingsTabWidth: '50%',
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

export interface ReplayModeShellContext {
  readonly state: ReplaySessionCoordinatorState;
  readonly chrome: ReplayModeChromeState;
  readonly controls: ReactElement | null;
  readonly exitReplay: () => boolean;
}

export interface ReplayModeShellProps {
  readonly coordinator: ReplayModeShellCoordinator;
  readonly children: (context: ReplayModeShellContext) => ReactNode;
}

/**
 * Headless bridge for the eventual parity sidebar. It adds no DOM/layout of its
 * own and keeps coordinator methods correctly bound for React consumers.
 */
export const ReplayModeShell = ({
  coordinator,
  children,
}: ReplayModeShellProps) => {
  const state = useReplaySession(coordinator);
  const chrome = selectReplayModeChrome(state);
  const handlers = useMemo(
    () => ({
      restart: () => coordinator.restart(),
      previous: () => coordinator.stepPrevious(),
      next: () => coordinator.stepNext(),
      fastForward: () => coordinator.fastForward(),
    }),
    [coordinator]
  );
  const exitReplay = useCallback(() => coordinator.exitReplay(), [coordinator]);
  const controls = chrome.replayControls ? (
    <LegacyReplayControls visible handlers={handlers} />
  ) : null;

  return <>{children({ state, chrome, controls, exitReplay })}</>;
};
