import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  DEFAULT_BOARD_PRESENTATION,
  type BoardIntent,
  type BoardPresentation,
  type BoardPresentationUpdate,
  type BoardScene,
  type BoardSceneInstallMode,
} from '@ptcgsim/renderer-contract';
import type { ClientSessionPhase } from '@ptcgsim/client-session';

import {
  resolveBoardDrop,
  type BoardDropResolution,
} from './resolveBoardDrop.js';

export type BoardProjectionSource =
  | { readonly kind: 'live' }
  | {
      readonly kind: 'replay';
      readonly replayId: string;
      /** Monotonic generation published by ReplayPlaybackController. */
      readonly playbackGeneration: number;
      /** Accepted replay position used to distinguish advance from seek. */
      readonly frameIndex: number;
    };

export type BoardProjectionBoundary = 'advance' | 'resync' | 'seek';

/**
 * One already recipient-projected application publication. `frameToken` is a
 * caller-owned, globally monotonic token and is deliberately independent from
 * the match revision (reconnect and replay can replace an equal/older view).
 */
export interface BoardProjectionFrame {
  readonly frameToken: number;
  readonly source: BoardProjectionSource;
  readonly boundary: BoardProjectionBoundary;
  readonly sessionPhase: ClientSessionPhase;
  readonly view?: MatchViewState;
  /** Covers replay loading/discarding and any application-level submit gate. */
  readonly submissionsBlocked: boolean;
}

export type BoardPreviewState =
  | { readonly kind: 'card'; readonly cardId: ViewCardId }
  | {
      readonly kind: 'stack';
      readonly stackId: string;
      readonly focusCardId: ViewCardId;
    };

export interface BoardOverlayState {
  readonly contextMenuCardId: ViewCardId | null;
  readonly preview: BoardPreviewState | null;
}

export interface BoardFrameCursor {
  readonly frameToken: number;
  readonly source: BoardProjectionSource;
  readonly recipientKey?: string;
  readonly revision?: number;
}

export interface BoardSessionControllerState {
  /** Monotonic local snapshot generation for useSyncExternalStore consumers. */
  readonly generation: number;
  readonly sessionPhase: ClientSessionPhase;
  readonly source: BoardProjectionSource | null;
  readonly cursor: BoardFrameCursor | null;
  readonly view?: MatchViewState;
  readonly scene?: BoardScene;
  readonly sceneInstallMode: BoardSceneInstallMode;
  readonly presentation: BoardPresentation;
  readonly overlays: BoardOverlayState;
  readonly canSubmitCommands: boolean;
}

export type BoardSessionControllerAction =
  | { readonly kind: 'FrameReceived'; readonly frame: BoardProjectionFrame }
  | { readonly kind: 'RendererIntent'; readonly intent: BoardIntent }
  | {
      readonly kind: 'RendererPresentationUpdated';
      readonly update: BoardPresentationUpdate;
    }
  | { readonly kind: 'HoverChanged'; readonly cardId: ViewCardId | null }
  | {
      readonly kind: 'DismissLocalPresentation';
      readonly scope?: 'all' | 'selection' | 'context' | 'preview' | 'zone';
    }
  | { readonly kind: 'SubmissionRejected' };

export type BoardIntentRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | 'stale_card'
  | 'stale_zone'
  | 'unsupported_intent'
  | Exclude<BoardDropResolution, { readonly ok: true }>['reason'];

export type BoardSessionControllerEffect =
  | {
      readonly kind: 'InstallScene';
      readonly scene: BoardScene;
      readonly mode: BoardSceneInstallMode;
    }
  | {
      readonly kind: 'InstallPresentation';
      readonly presentation: BoardPresentation;
    }
  | {
      readonly kind: 'ResetRenderer';
      readonly reason: 'identity_changed' | 'terminal' | 'view_unavailable';
    }
  | {
      readonly kind: 'CancelRendererInteraction';
      readonly reason: 'session_not_ready';
    }
  | { readonly kind: 'SubmitCommand'; readonly command: WireGameCommand }
  | {
      readonly kind: 'IntentRejected';
      readonly intent: BoardIntent;
      readonly reason: BoardIntentRejectionReason;
    };

