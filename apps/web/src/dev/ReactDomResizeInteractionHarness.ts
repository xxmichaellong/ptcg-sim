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
} from '@ptcgsim/renderer-contract';

import type {
  BoardSessionLiveSource,
  BoardSessionReplaySource,
} from '../board/BoardSessionAdapter.js';
import { ReactDomBoardSessionRuntime } from '../board/ReactDomBoardSessionRuntime.js';
import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';

const HANDLE_NAME = '__PTCG_REACT_DOM_RESIZE_HARNESS__';

export interface ReactDomResizeInteractionHarness {
  readonly getLayout: () => BoardLayoutState;
  readonly reset: (flipped?: boolean) => void;
  readonly installOverlappingHandles: () => void;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    __PTCG_REACT_DOM_RESIZE_HARNESS__?: ReactDomResizeInteractionHarness;
  }
}

const view = createRendererSpikeView();
const firstPlayerId = view.playerOrder[0];
const secondPlayerId = view.playerOrder[1];
if (!firstPlayerId || !secondPlayerId) {
  throw new Error('React DOM resize harness requires exactly two players');
}

const createLayout = (): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
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
});

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

const live: BoardSessionLiveSource = {
  getSnapshot: () => liveState,
  subscribe: () => () => undefined,
  submit: (_command: WireGameCommand): SubmitCommandResult => ({
    queued: true,
    commandId: 'resize-harness-command',
    clientSequence: 1,
  }),
};

const replay: BoardSessionReplaySource = {
  getSnapshot: () => replayState,
  subscribe: () => () => undefined,
};

/** Development-only real-browser seam; it is unreachable from production. */
export const mountReactDomResizeInteractionHarness =
  async (): Promise<void> => {
    window[HANDLE_NAME]?.dispose();
    const host = document.createElement('div');
    host.dataset.reactDomResizeHarness = 'true';
    Object.assign(host.style, {
      position: 'fixed',
      left: '20px',
      top: '60px',
      zIndex: '2147483647',
      transform: 'scale(0.75)',
      transformOrigin: 'top left',
    });
    document.body.append(host);

    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: createLayout(),
      enableLegacyResizeInteraction: true,
    });
    try {
      await runtime.mount(host);
    } catch (error) {
      runtime.dispose();
      host.remove();
      throw error;
    }

    let disposed = false;
    const reset = (flipped = false): void => {
      if (disposed) throw new Error('Resize interaction harness is disposed');
      runtime.replaceLayoutState(createLayout());
      if (flipped) runtime.flipBoard();
    };
    const harness: ReactDomResizeInteractionHarness = {
      getLayout: () => runtime.getLayoutState(),
      reset,
      installOverlappingHandles: () => {
        const layout = createLayout();
        runtime.replaceLayoutState({
          ...layout,
          vertical: {
            ...layout.vertical,
            lowerHandle: { bottomRatio: 0.5, heightRatio: 0.1 },
            upperHandle: { bottomRatio: 0.53, heightRatio: 0.1 },
            sharedPlacement: 'handleMidpoint',
          },
        });
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
