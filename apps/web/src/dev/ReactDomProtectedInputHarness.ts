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
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  BoardSessionLiveSource,
  BoardSessionRendererEffect,
  BoardSessionReplaySource,
} from '../board/BoardSessionAdapter.js';
import type { BoardOverlayState } from '../board/BoardSessionController.js';
import { ReactDomBoardSessionRuntime } from '../board/ReactDomBoardSessionRuntime.js';
import {
  LegacyBoardOverlays,
  type LegacyBoardContextActionId,
  type LegacyBoardOverlayActions,
  type LegacyBoardZoneActionId,
} from '../board/overlays/LegacyBoardOverlays.js';
import type { ReplaySessionCoordinatorState } from '../replay/ReplaySessionCoordinator.js';

const HANDLE_NAME = '__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__';

type RejectionEffect = Extract<
  BoardSessionRendererEffect,
  { readonly kind: 'IntentRejected' }
>;
type OverlayRejectionEffect = Extract<
  BoardSessionRendererEffect,
  { readonly kind: 'OverlayActionRejected' }
>;

export interface ReactDomProtectedInputFixture {
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly unsupportedCardId: string;
  readonly unsupportedStackCardIds: readonly string[];
  readonly activeTopCardId: string;
  readonly activeStackId: string;
  readonly activeAbilityUsed: boolean;
  readonly destinationZoneId: string;
  readonly destinationCardIds: readonly string[];
  readonly destinationSortedCardIds: readonly string[];
}

export interface ReactDomProtectedInputEvidence {
  readonly submissions: readonly WireGameCommand[];
  readonly submissionResults: readonly SubmitCommandResult[];
  readonly rejections: readonly RejectionEffect[];
  readonly overlayRejections: readonly OverlayRejectionEffect[];
  readonly overlayActions: readonly ReactDomProtectedOverlayAction[];
  readonly presentation: BoardPresentation;
  readonly overlays: BoardOverlayState;
  readonly reportedErrors: readonly string[];
}

export type ReactDomProtectedOverlayAction =
  | {
      readonly kind: 'context';
      readonly action: LegacyBoardContextActionId;
      readonly cardId: string;
      readonly value?: string;
    }
  | {
      readonly kind: 'zone';
      readonly action: LegacyBoardZoneActionId;
      readonly zoneId: string;
    };