export interface BoardSessionControllerReduction {
  readonly state: BoardSessionControllerState;
  /** One-shot work from this accepted action; it is never retained in state. */
  readonly effects: readonly BoardSessionControllerEffect[];
  readonly outcome: 'accepted' | 'ignored' | 'rejected';
}

export interface BoardSessionControllerDependencies {
  /** Must derive a scene exclusively from the supplied recipient-safe view. */
  readonly createScene: (view: MatchViewState) => BoardScene;
  readonly resolveDrop?: typeof resolveBoardDrop;
}

export interface BoardSessionControllerOptions {
  /** Must derive a scene exclusively from the supplied recipient-safe view. */
  readonly createScene: (view: MatchViewState) => BoardScene;
  /** Executed serially before subscribers observe the corresponding state. */
  readonly emitEffect: (effect: BoardSessionControllerEffect) => void;
  readonly reportEffectFailure?: (
    error: unknown,
    effect: BoardSessionControllerEffect
  ) => void;
}

const EMPTY_OVERLAYS: BoardOverlayState = {
  contextMenuCardId: null,
  preview: null,
};

export const createInitialBoardSessionControllerState =
  (): BoardSessionControllerState => ({
    generation: 0,
    sessionPhase: 'idle',
    source: null,
    cursor: null,
    sceneInstallMode: 'advance',
    presentation: DEFAULT_BOARD_PRESENTATION,
    overlays: EMPTY_OVERLAYS,
    canSubmitCommands: false,
  });

const nextState = (
  state: BoardSessionControllerState,
  patch: Omit<Partial<BoardSessionControllerState>, 'generation'>
): BoardSessionControllerState => ({
  ...state,
  ...patch,
  generation: state.generation + 1,
});

const ignored = (
  state: BoardSessionControllerState
): BoardSessionControllerReduction => ({
  state,
  effects: [],
  outcome: 'ignored',
});

const rejected = (
  state: BoardSessionControllerState
): BoardSessionControllerReduction => ({
  state,
  effects: [],
  outcome: 'rejected',
});

const accepted = (
  state: BoardSessionControllerState,
  effects: readonly BoardSessionControllerEffect[] = []
): BoardSessionControllerReduction => ({ state, effects, outcome: 'accepted' });

const validCounter = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const validFrameHeader = (frame: BoardProjectionFrame): boolean => {
  if (!frame.source || typeof frame.source !== 'object') return false;
  if (
    !validCounter(frame.frameToken) ||
    !['advance', 'resync', 'seek'].includes(frame.boundary) ||
    ![
      'idle',
      'connecting',
      'handshaking',
      'ready',
      'reconnecting',
      'superseded',
      'closed',
      'failed',
    ].includes(frame.sessionPhase) ||
    typeof frame.submissionsBlocked !== 'boolean'
  ) {
    return false;
  }
  if (frame.source.kind === 'live') return frame.boundary !== 'seek';
  if (frame.source.kind !== 'replay') return false;
  return (
    typeof frame.source.replayId === 'string' &&
    frame.source.replayId.length > 0 &&
    frame.source.replayId.length <= 128 &&
    validCounter(frame.source.playbackGeneration) &&
    validCounter(frame.source.frameIndex)
  );
};

const viewerKey = (view: MatchViewState): string =>
  view.viewer.kind === 'player'
    ? `player:${view.viewer.playerId}`
    : 'spectator';

const recipientKey = (view: MatchViewState): string =>
  JSON.stringify([view.matchId, viewerKey(view)]);

const sameSourceTimeline = (
  left: BoardProjectionSource,
  right: BoardProjectionSource
): boolean =>
  left.kind === right.kind &&
  (left.kind === 'live' ||
    (right.kind === 'replay' && left.replayId === right.replayId));

