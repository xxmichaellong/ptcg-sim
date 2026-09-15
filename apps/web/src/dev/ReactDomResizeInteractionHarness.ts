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
  type BoardShellMode,
} from '@ptcgsim/renderer-contract';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  BoardSessionLiveSource,
  BoardSessionReplaySource,
} from '../board/BoardSessionAdapter.js';
import { ReactDomBoardSessionRuntime } from '../board/ReactDomBoardSessionRuntime.js';
import { LegacyBoardChrome } from '../board/LegacyBoardChrome.js';
import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';

const HANDLE_NAME = '__PTCG_REACT_DOM_RESIZE_HARNESS__';
const CHROME_HANDLE_NAME = '__PTCG_REACT_DOM_BOARD_CHROME_HARNESS__';

export interface ReactDomResizeInteractionHarness {
  readonly getLayout: () => BoardLayoutState;
  readonly reset: (flipped?: boolean) => void;
  readonly installOverlappingHandles: () => void;
  readonly dispose: () => void;
}

export interface ReactDomBoardChromeHarness {
  readonly getLayout: () => BoardLayoutState;
  readonly reset: (flipped?: boolean) => void;
  readonly setDarkMode: (enabled: boolean) => void;
  readonly getActionCounts: () => Readonly<Record<string, number>>;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    __PTCG_REACT_DOM_RESIZE_HARNESS__?: ReactDomResizeInteractionHarness;
    __PTCG_REACT_DOM_BOARD_CHROME_HARNESS__?: ReactDomBoardChromeHarness;
  }
}

const view = createRendererSpikeView();
const firstPlayerId = view.playerOrder[0];
const secondPlayerId = view.playerOrder[1];
if (!firstPlayerId || !secondPlayerId) {
  throw new Error('React DOM resize harness requires exactly two players');
}

const currentViewport = (): BoardLayoutState['viewport'] => ({
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
  devicePixelRatio: Math.max(1, window.devicePixelRatio),
});

const createLayout = (
  viewport: BoardLayoutState['viewport'],
  shellMode: BoardShellMode = 'fullscreen'
): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport,
  playerIds: [firstPlayerId, secondPlayerId],
  bottomPlayerId: firstPlayerId,
  shellMode,
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
      layout: createLayout(currentViewport()),
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
    const synchronizeViewport = (): void => {
      runtime.setViewport(currentViewport());
    };
    window.addEventListener('resize', synchronizeViewport);
    const reset = (flipped = false): void => {
      if (disposed) throw new Error('Resize interaction harness is disposed');
      runtime.replaceLayoutState(createLayout(currentViewport()));
      if (flipped) runtime.flipBoard();
    };
    const harness: ReactDomResizeInteractionHarness = {
      getLayout: () => runtime.getLayoutState(),
      reset,
      installOverlappingHandles: () => {
        const layout = createLayout(currentViewport());
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
        window.removeEventListener('resize', synchronizeViewport);
        runtime.dispose();
        host.remove();
        if (window[HANDLE_NAME] === harness) delete window[HANDLE_NAME];
      },
    };
    window[HANDLE_NAME] = harness;
  };

/** Development-only painted-chrome seam; it is unreachable from production. */
export const mountReactDomBoardChromeHarness = async (): Promise<void> => {
  window[CHROME_HANDLE_NAME]?.dispose();
  const host = document.createElement('div');
  host.dataset.reactDomBoardChromeHarness = 'true';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    overflow: 'hidden',
    background: '#fff',
    isolation: 'isolate',
  });
  const boardHost = document.createElement('div');
  boardHost.dataset.reactDomBoardChromeBoard = 'true';
  Object.assign(boardHost.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    opacity: '0',
  });
  const chromeHost = document.createElement('div');
  chromeHost.dataset.reactDomBoardChromePaint = 'true';
  Object.assign(chromeHost.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });
  host.append(boardHost, chromeHost);
  document.body.append(host);

  const runtime = new ReactDomBoardSessionRuntime({
    live,
    replay,
    layout: createLayout(currentViewport(), 'sidebar'),
    enableLegacyResizeInteraction: true,
  });
  try {
    await runtime.mount(boardHost);
  } catch (error) {
    runtime.dispose();
    host.remove();
    throw error;
  }

  type CountedChromeAction =
    'takeTurn' | 'flipCoin' | 'refreshImages' | 'toggleOncePerGame';
  const actionCounts: Record<CountedChromeAction, number> = {
    takeTurn: 0,
    flipCoin: 0,
    refreshImages: 0,
    toggleOncePerGame: 0,
  };
  const count = (action: CountedChromeAction): void => {
    actionCounts[action] += 1;
  };
  const chromeRoot = createRoot(chromeHost);
  let darkMode = false;
  const renderChrome = (): void => {
    chromeRoot.render(
      createElement(LegacyBoardChrome, {
        layout: runtime.getCharacterizedLayoutSnapshot(),
        localPlayerId: firstPlayerId,
        players: view.players,
        darkMode,
        actions: {
          takeTurn: () => count('takeTurn'),
          flipCoin: () => count('flipCoin'),
          flipBoard: () => runtime.flipBoard(),
          refreshImages: () => count('refreshImages'),
          toggleFullscreen: () =>
            runtime.setShellMode(
              runtime.getLayoutState().shellMode === 'sidebar'
                ? 'fullscreen'
                : 'sidebar'
            ),
          toggleOncePerGame: () => count('toggleOncePerGame'),
        },
      })
    );
  };
  const unsubscribeLayout = runtime.subscribeLayout(renderChrome);
  renderChrome();

  let disposed = false;
  const synchronizeViewport = (): void => {
    runtime.setViewport(currentViewport());
  };
  window.addEventListener('resize', synchronizeViewport);
  const harness: ReactDomBoardChromeHarness = {
    getLayout: () => runtime.getLayoutState(),
    reset: (flipped = false) => {
      if (disposed) throw new Error('Board chrome harness is disposed');
      runtime.replaceLayoutState(createLayout(currentViewport(), 'sidebar'));
      darkMode = false;
      renderChrome();
      if (flipped) runtime.flipBoard();
    },
    setDarkMode: (enabled) => {
      if (disposed) throw new Error('Board chrome harness is disposed');
      darkMode = enabled;
      renderChrome();
    },
    getActionCounts: () => ({ ...actionCounts }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', synchronizeViewport);
      unsubscribeLayout();
      chromeRoot.unmount();
      runtime.dispose();
      host.remove();
      if (window[CHROME_HANDLE_NAME] === harness) {
        delete window[CHROME_HANDLE_NAME];
      }
    },
  };
  window[CHROME_HANDLE_NAME] = harness;
};
