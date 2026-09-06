import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardLayoutState,
  type BoardPresentation,
} from '@ptcgsim/renderer-contract';

import type {
  BoardSessionLiveSource,
  BoardSessionRendererEffect,
  BoardSessionReplaySource,
} from '../board/BoardSessionAdapter.js';
import type { BoardOverlayState } from '../board/BoardSessionController.js';
import { ReactDomBoardSessionRuntime } from '../board/ReactDomBoardSessionRuntime.js';
import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';

const HANDLE_NAME = '__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__';

type RejectionEffect = Extract<
  BoardSessionRendererEffect,
  { readonly kind: 'IntentRejected' }
>;

export interface ReactDomProtectedInputFixture {
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly unsupportedCardId: string;
  readonly destinationZoneId: string;
}

export interface ReactDomProtectedInputEvidence {
  readonly submissions: readonly WireGameCommand[];
  readonly submissionResults: readonly SubmitCommandResult[];
  readonly rejections: readonly RejectionEffect[];
  readonly presentation: BoardPresentation;
  readonly overlays: BoardOverlayState;
  readonly reportedErrors: readonly string[];
}

export interface ReactDomProtectedInputHarness {
  readonly getFixture: () => ReactDomProtectedInputFixture;
  readonly getEvidence: () => ReactDomProtectedInputEvidence;
  readonly clearEvidence: () => void;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: ReactDomProtectedInputHarness;
  }
}

const currentViewport = (): BoardLayoutState['viewport'] => ({
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
  devicePixelRatio: Math.max(1, window.devicePixelRatio),
});

/** Development-only native-input seam; it is unreachable from production. */
export const mountReactDomProtectedInputHarness = async (): Promise<void> => {
  window[HANDLE_NAME]?.dispose();
  const view = createRendererSpikeView();
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  if (!firstPlayerId || !secondPlayerId) {
    throw new Error('Protected-input harness requires exactly two players');
  }

  const layout: BoardLayoutState = {
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: currentViewport(),
    playerIds: [firstPlayerId, secondPlayerId],
    bottomPlayerId: firstPlayerId,
    shellMode: 'fullscreen',
    vertical: {
      lowerFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerFrame },
      upperFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperFrame },
      lowerHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerHandle },
      upperHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperHandle },
      sharedPlacement: DEFAULT_BOARD_VERTICAL_LAYOUT_V1.sharedPlacement,
    },
  };
  const liveState: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    playerId: firstPlayerId,
    view,
    nextClientSequence: 1,
    pendingCommands: [],
    completedCommands: [],
    presentationEvents: [],
    chatMessages: [],
    presence: [],
    notices: [],
    replayLoading: false,
    reconnectAttempt: 0,
  };
  const replayState: ReplaySessionCoordinatorState = {
    generation: 0,
    mode: 'live',
    requestPhase: 'idle',
    sessionPhase: 'ready',
    canRequest: true,
    canExit: false,
    liveRevision: view.revision,
    view,
    playback: { phase: 'empty', generation: 0 },
  };

  const submissions: WireGameCommand[] = [];
  const submissionResults: SubmitCommandResult[] = [];
  const rejections: RejectionEffect[] = [];
  const reportedErrors: string[] = [];
  let clientSequence = 0;
  const live: BoardSessionLiveSource = {
    getSnapshot: () => liveState,
    subscribe: () => () => undefined,
    submit: (command) => {
      submissions.push(command);
      clientSequence += 1;
      return {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      };
    },
  };
  const replay: BoardSessionReplaySource = {
    getSnapshot: () => replayState,
    subscribe: () => () => undefined,
  };

  const host = document.createElement('div');
  host.dataset.reactDomProtectedInputHarness = 'true';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    overflow: 'hidden',
    background: '#fff',
    isolation: 'isolate',
  });
  document.body.append(host);

  const runtime = new ReactDomBoardSessionRuntime({
    live,
    replay,
    layout,
    onBoardEffect: (effect) => {
      if (effect.kind === 'IntentRejected') rejections.push(effect);
    },
    onSubmission: (_command, result) => submissionResults.push(result),
    reportError: (error) => reportedErrors.push(String(error)),
  });
  try {
    await runtime.mount(host);
  } catch (error) {
    runtime.dispose();
    host.remove();
    throw error;
  }

  const snapshot = runtime.getBoardSnapshot();
  const scene = snapshot?.scene;
  if (!snapshot || !scene) {
    runtime.dispose();
    host.remove();
    throw new Error('Protected-input harness did not install a board scene');
  }
  const sourceZoneId = `zone:${firstPlayerId}:hand`;
  const destinationZoneId = `zone:${firstPlayerId}:discard`;
  const sourceCard = scene.cards
    .filter((card) => card.parentId === sourceZoneId && card.interactive)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const localActiveStackId = view.boards[firstPlayerId]?.activeStackId;
  const localActiveStack = localActiveStackId
    ? view.stacks[localActiveStackId]
    : undefined;
  const unsupportedCardId = localActiveStack?.evolutionCards[0]?.id;
  if (
    !sourceCard ||
    !unsupportedCardId ||
    !scene.cards.some(
      (card) => card.id === unsupportedCardId && card.interactive
    ) ||
    !scene.zones.some(
      (zone) => zone.id === destinationZoneId && zone.interactive
    )
  ) {
    runtime.dispose();
    host.remove();
    throw new Error('Protected-input fixture is incomplete');
  }
  const fixture: ReactDomProtectedInputFixture = {
    sourceCardId: String(sourceCard.id),
    sourceZoneId,
    unsupportedCardId: String(unsupportedCardId),
    destinationZoneId,
  };

  let disposed = false;
  const requireSnapshot = () => {
    if (disposed) throw new Error('Protected-input harness is disposed');
    const current = runtime.getBoardSnapshot();
    if (!current) throw new Error('Protected-input board snapshot is missing');
    return current;
  };
  const harness: ReactDomProtectedInputHarness = {
    getFixture: () => ({ ...fixture }),
    getEvidence: () => {
      const current = requireSnapshot();
      return {
        submissions: [...submissions],
        submissionResults: [...submissionResults],
        rejections: [...rejections],
        presentation: current.presentation,
        overlays: current.overlays,
        reportedErrors: [...reportedErrors],
      };
    },
    clearEvidence: () => {
      requireSnapshot();
      submissions.length = 0;
      submissionResults.length = 0;
      rejections.length = 0;
      reportedErrors.length = 0;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      runtime.dispose();
      host.remove();
      if (window[HANDLE_NAME] === harness) delete window[HANDLE_NAME];
    },
  };
  window[HANDLE_NAME] = harness;
};