const terminalPhase = (phase: ClientSessionPhase): boolean =>
  phase === 'closed' || phase === 'failed' || phase === 'superseded';

const keepsLastSafeView = (phase: ClientSessionPhase): boolean =>
  phase === 'connecting' || phase === 'handshaking' || phase === 'reconnecting';

const emptyPresentation = (): BoardPresentation => ({
  ...DEFAULT_BOARD_PRESENTATION,
});

const emptyOverlays = (): BoardOverlayState => ({ ...EMPTY_OVERLAYS });

const presentationIsEmpty = (presentation: BoardPresentation): boolean =>
  presentation.selectedCardId === null &&
  presentation.hoveredCardId === null &&
  presentation.drag === null &&
  presentation.openedZoneId === null;

const overlaysAreEmpty = (overlays: BoardOverlayState): boolean =>
  overlays.contextMenuCardId === null && overlays.preview === null;

const clearLocalPresentation = (
  state: BoardSessionControllerState
): Pick<BoardSessionControllerState, 'presentation' | 'overlays'> => ({
  presentation: presentationIsEmpty(state.presentation)
    ? state.presentation
    : emptyPresentation(),
  overlays: overlaysAreEmpty(state.overlays) ? state.overlays : emptyOverlays(),
});

const hasCard = (scene: BoardScene, cardId: ViewCardId): boolean =>
  scene.cards.some((card) => card.id === cardId && card.interactive);

const hasDropTarget = (view: MatchViewState, scene: BoardScene, id: string) =>
  Boolean(
    scene.zones.some((zone) => zone.id === id && zone.interactive) ||
    (view.stacks[id] &&
      scene.cards.some((card) => card.parentId === id && card.interactive))
  );

const reconcilePresentation = (
  state: BoardSessionControllerState,
  view: MatchViewState,
  scene: BoardScene
): Pick<BoardSessionControllerState, 'presentation' | 'overlays'> => {
  const selectedCardId =
    state.presentation.selectedCardId &&
    hasCard(scene, state.presentation.selectedCardId)
      ? state.presentation.selectedCardId
      : null;
  const hoveredCardId =
    state.presentation.hoveredCardId &&
    hasCard(scene, state.presentation.hoveredCardId)
      ? state.presentation.hoveredCardId
      : null;
  const drag = state.presentation.drag;
  const reconciledDrag =
    drag &&
    hasCard(scene, drag.cardId) &&
    (drag.targetId === null || hasDropTarget(view, scene, drag.targetId))
      ? drag
      : null;
  const openedZoneId =
    state.presentation.openedZoneId &&
    scene.zones.some(
      (zone) => zone.id === state.presentation.openedZoneId && zone.interactive
    )
      ? state.presentation.openedZoneId
      : null;
  const contextMenuCardId =
    state.overlays.contextMenuCardId &&
    hasCard(scene, state.overlays.contextMenuCardId)
      ? state.overlays.contextMenuCardId
      : null;
  const preview = state.overlays.preview;
  const reconciledPreview =
    preview?.kind === 'card'
      ? hasCard(scene, preview.cardId)
        ? preview
        : null
      : preview?.kind === 'stack'
        ? view.stacks[preview.stackId] &&
          scene.cards.some(
            (card) =>
              card.id === preview.focusCardId &&
              card.parentId === preview.stackId &&
              card.interactive
          )
          ? preview
          : null
        : null;
  return {
    presentation: {
      selectedCardId,
      hoveredCardId,
      drag: reconciledDrag,
      openedZoneId,
    },
    overlays: {
      contextMenuCardId,
      preview: reconciledPreview,
    },
  };
};

