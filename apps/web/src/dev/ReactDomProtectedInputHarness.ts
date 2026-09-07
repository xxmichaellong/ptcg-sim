import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import { asViewDefinitionId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardLayoutState,
  type BoardPresentation,
} from '@ptcgsim/renderer-contract';
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  BoardSessionLiveSource,
  BoardSessionRendererEffect,
  BoardSessionReplaySource,
} from '../board/BoardSessionAdapter.js';
import type { BoardOverlayState } from '../board/BoardSessionController.js';
import { LegacyBoardKeyboardShortcuts } from '../board/LegacyBoardKeyboardShortcuts.js';
import { ReactDomBoardSessionRuntime } from '../board/ReactDomBoardSessionRuntime.js';
import type { LegacyBoardShortcutActionRequest } from '../board/resolveLegacyBoardShortcutAction.js';
import {
  LegacyBoardOverlays,
  type LegacyBoardCategoryChoice,
  type LegacyBoardContextActionId,
  type LegacyBoardMoveChoice,
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
type ShortcutRejectionEffect = Extract<
  BoardSessionRendererEffect,
  { readonly kind: 'ShortcutActionRejected' }
>;

export interface ReactDomProtectedInputFixture {
  readonly ownPlayerId: string;
  readonly opponentPlayerId: string;
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly stadiumCardId: string;
  readonly ownBoardZoneId: string;
  readonly ownBoardCardIds: readonly string[];
  readonly ownDeckZoneId: string;
  readonly ownDeckCardId: string;
  readonly opponentDeckCardId: string;
  readonly ownDeckCount: number;
  readonly opponentDeckCount: number;
  readonly ownHandCount: number;
  readonly unsupportedCardId: string;
  readonly unsupportedStackCardIds: readonly string[];
  readonly activeTopCardId: string;
  readonly activeStackId: string;
  readonly activeAbilityUsed: boolean;
  readonly conditionlessActiveTopCardId: string;
  readonly conditionlessActiveStackId: string;
  readonly destinationZoneId: string;
  readonly destinationCardIds: readonly string[];
  readonly destinationSortedCardIds: readonly string[];
  readonly ownPrizeCardId: string;
  readonly ownPrizeCardIds: readonly string[];
  readonly opponentPrizeCardId: string;
  readonly opponentPrizeCardIds: readonly string[];
  readonly opponentHandCardId: string;
  readonly opponentHandCardIds: readonly string[];
  readonly replayLocalCardLabel: string;
}

export interface ReactDomProtectedInputEvidence {
  readonly submissions: readonly WireGameCommand[];
  readonly submissionResults: readonly SubmitCommandResult[];
  readonly rejections: readonly RejectionEffect[];
  readonly overlayRejections: readonly OverlayRejectionEffect[];
  readonly overlayActions: readonly ReactDomProtectedOverlayAction[];
  readonly shortcutRejections: readonly ShortcutRejectionEffect[];
  readonly shortcutActions: readonly LegacyBoardShortcutActionRequest[];
  readonly mulliganDeclarations: number;
  readonly deckViewDeclarations: number;
  readonly boardFlips: number;
  readonly sceneRefreshes: number;
  readonly presentation: BoardPresentation;
  readonly overlays: BoardOverlayState;
  readonly sourceKind: 'live' | 'replay' | null;
  readonly replayLocalZoneModes: Readonly<Partial<Record<string, string>>>;
  readonly replayLocalCardModes: Readonly<Partial<Record<string, string>>>;
  readonly reportedErrors: readonly string[];
}

export type ReactDomProtectedOverlayAction =
  | {
      readonly kind: 'context';
      readonly action: LegacyBoardContextActionId;
      readonly cardId: string;
      readonly value?: string;
      readonly category?: LegacyBoardCategoryChoice;
      readonly destination?: LegacyBoardMoveChoice;
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
  readonly enterSoloReplay: () => void;
  readonly advanceSoloReplay: () => void;
  readonly seekSoloReplayStart: () => void;
  readonly exitSoloReplay: () => void;
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
  const eligibleReplayZones = Object.values(view.zones).filter(
    (zone) =>
      zone.kind === 'prizes' ||
      (zone.kind === 'hand' && zone.ownerId !== firstPlayerId)
  );
  const replayDefinitionId = asViewDefinitionId(
    'protected-replay-local-definition'
  );
  const visibleFixtureDefinition = Object.values(view.definitions)[0];
  if (!visibleFixtureDefinition) {
    throw new Error('Protected-input harness requires a visible definition');
  }
  const replayLocalCardLabel = 'Replay-local disclosed card';
  const replayLocalDisclosure = {
    definitions: [
      {
        id: replayDefinitionId,
        name: replayLocalCardLabel,
        category: 'Pokémon' as const,
        imageUrl: visibleFixtureDefinition.imageUrl,
      },
    ],
    zoneIds: eligibleReplayZones.map((zone) => zone.id),
    cards: eligibleReplayZones.flatMap((zone) =>
      zone.cards
        .filter((card) => card.kind === 'concealed')
        .map((card) => ({
          kind: 'known' as const,
          id: card.id,
          definitionId: replayDefinitionId,
          ownerId: card.ownerId,
          category: 'Pokémon' as const,
          face: 'up' as const,
          orientationQuarterTurns: 0 as const,
          abilityUsed: false,
          publiclyRevealed: false as const,
        }))
    ),
  };
  let playbackGeneration = 0;
  let replayState: ReplaySessionCoordinatorState = {
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
  const shortcutRejections: ShortcutRejectionEffect[] = [];
  const shortcutActions: LegacyBoardShortcutActionRequest[] = [];
  let mulliganDeclarations = 0;
  let deckViewDeclarations = 0;
  let boardFlips = 0;
  let sceneRefreshes = 0;
  const reportedErrors: string[] = [];
  let clientSequence = 0;
  let soloUndoPending = false;
  const live: BoardSessionLiveSource = {
    getSnapshot: () => liveState,
    subscribe: () => () => undefined,
    declareMulligan: () => {
      mulliganDeclarations += 1;
      return true;
    },
    declareDeckView: () => {
      deckViewDeclarations += 1;
      return true;
    },
    submit: (command) => {
      if (command.type === 'ApplySoloUndo' && soloUndoPending) {
        return { queued: false, reason: 'command_pending' };
      }
      submissions.push(command);
      if (command.type === 'ApplySoloUndo') soloUndoPending = true;
      clientSequence += 1;
      return {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      };
    },
  };
  const replayListeners = new Set<() => void>();
  const replay: BoardSessionReplaySource = {
    getSnapshot: () => replayState,
    subscribe: (listener) => {
      replayListeners.add(listener);
      return () => replayListeners.delete(listener);
    },
  };
  const publishReplay = (next: ReplaySessionCoordinatorState): void => {
    replayState = next;
    for (const listener of [...replayListeners]) listener();
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
      if (effect.kind === 'ShortcutActionRejected')
        shortcutRejections.push(effect);
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
  const ownBoardZoneId = `zone:${firstPlayerId}:board`;
  const sourceCard = scene.cards
    .filter((card) => card.parentId === sourceZoneId && card.interactive)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const ownDeckZoneId = `zone:${firstPlayerId}:deck`;
  const opponentDeckZoneId = `zone:${secondPlayerId}:deck`;
  const ownDeckCard = scene.cards
    .filter((card) => card.parentId === ownDeckZoneId && card.interactive)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const opponentDeckCard = scene.cards
    .filter((card) => card.parentId === opponentDeckZoneId && card.interactive)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const localActiveStackId = view.boards[firstPlayerId]?.activeStackId;
  const localActiveStack = localActiveStackId
    ? view.stacks[localActiveStackId]
    : undefined;
  const unsupportedCardId = localActiveStack?.evolutionCards[0]?.id;
  const activeTopCardId = localActiveStack?.evolutionCards.at(-1)?.id;
  const conditionlessActiveStackId = view.boards[secondPlayerId]?.activeStackId;
  const conditionlessActiveStack = conditionlessActiveStackId
    ? view.stacks[conditionlessActiveStackId]
    : undefined;
  const conditionlessActiveTopCardId =
    conditionlessActiveStack?.evolutionCards.at(-1)?.id;
  if (
    !sourceCard ||
    !ownDeckCard ||
    !opponentDeckCard ||
    !unsupportedCardId ||
    !activeTopCardId ||
    !conditionlessActiveTopCardId ||
    !conditionlessActiveStackId ||
    conditionlessActiveStack?.specialCondition !== null ||
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
  const ownPrizeCards = view.zones[`zone:${firstPlayerId}:prizes`]?.cards;
  const opponentPrizeCards = view.zones[`zone:${secondPlayerId}:prizes`]?.cards;
  const opponentHandCards = view.zones[`zone:${secondPlayerId}:hand`]?.cards;
  const ownPrizeCard = ownPrizeCards?.at(-1);
  const opponentPrizeCard = opponentPrizeCards?.at(-1);
  const opponentHandCard = opponentHandCards?.at(-1);
  const stadiumCard = view.zones['zone:shared:stadium']?.cards[0];
  if (
    !ownPrizeCards ||
    !opponentPrizeCards ||
    !opponentHandCards ||
    !ownPrizeCard ||
    !opponentPrizeCard ||
    !opponentHandCard ||
    !stadiumCard
  ) {
    runtime.dispose();
    host.remove();
    throw new Error('Protected-input replay fixture is incomplete');
  }
  const fixture: ReactDomProtectedInputFixture = {
    ownPlayerId: firstPlayerId,
    opponentPlayerId: secondPlayerId,
    sourceCardId: String(sourceCard.id),
    sourceZoneId,
    stadiumCardId: String(stadiumCard.id),
    ownBoardZoneId,
    ownBoardCardIds: view.zones[ownBoardZoneId]!.cards.map((card) =>
      String(card.id)
    ),
    ownDeckZoneId,
    ownDeckCardId: String(ownDeckCard.id),
    opponentDeckCardId: String(opponentDeckCard.id),
    ownDeckCount: view.zones[ownDeckZoneId]!.cards.length,
    opponentDeckCount: view.zones[opponentDeckZoneId]!.cards.length,
    ownHandCount: view.zones[sourceZoneId]!.cards.length,
    unsupportedCardId: String(unsupportedCardId),
    unsupportedStackCardIds: scene.cards
      .filter((card) => card.parentId === localActiveStackId)
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((card) => String(card.id)),
    activeTopCardId: String(activeTopCardId),
    activeStackId: localActiveStackId,
    activeAbilityUsed: localActiveStack.abilityUsed,
    conditionlessActiveTopCardId: String(conditionlessActiveTopCardId),
    conditionlessActiveStackId,
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
    ownPrizeCardId: String(ownPrizeCard.id),
    ownPrizeCardIds: ownPrizeCards.map((card) => String(card.id)),
    opponentPrizeCardId: String(opponentPrizeCard.id),
    opponentPrizeCardIds: opponentPrizeCards.map((card) => String(card.id)),
    opponentHandCardId: String(opponentHandCard.id),
    opponentHandCardIds: opponentHandCards.map((card) => String(card.id)),
    replayLocalCardLabel,
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
    submitCountInput: (action, cardId, value) => {
      overlayActions.push({
        kind: 'context',
        action,
        cardId: String(cardId),
        value,
      });
      runtime.emitLegacyOverlayAction({
        kind: 'context',
        action,
        cardId,
        value,
      });
    },
    submitShortcutCountInput: (action, value) => {
      const request: LegacyBoardShortcutActionRequest = { action, value };
      shortcutActions.push(request);
      runtime.emitLegacyShortcutAction(request);
    },
    submitCategoryChoice: (cardId, category) => {
      overlayActions.push({
        kind: 'context',
        action: 'changeCardType',
        cardId: String(cardId),
        category,
      });
      runtime.emitLegacyOverlayAction({
        kind: 'context',
        action: 'changeCardType',
        cardId,
        category,
      });
    },
    submitMoveChoice: (cardId, destination) => {
      overlayActions.push({
        kind: 'context',
        action: 'moveCard',
        cardId: String(cardId),
        destination,
      });
      runtime.emitLegacyOverlayAction({
        kind: 'context',
        action: 'moveCard',
        cardId,
        destination,
      });
    },
  };
  let darkMode = false;
  const renderOverlays = (): void => {
    const current = runtime.getBoardSnapshot();
    overlayRoot.render(
      current
        ? createElement(
            Fragment,
            null,
            createElement(LegacyBoardOverlays, {
              state: current,
              darkMode,
              actions: overlayCallbacks,
            }),
            createElement(LegacyBoardKeyboardShortcuts, {
              state: current,
              soloUndoEnabled: true,
              onRequest: (request) => {
                shortcutActions.push(request);
                runtime.emitLegacyShortcutAction(request);
              },
              onLocalIntent: (intent) => {
                runtime.emitBoardIntent(intent);
              },
              onDeclareMulligan: () => {
                runtime.declareMulligan();
              },
              onDeclareDeckView: () => {
                runtime.declareDeckView();
              },
              boardFlipEnabled: true,
              onFlipBoard: () => {
                boardFlips += 1;
                runtime.flipBoard();
              },
              onRefreshScene: () => {
                sceneRefreshes += 1;
                runtime.refreshScene();
              },
            })
          )
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
        shortcutRejections: [...shortcutRejections],
        shortcutActions: [...shortcutActions],
        mulliganDeclarations,
        deckViewDeclarations,
        boardFlips,
        sceneRefreshes,
        presentation: current.presentation,
        overlays: current.overlays,
        sourceKind: current.source?.kind ?? null,
        replayLocalZoneModes: {
          ...(current.replayLocalDisplay?.zoneModes ?? {}),
        },
        replayLocalCardModes: {
          ...(current.replayLocalDisplay?.cardModes ?? {}),
        },
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
      shortcutRejections.length = 0;
      shortcutActions.length = 0;
      mulliganDeclarations = 0;
      deckViewDeclarations = 0;
      boardFlips = 0;
      sceneRefreshes = 0;
      reportedErrors.length = 0;
    },
    setDarkMode: (enabled) => {
      requireSnapshot();
      darkMode = enabled;
      renderOverlays();
    },
    enterSoloReplay: () => {
      requireSnapshot();
      if (replayState.mode === 'replay') return;
      playbackGeneration += 1;
      publishReplay({
        generation: replayState.generation + 1,
        mode: 'replay',
        requestPhase: 'idle',
        sessionPhase: 'ready',
        canRequest: false,
        canExit: true,
        liveRevision: view.revision,
        view,
        playback: {
          phase: 'ready',
          generation: playbackGeneration,
          replayId: 'protected-solo-replay',
          frameIndex: 0,
          frameCount: 2,
          startRevision: view.revision,
          endRevision: view.revision + 1,
          truncated: view.revision > 0,
          view,
          atStart: true,
          atEnd: false,
          timelinePresentationEvents: [],
          enteredPresentationEvents: [],
          localDisclosure: replayLocalDisclosure,
        },
      });
    },
    advanceSoloReplay: () => {
      requireSnapshot();
      if (
        replayState.mode !== 'replay' ||
        replayState.playback.phase !== 'ready' ||
        replayState.playback.frameIndex !== 0
      ) {
        return;
      }
      playbackGeneration += 1;
      const nextView = { ...view, revision: view.revision + 1 };
      publishReplay({
        ...replayState,
        generation: replayState.generation + 1,
        view: nextView,
        playback: {
          phase: 'ready',
          generation: playbackGeneration,
          replayId: 'protected-solo-replay',
          frameIndex: 1,
          frameCount: 2,
          startRevision: view.revision,
          endRevision: view.revision + 1,
          truncated: view.revision > 0,
          view: nextView,
          atStart: false,
          atEnd: true,
          timelinePresentationEvents: [],
          enteredPresentationEvents: [],
          localDisclosure: replayLocalDisclosure,
        },
      });
    },
    seekSoloReplayStart: () => {
      requireSnapshot();
      if (
        replayState.mode !== 'replay' ||
        replayState.playback.phase !== 'ready' ||
        replayState.playback.frameIndex !== 1
      ) {
        return;
      }
      playbackGeneration += 1;
      publishReplay({
        ...replayState,
        generation: replayState.generation + 1,
        view,
        playback: {
          phase: 'ready',
          generation: playbackGeneration,
          replayId: 'protected-solo-replay',
          frameIndex: 0,
          frameCount: 2,
          startRevision: view.revision,
          endRevision: view.revision + 1,
          truncated: view.revision > 0,
          view,
          atStart: true,
          atEnd: false,
          timelinePresentationEvents: [],
          enteredPresentationEvents: [],
          localDisclosure: replayLocalDisclosure,
        },
      });
    },
    exitSoloReplay: () => {
      requireSnapshot();
      if (replayState.mode !== 'replay') return;
      playbackGeneration += 1;
      publishReplay({
        generation: replayState.generation + 1,
        mode: 'live',
        requestPhase: 'idle',
        sessionPhase: 'ready',
        canRequest: true,
        canExit: false,
        liveRevision: view.revision,
        view,
        playback: {
          phase: 'empty',
          generation: playbackGeneration,
        },
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeBoard();
      overlayRoot.unmount();
      runtime.dispose();
      replayListeners.clear();
      host.remove();
      if (window[HANDLE_NAME] === harness) delete window[HANDLE_NAME];
    },
  };
  window[HANDLE_NAME] = harness;
};