export interface ReactDomProtectedInputHarness {
  readonly getFixture: () => ReactDomProtectedInputFixture;
  readonly getEvidence: () => ReactDomProtectedInputEvidence;
  readonly clearEvidence: () => void;
  readonly setDarkMode: (enabled: boolean) => void;
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
  const baseView = createRendererSpikeView();
  const firstPlayerId = baseView.playerOrder[0];
  const secondPlayerId = baseView.playerOrder[1];
  if (!firstPlayerId || !secondPlayerId) {
    throw new Error('Protected-input harness requires exactly two players');
  }
  const destinationZoneId = `zone:${firstPlayerId}:discard`;
  const destinationZone = baseView.zones[destinationZoneId];
  if (!destinationZone) {
    throw new Error('Protected-input destination zone is missing');
  }
  // A non-sorted canonical order makes the browser proof sensitive to both
  // enabling and disabling the paint-only Sort control.
  const view = {
    ...baseView,
    zones: {
      ...baseView.zones,
      [destinationZoneId]: {
        ...destinationZone,
        cards: [...destinationZone.cards].reverse(),
      },
    },
  };

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
  const overlayRejections: OverlayRejectionEffect[] = [];
  const overlayActions: ReactDomProtectedOverlayAction[] = [];
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
  const boardHost = document.createElement('div');
  boardHost.dataset.reactDomProtectedInputBoard = 'true';
  Object.assign(boardHost.style, {
    position: 'absolute',
    inset: '0',
  });
  const overlayHost = document.createElement('div');
  overlayHost.dataset.reactDomProtectedInputOverlays = 'true';
  Object.assign(overlayHost.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });
  host.append(boardHost, overlayHost);
  document.body.append(host);

  const runtime = new ReactDomBoardSessionRuntime({
    live,
    replay,
    layout,
    onBoardEffect: (effect) => {
      if (effect.kind === 'IntentRejected') rejections.push(effect);
      if (effect.kind === 'OverlayActionRejected')
        overlayRejections.push(effect);
    },
    onSubmission: (_command, result) => submissionResults.push(result),
    reportError: (error) => reportedErrors.push(String(error)),
  });
  try {
    await runtime.mount(boardHost);
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
  const sourceCard = scene.cards
    .filter((card) => card.parentId === sourceZoneId && card.interactive)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const localActiveStackId = view.boards[firstPlayerId]?.activeStackId;
  const localActiveStack = localActiveStackId
    ? view.stacks[localActiveStackId]
    : undefined;
  const unsupportedCardId = localActiveStack?.evolutionCards[0]?.id;
  const activeTopCardId = localActiveStack?.evolutionCards.at(-1)?.id;
  if (
    !sourceCard ||
    !unsupportedCardId ||
    !activeTopCardId ||
    !localActiveStackId ||
    !localActiveStack ||
    !scene.cards.some(
      (card) => card.id === unsupportedCardId && card.interactive
    ) ||
    !scene.cards.some(
      (card) => card.id === activeTopCardId && card.interactive
    ) ||
    !scene.zones.some(
      (zone) => zone.id === destinationZoneId && zone.interactive
    )
  ) {
    runtime.dispose();
    host.remove();
    throw new Error('Protected-input fixture is incomplete');
  }
  const destinationCards = scene.cards.filter(
    (card) => card.parentId === destinationZoneId
  );
  const fixture: ReactDomProtectedInputFixture = {
    sourceCardId: String(sourceCard.id),
    sourceZoneId,
    unsupportedCardId: String(unsupportedCardId),
    unsupportedStackCardIds: scene.cards
      .filter((card) => card.parentId === localActiveStackId)
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((card) => String(card.id)),
    activeTopCardId: String(activeTopCardId),
    activeStackId: localActiveStackId,
    activeAbilityUsed: localActiveStack.abilityUsed,
    destinationZoneId,
    destinationCardIds: destinationCards.map((card) => String(card.id)),
    destinationSortedCardIds: destinationCards
      .map((card, index) => ({ card, index }))
      .sort((left, right) => {
        if (left.card.label < right.card.label) return -1;
        if (left.card.label > right.card.label) return 1;
        return left.index - right.index;
      })
      .map(({ card }) => String(card.id)),
  };

  const overlayRoot = createRoot(overlayHost);
  const overlayCallbacks: LegacyBoardOverlayActions = {
    emitOpenedZoneCardIntent: (intent) => {
      runtime.emitOpenedZoneCardIntent(intent);
    },
    dismiss: (scope) => {
      runtime.dismissLocalPresentation(scope);
    },
    invokeContextAction: (action, cardId) => {
      overlayActions.push({ kind: 'context', action, cardId: String(cardId) });
      runtime.emitLegacyOverlayAction({ kind: 'context', action, cardId });
    },
    invokeZoneAction: (action, zoneId) => {
      overlayActions.push({ kind: 'zone', action, zoneId });
      runtime.emitLegacyOverlayAction({ kind: 'zone', action, zoneId });
    },
    submitDamageInput: (cardId, value) => {
      overlayActions.push({
        kind: 'context',
        action: 'setDamage',
        cardId: String(cardId),
        value,
      });
      runtime.emitLegacyOverlayAction({
        kind: 'context',
        action: 'setDamage',
        cardId,
        value,
      });
    },
    submitSpecialConditionInput: (cardId, value) => {
      overlayActions.push({
        kind: 'context',
        action: 'setSpecialCondition',
        cardId: String(cardId),
        value,
      });
      runtime.emitLegacyOverlayAction({
        kind: 'context',
        action: 'setSpecialCondition',
        cardId,
        value,
      });
    },
  };
  let darkMode = false;
  const renderOverlays = (): void => {
    const current = runtime.getBoardSnapshot();
    overlayRoot.render(
      current
        ? createElement(LegacyBoardOverlays, {
            state: current,
            darkMode,
            actions: overlayCallbacks,
          })
        : null
    );
  };
  const unsubscribeBoard = runtime.subscribeBoard(renderOverlays);
  renderOverlays();

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
        overlayRejections: [...overlayRejections],
        overlayActions: [...overlayActions],
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
      overlayRejections.length = 0;
      overlayActions.length = 0;
      reportedErrors.length = 0;
    },
    setDarkMode: (enabled) => {
      requireSnapshot();
      darkMode = enabled;
      renderOverlays();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeBoard();
      overlayRoot.unmount();
      runtime.dispose();
      host.remove();
      if (window[HANDLE_NAME] === harness) delete window[HANDLE_NAME];
    },
  };
  window[HANDLE_NAME] = harness;
};