const publicCardIds = (view: MatchViewState): ReadonlySet<ViewCardId> => {
  const ids = new Set<ViewCardId>();
  for (const zone of Object.values(view.zones)) {
    for (const card of zone.cards) ids.add(card.id);
  }
  for (const stack of Object.values(view.stacks)) {
    for (const card of stack.evolutionCards) ids.add(card.id);
    for (const card of stack.attachmentCards) ids.add(card.id);
  }
  for (const workArea of Object.values(view.workAreas)) {
    if (workArea.inspection) {
      for (const card of workArea.inspection.cards) ids.add(card.id);
    }
    if (workArea.attachmentResolution) {
      for (const card of workArea.attachmentResolution.evolutionCards)
        ids.add(card.id);
      for (const card of workArea.attachmentResolution.attachmentCards)
        ids.add(card.id);
    }
  }
  return ids;
};

const sceneMatchesProjection = (
  view: MatchViewState,
  scene: BoardScene
): boolean => {
  if (scene.matchId !== view.matchId || scene.revision !== view.revision)
    return false;
  const aliases = publicCardIds(view);
  return (
    scene.cards.every((card) => aliases.has(card.id)) &&
    scene.markers.every((marker) => aliases.has(marker.parentCardId))
  );
};

const canSubmit = (frame: BoardProjectionFrame): boolean =>
  frame.source.kind === 'live' &&
  frame.sessionPhase === 'ready' &&
  !frame.submissionsBlocked &&
  frame.view?.viewer.kind === 'player';

const cursorFor = (
  frame: BoardProjectionFrame,
  view: MatchViewState | undefined
): BoardFrameCursor => ({
  frameToken: frame.frameToken,
  source: frame.source,
  ...(view
    ? { recipientKey: recipientKey(view), revision: view.revision }
    : {}),
});

const samePresentation = (
  left: BoardPresentation,
  right: BoardPresentation
): boolean =>
  left.selectedCardId === right.selectedCardId &&
  left.hoveredCardId === right.hoveredCardId &&
  left.drag === right.drag &&
  left.openedZoneId === right.openedZoneId;

const installFrame = (
  state: BoardSessionControllerState,
  frame: BoardProjectionFrame,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  if (!validFrameHeader(frame)) return rejected(state);
  const cursor = state.cursor;
  if (cursor && frame.frameToken <= cursor.frameToken) return ignored(state);

  const sameTimeline =
    cursor !== null && sameSourceTimeline(cursor.source, frame.source);
  if (
    sameTimeline &&
    cursor?.source.kind === 'replay' &&
    frame.source.kind === 'replay' &&
    frame.source.playbackGeneration < cursor.source.playbackGeneration
  ) {
    return ignored(state);
  }
  if (
    sameTimeline &&
    cursor?.source.kind === 'replay' &&
    frame.source.kind === 'replay' &&
    ((frame.boundary === 'advance' &&
      (frame.source.frameIndex < cursor.source.frameIndex ||
        (frame.source.playbackGeneration > cursor.source.playbackGeneration &&
          frame.source.frameIndex === cursor.source.frameIndex))) ||
      (frame.boundary === 'seek' &&
        frame.source.frameIndex >= cursor.source.frameIndex))
  ) {
    return rejected(state);
  }
  const previousView = state.view;
  const previousRevision = cursor?.revision ?? previousView?.revision;

  if (terminalPhase(frame.sessionPhase)) {
    const previousCursorIdentity = cursor
      ? {
          ...(cursor.recipientKey ? { recipientKey: cursor.recipientKey } : {}),
          ...(cursor.revision !== undefined
            ? { revision: cursor.revision }
            : {}),
        }
      : {};
    const next = nextState(state, {
      sessionPhase: frame.sessionPhase,
      source: frame.source,
      cursor: {
        ...cursorFor(frame, undefined),
        ...previousCursorIdentity,
      },
      view: undefined,
      scene: undefined,
      sceneInstallMode: 'replace',
      ...clearLocalPresentation(state),
      canSubmitCommands: false,
    });
    return accepted(
      next,
      state.scene ? [{ kind: 'ResetRenderer', reason: 'terminal' }] : []
    );
  }

  // A terminal route cannot be revived by a later callback. Rejoin creates a
  // fresh route owner and therefore a fresh controller.
  if (terminalPhase(state.sessionPhase)) return rejected(state);

  if (!frame.view) {
    if (state.source && !sameSourceTimeline(state.source, frame.source)) {
      return rejected(state);
    }
    if (keepsLastSafeView(frame.sessionPhase) && previousView && state.scene) {
      const local = clearLocalPresentation(state);
      const presentationChanged = !samePresentation(
        state.presentation,
        local.presentation
      );
      const next = nextState(state, {
        sessionPhase: frame.sessionPhase,
        source: state.source ?? frame.source,
        cursor: {
          ...(cursor ?? cursorFor(frame, previousView)),
          frameToken: frame.frameToken,
          recipientKey: cursor?.recipientKey ?? recipientKey(previousView),
        },
        ...local,
        sceneInstallMode: 'replace',
        canSubmitCommands: false,
      });
      const effects: BoardSessionControllerEffect[] = [
        {
          kind: 'CancelRendererInteraction',
          reason: 'session_not_ready',
        },
      ];
      if (presentationChanged) {
        effects.push({
          kind: 'InstallPresentation',
          presentation: next.presentation,
        });
      }
      return accepted(next, effects);
    }
    const next = nextState(state, {
      sessionPhase: frame.sessionPhase,
      source: state.source ?? frame.source,
      cursor: {
        ...(cursor ?? cursorFor(frame, undefined)),
        frameToken: frame.frameToken,
        ...(cursor?.recipientKey ? { recipientKey: cursor.recipientKey } : {}),
        ...(cursor?.revision !== undefined
          ? { revision: cursor.revision }
          : {}),
      },
      view: undefined,
      scene: undefined,
      sceneInstallMode: 'replace',
      ...clearLocalPresentation(state),
      canSubmitCommands: false,
    });
    return accepted(
      next,
      state.scene ? [{ kind: 'ResetRenderer', reason: 'view_unavailable' }] : []
    );
  }

  if (
    sameTimeline &&
    cursor?.source.kind === 'replay' &&
    frame.source.kind === 'replay' &&
    previousRevision !== undefined &&
    frame.view.revision - frame.source.frameIndex !==
      previousRevision - cursor.source.frameIndex
  ) {
    return rejected(state);
  }

  const nextRecipientKey = recipientKey(frame.view);
  const recipientChanged =
    cursor?.recipientKey !== undefined &&
    cursor.recipientKey !== nextRecipientKey;
  const timelineChanged = cursor !== null && !sameTimeline;
  const revisionWentBackward =
    previousRevision !== undefined && frame.view.revision < previousRevision;
  const replayGenerationChanged =
    cursor?.source.kind === 'replay' &&
    frame.source.kind === 'replay' &&
    frame.source.playbackGeneration > cursor.source.playbackGeneration;
  const replacementBoundary =
    frame.boundary === 'resync' || frame.boundary === 'seek';
  const phaseOnlyPublication =
    sameTimeline &&
    frame.boundary === 'advance' &&
    frame.view === previousView &&
    frame.view.revision === previousRevision &&
    (frame.source.kind === 'live' || !replayGenerationChanged);

  if ((recipientChanged || timelineChanged) && frame.boundary !== 'resync') {
    return rejected(state);
  }
  if (phaseOnlyPublication && frame.sessionPhase !== state.sessionPhase) {
    const local =
      frame.sessionPhase === 'ready'
        ? {
            presentation: state.presentation,
            overlays: state.overlays,
          }
        : clearLocalPresentation(state);
    const presentationChanged = !samePresentation(
      state.presentation,
      local.presentation
    );
    const next = nextState(state, {
      sessionPhase: frame.sessionPhase,
      source: frame.source,
      cursor: cursorFor(frame, frame.view),
      ...local,
      canSubmitCommands: canSubmit(frame),
    });
    const effects: BoardSessionControllerEffect[] = [];
    if (state.sessionPhase === 'ready' && frame.sessionPhase !== 'ready') {
      effects.push({
        kind: 'CancelRendererInteraction',
        reason: 'session_not_ready',
      });
    }
    if (presentationChanged) {
      effects.push({
        kind: 'InstallPresentation',
        presentation: next.presentation,
      });
    }
    return accepted(next, effects);
  }
  if (sameTimeline && frame.source.kind === 'live' && revisionWentBackward) {
    return rejected(state);
  }
  if (
    sameTimeline &&
    frame.source.kind === 'replay' &&
    previousRevision !== undefined &&
    frame.boundary === 'advance' &&
    (!replayGenerationChanged || frame.view.revision <= previousRevision)
  ) {
    return rejected(state);
  }
  if (
    sameTimeline &&
    frame.source.kind === 'replay' &&
    frame.boundary === 'seek' &&
    !replayGenerationChanged
  ) {
    return rejected(state);
  }
  if (
    sameTimeline &&
    frame.source.kind === 'replay' &&
    frame.boundary === 'resync' &&
    !replayGenerationChanged
  ) {
    return rejected(state);
  }
  if (
    sameTimeline &&
    previousRevision !== undefined &&
    frame.view.revision === previousRevision &&
    frame.view !== previousView &&
    !replacementBoundary
  ) {
    return rejected(state);
  }

  const duplicateProjection =
    frame.view === previousView &&
    cursor?.recipientKey === nextRecipientKey &&
    frame.view.revision === previousRevision &&
    frame.sessionPhase === state.sessionPhase;
  if (
    duplicateProjection &&
    frame.boundary === 'advance' &&
    (frame.source.kind === 'live' || !replayGenerationChanged)
  ) {
    return accepted(
      nextState(state, {
        source: frame.source,
        cursor: cursorFor(frame, frame.view),
        canSubmitCommands: canSubmit(frame),
      })
    );
  }

  const resetsRenderer =
    cursor !== null &&
    (recipientChanged || timelineChanged || replacementBoundary);

  let scene: BoardScene;
  try {
    scene = dependencies.createScene(frame.view);
  } catch {
    return rejected(state);
  }
  if (!sceneMatchesProjection(frame.view, scene)) return rejected(state);

  const mustClearLocal =
    cursor === null ||
    recipientChanged ||
    timelineChanged ||
    replacementBoundary ||
    frame.sessionPhase !== 'ready';
  const local = mustClearLocal
    ? clearLocalPresentation(state)
    : reconcilePresentation(state, frame.view, scene);
  const installMode: BoardSceneInstallMode =
    mustClearLocal ||
    previousRevision === undefined ||
    frame.view.revision <= previousRevision
      ? 'replace'
      : 'advance';
  const next = nextState(state, {
    sessionPhase: frame.sessionPhase,
    source: frame.source,
    cursor: cursorFor(frame, frame.view),
    view: frame.view,
    scene,
    sceneInstallMode: installMode,
    ...local,
    canSubmitCommands: canSubmit(frame),
  });
  const effects: BoardSessionControllerEffect[] = [];
  if (resetsRenderer) {
    effects.push({ kind: 'ResetRenderer', reason: 'identity_changed' });
  }
  effects.push({ kind: 'InstallScene', scene, mode: installMode });
  if (!samePresentation(state.presentation, next.presentation)) {
    effects.push({
      kind: 'InstallPresentation',
      presentation: next.presentation,
    });
  }
  return accepted(next, effects);
};

const rejectIntent = (
  state: BoardSessionControllerState,
  intent: BoardIntent,
  reason: BoardIntentRejectionReason
): BoardSessionControllerReduction =>
  accepted(state, [{ kind: 'IntentRejected', intent, reason }]);

const installPresentation = (
  state: BoardSessionControllerState,
  presentation: BoardPresentation,
  overlays: BoardOverlayState = state.overlays
): BoardSessionControllerReduction => {
  if (
    samePresentation(state.presentation, presentation) &&
    overlays === state.overlays
  ) {
    return ignored(state);
  }
  const next = nextState(state, { presentation, overlays });
  return accepted(next, [
    { kind: 'InstallPresentation', presentation: next.presentation },
  ]);
};

const handleIntent = (
  state: BoardSessionControllerState,
  intent: BoardIntent,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  const view = state.view;
  const scene = state.scene;
  if (!view || !scene) return rejectIntent(state, intent, 'no_installed_view');

  switch (intent.kind) {
    case 'CardSelected': {
      const card = scene.cards.find(
        (candidate) => candidate.id === intent.cardId && candidate.interactive
      );
      if (!card) return rejectIntent(state, intent, 'stale_card');
      const retainOpenedZone =
        state.presentation.openedZoneId === card.parentId
          ? state.presentation.openedZoneId
          : null;
      return installPresentation(
        state,
        {
          ...state.presentation,
          selectedCardId: intent.cardId,
          drag: null,
          openedZoneId: retainOpenedZone,
        },
        emptyOverlays()
      );
    }
    case 'CardContextRequested': {
      if (!hasCard(scene, intent.cardId))
        return rejectIntent(state, intent, 'stale_card');
      if (view.viewer.kind === 'spectator')
        return rejectIntent(state, intent, 'read_only');
      const next = nextState(state, {
        presentation: {
          ...state.presentation,
          selectedCardId: null,
          drag: null,
        },
        overlays: {
          contextMenuCardId: intent.cardId,
          preview: null,
        },
      });
      return accepted(next, [
        { kind: 'InstallPresentation', presentation: next.presentation },
      ]);
    }
    case 'CardPreviewRequested': {
      const card = scene.cards.find(
        (candidate) => candidate.id === intent.cardId && candidate.interactive
      );
      if (!card) return rejectIntent(state, intent, 'stale_card');
      const preview: BoardPreviewState = view.stacks[card.parentId]
        ? {
            kind: 'stack',
            stackId: card.parentId,
            focusCardId: intent.cardId,
          }
        : { kind: 'card', cardId: intent.cardId };
      const next = nextState(state, {
        presentation: {
          ...state.presentation,
          selectedCardId: null,
          drag: null,
        },
        overlays: { contextMenuCardId: null, preview },
      });
      return accepted(next, [
        { kind: 'InstallPresentation', presentation: next.presentation },
      ]);
    }
    case 'ZoneOpened': {
      if (
        !scene.zones.some(
          (zone) => zone.id === intent.zoneId && zone.interactive
        )
      ) {
        return rejectIntent(state, intent, 'stale_zone');
      }
      return installPresentation(state, {
        ...state.presentation,
        openedZoneId: intent.zoneId,
      });
    }
    case 'CardDropRequested': {
      if (state.sessionPhase !== 'ready')
        return rejectIntent(state, intent, 'not_ready');
      if (!state.canSubmitCommands)
        return rejectIntent(state, intent, 'read_only');
      // Capture one installed pair before invoking a resolver supplied by the
      // application. It can never mix a new view with an old scene.
      const installedView = view;
      const installedScene = scene;
      const resolution = (dependencies.resolveDrop ?? resolveBoardDrop)(
        installedView,
        installedScene,
        intent
      );
      if (!resolution.ok) return rejectIntent(state, intent, resolution.reason);
      const presentation = state.presentation.drag
        ? { ...state.presentation, drag: null }
        : state.presentation;
      const next =
        presentation === state.presentation
          ? state
          : nextState(state, { presentation });
      return accepted(next, [
        ...(presentation === state.presentation
          ? []
          : ([
              { kind: 'InstallPresentation', presentation },
            ] satisfies BoardSessionControllerEffect[])),
        { kind: 'SubmitCommand', command: resolution.command },
      ]);
    }
    case 'BoardResizeRequested':
      return rejectIntent(state, intent, 'unsupported_intent');
  }
};

const handlePresentationUpdate = (
  state: BoardSessionControllerState,
  update: BoardPresentationUpdate
): BoardSessionControllerReduction => {
  if (!state.scene) return ignored(state);
  if (update.kind === 'DragChanged') {
    const drag = update.drag;
    if (
      drag &&
      (!hasCard(state.scene, drag.cardId) ||
        (drag.targetId !== null &&
          (!state.view ||
            !hasDropTarget(state.view, state.scene, drag.targetId))))
    ) {
      return ignored(state);
    }
    return installPresentation(state, {
      ...state.presentation,
      drag,
      ...(drag ? { selectedCardId: null } : {}),
    });
  }
  return ignored(state);
};

const dismissPresentation = (
  state: BoardSessionControllerState,
  scope: NonNullable<
    Extract<
      BoardSessionControllerAction,
      { readonly kind: 'DismissLocalPresentation' }
    >['scope']
  >
): BoardSessionControllerReduction => {
  const presentation: BoardPresentation = {
    ...state.presentation,
    ...(scope === 'all' || scope === 'selection'
      ? { selectedCardId: null }
      : {}),
    ...(scope === 'all' || scope === 'zone' ? { openedZoneId: null } : {}),
    ...(scope === 'all' ? { hoveredCardId: null, drag: null } : {}),
  };
  const overlays: BoardOverlayState = {
    contextMenuCardId:
      scope === 'all' || scope === 'context'
        ? null
        : state.overlays.contextMenuCardId,
    preview:
      scope === 'all' || scope === 'preview' ? null : state.overlays.preview,
  };
  return installPresentation(state, presentation, overlays);
};

export const reduceBoardSessionController = (
  state: BoardSessionControllerState,
  action: BoardSessionControllerAction,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  switch (action.kind) {
    case 'FrameReceived':
      return installFrame(state, action.frame, dependencies);
    case 'RendererIntent':
      return handleIntent(state, action.intent, dependencies);
    case 'RendererPresentationUpdated':
      return handlePresentationUpdate(state, action.update);
    case 'HoverChanged': {
      if (
        action.cardId !== null &&
        (!state.scene || !hasCard(state.scene, action.cardId))
      ) {
        return ignored(state);
      }
      return installPresentation(state, {
        ...state.presentation,
        hoveredCardId: action.cardId,
      });
    }
    case 'DismissLocalPresentation':
      return dismissPresentation(state, action.scope ?? 'all');
    case 'SubmissionRejected':
      return installPresentation(state, {
        ...state.presentation,
        drag: null,
      });
  }
};

/** Headless external store with serialized, non-retained effect delivery. */
export class BoardSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly queue: BoardSessionControllerAction[] = [];
  private state = createInitialBoardSessionControllerState();
  private dispatching = false;
  private disposed = false;

  constructor(private readonly options: BoardSessionControllerOptions) {}

  getSnapshot = (): BoardSessionControllerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(action: BoardSessionControllerAction): boolean {
    if (this.disposed) return false;
    this.queue.push(action);
    if (this.dispatching) return true;
    this.dispatching = true;
    try {
      while (!this.disposed) {
        const queued = this.queue.shift();
        if (!queued) break;
        const result = reduceBoardSessionController(
          this.state,
          queued,
          this.options
        );
        const changed = result.state !== this.state;
        if (changed) this.state = result.state;
        for (const effect of result.effects) {
          if (this.disposed) break;
          try {
            this.options.emitEffect(effect);
          } catch (error) {
            try {
              this.options.reportEffectFailure?.(error, effect);
            } catch {
              // Diagnostics must not interrupt later deterministic effects.
            }
          }
        }
        if (this.disposed) break;
        if (changed) {
          for (const listener of [...this.listeners]) listener();
        }
      }
    } finally {
      this.dispatching = false;
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this.state = {
      ...createInitialBoardSessionControllerState(),
      generation: this.state.generation + 1,
    };
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}
