import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import type {
  ClientSessionPhase,
  ReadyReplayPlaybackState,
} from '@ptcgsim/client-session';
import {
  cardSelectionModeOf,
  carriedGroup,
  DEFAULT_BOARD_PRESENTATION,
  groupArrivalWidth,
  NO_SELECTION,
  sameSelection,
  selectedCardIdOf,
  type BoardIntent,
  type BoardPresentation,
  type BoardPresentationUpdate,
  type BoardScene,
  type BoardSceneInstallMode,
  type BoardSceneMotion,
  type MarkerSceneNode,
  type SettlingCard,
} from '@ptcgsim/renderer-contract';
import {
  compileGroup,
  type GroupAction,
  type GroupCompilation,
  type GroupRefusalReason,
} from './compile-group.js';
import {
  resolveBoardDrop,
  type BoardDropResolution,
} from './resolveBoardDrop.js';
import {
  applyReplayLocalDisclosure,
  isReplayLocalDisclosureAction,
  reconcileReplayLocalDisplayState,
  toggleReplayLocalDisclosure,
  type ReplayLocalDisplayState,
} from './replayLocalDisclosure.js';
import { actingPlayerIdOf } from './acting-seat.js';
import {
  resolveLegacyBoardOverlayAction,
  type LegacyBoardOverlayInput,
  type LegacyBoardOverlayActionRejectionReason,
  type LegacyBoardOverlayActionRequest,
} from './resolveLegacyBoardOverlayAction.js';
import { isLegacyBoardCountActionId } from './resolveLegacyBoardCountAction.js';
import {
  resolveOncePerGameAction,
  type OncePerGameAction,
  type OncePerGameActionResolution,
} from './resolveOncePerGameAction.js';
import {
  isLegacyOwnHandShortcutAction,
  resolveLegacyBoardShortcutAction,
  type LegacyBoardShortcutActionRejectionReason,
  type LegacyBoardShortcutActionRequest,
  type LegacyBoardShortcutCountPrompt,
} from './resolveLegacyBoardShortcutAction.js';
import {
  resolveAttachEvolveTarget,
  type AttachEvolveTargetingRejectionReason,
  type BoardPlayTargetingState,
} from './resolveAttachEvolveTargeting.js';
import {
  normalizeSelection,
  reduceSelection,
  type SelectionContext,
} from './selection.js';

type ReplayLocalDisclosureState = NonNullable<
  ReadyReplayPlaybackState['localDisclosure']
>;

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

export type BoardProjectionBoundary = 'advance' | 'refresh' | 'resync' | 'seek';

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
  readonly replayLocalDisclosure?: ReplayLocalDisclosureState;
  /** Covers replay loading/discarding and any application-level submit gate. */
  readonly submissionsBlocked: boolean;
  /**
   * Live session commands still in flight. A settling card is released as
   * soon as its command leaves this list, which is the same moment the
   * session has either published the accepted move or recorded a rejection.
   */
  readonly pendingCommandIds?: readonly string[];
  /**
   * Set by the source when a same-revision frame comes from this client's own
   * queue: a prediction just shown (`predict`) or one the room refused and
   * the frame withdraws (`rollback`).
   */
  readonly motionHint?: 'predict' | 'rollback';
}

export type BoardPreviewState =
  | { readonly kind: 'card'; readonly cardId: ViewCardId }
  | {
      readonly kind: 'stack';
      readonly stackId: string;
      readonly focusCardId: ViewCardId;
    };

/**
 * Where an action comes from. The command palette names its card, pile and
 * value outright (ADR-035): it does not need the card selected, its menu or
 * pile open, or a prompt open, as a press or a key does. Everything else --
 * the card on the table, the seat, the value -- is checked as usual.
 */
export type BoardActionOrigin = 'palette';

/** A counter or chip on a card whose controls are open (MarkerControls). */
export interface BoardMarkerControlsState {
  /** The card it lies on: the top of a Pokémon, or a single card. */
  readonly cardId: ViewCardId;
  readonly kind: MarkerSceneNode['kind'];
  /**
   * Opened from a card's menu, which may be worked from the keyboard: the
   * controls take the focus, and give it back when they close.
   */
  readonly takesFocus?: true;
}

export interface BoardOverlayState {
  readonly contextMenuCardId: ViewCardId | null;
  readonly preview: BoardPreviewState | null;
  readonly input:
    LegacyBoardOverlayInput | LegacyBoardShortcutCountPrompt | null;
  /** Absent or null when no marker's controls are open. */
  readonly marker?: BoardMarkerControlsState | null;
}

export type BoardPresentationDismissScope =
  'all' | 'selection' | 'context' | 'preview' | 'zone' | 'input' | 'marker';

export type OpenedZoneCardIntent =
  | Extract<BoardIntent, { readonly kind: 'CardSelected' }>
  | Extract<BoardIntent, { readonly kind: 'CardDropRequested' }>
  | Extract<BoardIntent, { readonly kind: 'CardContextRequested' }>
  | Extract<BoardIntent, { readonly kind: 'CardPreviewRequested' }>;

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
  readonly replayLocalDisplay?: ReplayLocalDisplayState;
  readonly scene?: BoardScene;
  readonly sceneInstallMode: BoardSceneInstallMode;
  readonly presentation: BoardPresentation;
  readonly playTargeting: BoardTargetingState | null;
  readonly overlays: BoardOverlayState;
  readonly canSubmitCommands: boolean;
  /**
   * Groups moved and not yet answered: the selection each took, given back
   * if the room refuses the move (ADR-042 §1). The newest is unbound until
   * the adapter queues its command.
   */
  readonly groupSubmissions?: readonly GroupSubmission[];
  /**
   * A refused group's selection, given back once the table shows the cards
   * where they were again (the prediction withdrawn), with touch's
   * selection mode if it was on.
   */
  readonly selectionRestore?: SelectionRestore | null;
}

/** A selection to give back, and whether touch's selection mode was on. */
export interface SelectionRestore {
  readonly cardIds: readonly ViewCardId[];
  readonly selectionMode: boolean;
  /** The pile it was picked in, open then (a pile's cards are items there). */
  readonly openedZoneId?: string;
}

/** A group's move in flight, and the selection it took. */
export interface GroupSubmission {
  readonly commandId: string | null;
  readonly cardIds: readonly ViewCardId[];
  /** Touch's selection mode was on when it went: a refusal turns it back on. */
  readonly selectionMode?: boolean;
  /**
   * The pile viewer open when it went: a group that emptied the pile closes
   * it, and a refusal opens it again for its cards, unless the player put
   * it away (DismissLocalPresentation) meanwhile.
   */
  readonly openedZoneId?: string;
  /** Its outcome is shown on the table, so a refusal withdraws it first. */
  readonly predicted?: boolean;
}

/**
 * `q`/`e` with several selected: the Pokémon every one of them can go on,
 * lit for the player to pick (ADR-042 §3).
 */
export interface GroupPlayTargetingState {
  readonly kind: 'group';
  readonly cardIds: readonly ViewCardId[];
  readonly targets: readonly {
    readonly stackId: string;
    readonly topCardId: ViewCardId;
  }[];
}

export type BoardTargetingState =
  BoardPlayTargetingState | GroupPlayTargetingState;

export type BoardSessionControllerAction =
  | { readonly kind: 'FrameReceived'; readonly frame: BoardProjectionFrame }
  | {
      readonly kind: 'RefreshScene';
      /** A plain relayout snaps; a flip turns the table. */
      readonly cause?: 'layout' | 'flip';
    }
  | { readonly kind: 'RendererIntent'; readonly intent: BoardIntent }
  | {
      readonly kind: 'OpenedZoneCardIntent';
      readonly intent: OpenedZoneCardIntent;
    }
  | {
      readonly kind: 'LegacyOverlayActionRequested';
      readonly request: LegacyBoardOverlayActionRequest;
      readonly origin?: BoardActionOrigin;
    }
  | {
      readonly kind: 'LegacyShortcutActionRequested';
      readonly request: LegacyBoardShortcutActionRequest;
      readonly origin?: BoardActionOrigin;
    }
  | {
      /** A group's move or annotation (ADR-042 §3), from its menu or a key. */
      readonly kind: 'GroupActionRequested';
      readonly action: GroupAction;
      readonly origin?: BoardActionOrigin;
    }
  | {
      readonly kind: 'OncePerGameActionRequested';
      readonly targetPlayerId: string;
      readonly action: OncePerGameAction;
    }
  | {
      readonly kind: 'RendererPresentationUpdated';
      readonly update: BoardPresentationUpdate;
    }
  | { readonly kind: 'HoverChanged'; readonly cardId: ViewCardId | null }
  | {
      readonly kind: 'DismissLocalPresentation';
      readonly scope?: BoardPresentationDismissScope;
    }
  | { readonly kind: 'SubmissionRejected' }
  /** The room refused a command this client queued (the adapter saw it go). */
  | { readonly kind: 'CommandRefused'; readonly commandId: string }
  /**
   * The adapter queued the command emitted by the newest accepted drop.
   * A predicted command already shows its outcome on the table, so its
   * drop hold is released rather than bound to the command.
   */
  | {
      readonly kind: 'SubmissionQueued';
      readonly commandId: string;
      readonly predicted?: boolean;
    };

export type BoardIntentRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | 'stale_card'
  | 'stale_zone'
  | 'unsupported_intent'
  | AttachEvolveTargetingRejectionReason
  | GroupRefusalReason
  | Exclude<BoardDropResolution, { readonly ok: true }>['reason'];

/**
 * Why a group's move or mark wasn't sent: the group's own reasons, a table
 * not ready for moves, or (`q`/`e`) no Pokémon that takes all of them.
 */
export type GroupActionRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | 'no_target'
  | GroupRefusalReason;

export type BoardOverlayActionRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | LegacyBoardOverlayActionRejectionReason;

export type BoardShortcutActionRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | 'stale_card'
  | 'stale_input'
  | LegacyBoardShortcutActionRejectionReason;

export type OncePerGameActionRejectionReason =
  | 'no_installed_view'
  | 'not_ready'
  | 'read_only'
  | Exclude<OncePerGameActionResolution, { readonly ok: true }>['reason'];

export type BoardSessionControllerEffect =
  | {
      readonly kind: 'InstallScene';
      readonly scene: BoardScene;
      readonly mode: BoardSceneInstallMode;
      /** Why the scene changed, so the renderer knows whether cards travel. */
      readonly motion: BoardSceneMotion;
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
      readonly reason: 'session_not_ready' | 'projection_config_changed';
    }
  | { readonly kind: 'SubmitCommand'; readonly command: WireGameCommand }
  | {
      readonly kind: 'OverlayActionRejected';
      readonly request: LegacyBoardOverlayActionRequest;
      readonly reason: BoardOverlayActionRejectionReason;
    }
  | {
      readonly kind: 'ShortcutActionRejected';
      readonly request: LegacyBoardShortcutActionRequest;
      readonly reason: BoardShortcutActionRejectionReason;
    }
  | {
      readonly kind: 'OncePerGameActionRejected';
      readonly targetPlayerId: string;
      readonly action: OncePerGameAction;
      readonly reason: OncePerGameActionRejectionReason;
    }
  | {
      readonly kind: 'IntentRejected';
      readonly intent: BoardIntent;
      readonly reason: BoardIntentRejectionReason;
    }
  | {
      readonly kind: 'GroupActionRejected';
      /** What was asked; null for `q`/`e`, which asks for a Pokémon first. */
      readonly action: GroupAction | null;
      readonly reason: GroupActionRejectionReason;
      /** The card it stopped at, and its name, when it is one card's. */
      readonly cardId?: ViewCardId;
      readonly cardName?: string;
      /** How many items the selection held. */
      readonly itemCount: number;
    };

export interface BoardSessionControllerReduction {
  readonly state: BoardSessionControllerState;
  /** One-shot work from this reduction; it is never retained in state. */
  readonly effects: readonly BoardSessionControllerEffect[];
  readonly outcome: 'accepted' | 'ignored' | 'rejected' | 'purged';
}

export interface BoardSessionControllerDependencies {
  /** Must derive a scene exclusively from the supplied recipient-safe view. */
  readonly createScene: (view: MatchViewState) => BoardScene;
  readonly resolveDrop?: typeof resolveBoardDrop;
  readonly resolveOverlayAction?: typeof resolveLegacyBoardOverlayAction;
  readonly resolveShortcutAction?: typeof resolveLegacyBoardShortcutAction;
  readonly resolveOncePerGameAction?: typeof resolveOncePerGameAction;
  readonly resolveAttachEvolveTarget?: typeof resolveAttachEvolveTarget;
  /**
   * Solo: the one player moves both seats' cards and works both seats'
   * windows, so a selection takes either seat's.
   */
  readonly controlsEverySeat?: () => boolean;
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
  /** Called each time the dispatch queue drains. */
  readonly onIdle?: () => void;
  readonly resolveDrop?: BoardSessionControllerDependencies['resolveDrop'];
  readonly controlsEverySeat?: BoardSessionControllerDependencies['controlsEverySeat'];
}

const EMPTY_OVERLAYS: BoardOverlayState = {
  contextMenuCardId: null,
  preview: null,
  input: null,
};

/** The open marker controls, as an overlay field only while they are open. */
const markerOverlay = (
  marker: BoardMarkerControlsState | null | undefined
): Pick<BoardOverlayState, 'marker'> => (marker ? { marker } : {});

export const createInitialBoardSessionControllerState =
  (): BoardSessionControllerState => ({
    generation: 0,
    sessionPhase: 'idle',
    source: null,
    cursor: null,
    sceneInstallMode: 'advance',
    presentation: DEFAULT_BOARD_PRESENTATION,
    playTargeting: null,
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

const purged = (
  state: BoardSessionControllerState,
  effects: readonly BoardSessionControllerEffect[]
): BoardSessionControllerReduction => ({ state, effects, outcome: 'purged' });

const validCounter = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const validFrameHeader = (frame: BoardProjectionFrame): boolean => {
  if (!frame.source || typeof frame.source !== 'object') return false;
  if (
    !validCounter(frame.frameToken) ||
    !['advance', 'refresh', 'resync', 'seek'].includes(frame.boundary) ||
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
  if (frame.source.kind === 'live') {
    return frame.boundary !== 'seek' && !frame.replayLocalDisclosure;
  }
  if (frame.source.kind !== 'replay') return false;
  return (
    frame.boundary !== 'refresh' &&
    typeof frame.source.replayId === 'string' &&
    frame.source.replayId.length > 0 &&
    frame.source.replayId.length <= 128 &&
    validCounter(frame.source.playbackGeneration) &&
    validCounter(frame.source.frameIndex) &&
    (!frame.replayLocalDisclosure || Boolean(frame.view))
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

/**
 * A settling card is created by an accepted drop before the adapter knows the
 * command id, so the newest entry stays unbound until `SubmissionQueued` (or
 * is dropped by `SubmissionRejected`). Bound entries live exactly as long as
 * their command is pending in the live session.
 */
interface SettlingEntry extends SettlingCard {
  readonly commandId: string | null;
}

const settlingEntries = (
  presentation: BoardPresentation
): readonly SettlingEntry[] =>
  presentation.settling as readonly SettlingEntry[];

const pruneSettling = (
  entries: readonly SettlingEntry[],
  scene: BoardScene | undefined,
  pendingCommandIds: readonly string[] | undefined
): readonly SettlingEntry[] => {
  const kept = entries.filter(
    (entry) =>
      (scene === undefined || hasCard(scene, entry.cardId)) &&
      (entry.commandId === null ||
        pendingCommandIds === undefined ||
        pendingCommandIds.includes(entry.commandId))
  );
  return kept.length === entries.length ? entries : kept;
};

/**
 * The newest drop not yet bound to its command: a group's cards together
 * (one `dropId`), or the one card a drop holds.
 */
const newestDrop = (
  entries: readonly SettlingEntry[]
): ((entry: SettlingEntry, index: number) => boolean) | null => {
  const newest = entries.findLastIndex((entry) => entry.commandId === null);
  if (newest < 0) return null;
  const dropId = entries[newest]!.dropId;
  return (entry, index) =>
    entry.commandId === null &&
    (dropId === undefined ? index === newest : entry.dropId === dropId);
};

const sameSettling = (
  left: readonly SettlingCard[],
  right: readonly SettlingCard[]
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => right[index] === entry);

const emptyOverlays = (): BoardOverlayState => ({ ...EMPTY_OVERLAYS });

const presentationIsEmpty = (presentation: BoardPresentation): boolean =>
  presentation.settling.length === 0 &&
  presentation.selection.length === 0 &&
  !presentation.selectionMode &&
  presentation.hoveredCardId === null &&
  presentation.targetableCardIds.length === 0 &&
  presentation.drag === null &&
  presentation.openedZoneId === null;

const overlaysAreEmpty = (overlays: BoardOverlayState): boolean =>
  overlays.contextMenuCardId === null &&
  overlays.preview === null &&
  overlays.input === null &&
  !overlays.marker;

const sameOverlays = (
  left: BoardOverlayState,
  right: BoardOverlayState
): boolean =>
  left.contextMenuCardId === right.contextMenuCardId &&
  left.preview === right.preview &&
  left.input === right.input &&
  (left.marker ?? null) === (right.marker ?? null);

/** The marker whose controls are open, while it still lies on its card. */
const openMarker = (
  scene: BoardScene,
  controls: BoardMarkerControlsState | null | undefined
): MarkerSceneNode | null =>
  controls
    ? (scene.markers.find(
        (marker) =>
          marker.parentCardId === controls.cardId &&
          marker.kind === controls.kind
      ) ?? null)
    : null;

/**
 * Whether a marker's controls stay open: while the marker lies on its card;
 * a Pokémon's damage controls, while it is in play with or without a counter
 * (they put the first one on, and stepping down to none leaves them open).
 */
const markerControlsStayOpen = (
  view: MatchViewState,
  scene: BoardScene,
  controls: BoardMarkerControlsState | null | undefined
): boolean =>
  openMarker(scene, controls) !== null ||
  (controls?.kind === 'damage' &&
    hasCard(scene, controls.cardId) &&
    Object.values(view.stacks).some(
      (stack) => stack.evolutionCards.at(-1)?.id === controls.cardId
    ));

const NO_GROUP_SUBMISSIONS: readonly GroupSubmission[] = Object.freeze([]);

const clearLocalPresentation = (
  state: BoardSessionControllerState
): Pick<
  BoardSessionControllerState,
  | 'presentation'
  | 'playTargeting'
  | 'overlays'
  | 'groupSubmissions'
  | 'selectionRestore'
> => ({
  presentation: presentationIsEmpty(state.presentation)
    ? state.presentation
    : emptyPresentation(),
  playTargeting: null,
  overlays: overlaysAreEmpty(state.overlays) ? state.overlays : emptyOverlays(),
  groupSubmissions: NO_GROUP_SUBMISSIONS,
  selectionRestore: null,
});

/** The groups still waiting on the room: an answered one is let go. */
const pruneGroupSubmissions = (
  entries: readonly GroupSubmission[] | undefined,
  pendingCommandIds: readonly string[] | undefined
): readonly GroupSubmission[] => {
  if (!entries || entries.length === 0) return NO_GROUP_SUBMISSIONS;
  if (pendingCommandIds === undefined) return entries;
  const kept = entries.filter(
    (entry) =>
      entry.commandId === null || pendingCommandIds.includes(entry.commandId)
  );
  return kept.length === entries.length ? entries : kept;
};

const purgeRejectedRecipientProjection = (
  state: BoardSessionControllerState,
  sessionPhase: ClientSessionPhase
): BoardSessionControllerReduction =>
  purged(
    nextState(state, {
      sessionPhase,
      view: undefined,
      replayLocalDisplay: undefined,
      scene: undefined,
      sceneInstallMode: 'replace',
      ...clearLocalPresentation(state),
      canSubmitCommands: false,
    }),
    state.scene ? [{ kind: 'ResetRenderer', reason: 'identity_changed' }] : []
  );

const hasCard = (scene: BoardScene, cardId: ViewCardId): boolean =>
  scene.cards.some((card) => card.id === cardId && card.interactive);

const hasOpenedZoneCard = (
  state: BoardSessionControllerState,
  scene: BoardScene,
  cardId: ViewCardId
): boolean =>
  state.presentation.openedZoneId !== null &&
  scene.cards.some(
    (card) =>
      card.id === cardId && card.parentId === state.presentation.openedZoneId
  );

const openedZoneRemainsPresentable = (zone: BoardScene['zones'][number]) =>
  zone.interactive &&
  (!['deck', 'discard', 'lostZone'].includes(zone.kind) || zone.count > 0);

/**
 * The pile to show a refused group's cards in: the one open now, or else the
 * one the group was picked in, when its move emptied and so closed it.
 */
const restoreViewer = (
  scene: BoardScene,
  open: string | null,
  pickedIn: string | undefined
): string | null =>
  open ??
  (pickedIn !== undefined &&
  scene.zones.some(
    (zone) => zone.id === pickedIn && openedZoneRemainsPresentable(zone)
  )
    ? pickedIn
    : null);

const hasDropTarget = (view: MatchViewState, scene: BoardScene, id: string) =>
  Boolean(
    scene.zones.some((zone) => zone.id === id && zone.interactive) ||
    (view.stacks[id] &&
      scene.cards.some((card) => card.parentId === id && card.interactive))
  );

/** The table a selection is read against (ADR-042 §1). */
const selectionContextOf = (
  view: MatchViewState,
  scene: BoardScene,
  dependencies: BoardSessionControllerDependencies,
  openedZoneId: string | null
): SelectionContext => {
  const acting = actingPlayerIdOf(view, scene.bottomPlayerId);
  return {
    view,
    scene,
    ...(acting ? { actingPlayerId: acting } : {}),
    ...(dependencies.controlsEverySeat?.() === true
      ? { controlsEverySeat: true }
      : {}),
    openedZoneId,
  };
};

/** Several items selected: the group's paths, not one card's. */
const holdsGroup = (presentation: BoardPresentation): boolean =>
  presentation.selection.length > 1;

/** Whether a card is one of the selected items, or part of one. */
const isSelectedItem = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  cardId: ViewCardId
): boolean => {
  if (selection.includes(cardId)) return true;
  const item = normalizeSelection(context, [cardId]).items[0];
  return item !== undefined && selection.includes(item);
};

/** The name a notice gives a card, when the table shows it. */
const cardNameOf = (
  scene: BoardScene,
  cardId: ViewCardId | undefined
): string | undefined => {
  if (cardId === undefined) return undefined;
  const card = scene.cards.find((candidate) => candidate.id === cardId);
  return card && !card.concealed && card.label ? card.label : undefined;
};

const reconcilePresentation = (
  state: BoardSessionControllerState,
  view: MatchViewState,
  scene: BoardScene,
  dependencies: BoardSessionControllerDependencies,
  pendingCommandIds?: readonly string[]
): Pick<
  BoardSessionControllerState,
  | 'presentation'
  | 'playTargeting'
  | 'overlays'
  | 'groupSubmissions'
  | 'selectionRestore'
> => {
  const openedZoneId =
    state.presentation.openedZoneId &&
    scene.zones.some(
      (zone) =>
        zone.id === state.presentation.openedZoneId &&
        openedZoneRemainsPresentable(zone)
    )
      ? state.presentation.openedZoneId
      : null;
  // A card on the table, or one in the pile still open (a pile's cards
  // aren't the table's): a resize or the other player's move keeps a card
  // picked in the viewer picked.
  const stillShown = (cardId: ViewCardId | null): ViewCardId | null =>
    cardId &&
    (hasCard(scene, cardId) ||
      (openedZoneId !== null &&
        scene.cards.some(
          (card) => card.id === cardId && card.parentId === openedZoneId
        )))
      ? cardId
      : null;
  const shownSelection = state.presentation.selection.filter(
    (cardId) => stillShown(cardId) !== null
  );
  let selection =
    shownSelection.length === state.presentation.selection.length
      ? state.presentation.selection
      : shownSelection.length === 0
        ? NO_SELECTION
        : shownSelection;
  const context = selectionContextOf(view, scene, dependencies, openedZoneId);
  // A group keeps the items still on the table: a Pokémon that evolved by
  // its new top card, a pile's cards while the pile stays open.
  if (holdsGroup(state.presentation)) {
    selection = reduceSelection(context, state.presentation.selection, {
      kind: 'reconcile',
    }).selection;
  }
  // A refused group's cards are back where they were: they are selected
  // again, unless the player has picked others meanwhile.
  const restoring = state.selectionRestore;
  let restoredMode = false;
  let reopened: string | null = null;
  if (restoring && restoring.cardIds.length > 0 && selection.length === 0) {
    const viewer = restoreViewer(scene, openedZoneId, restoring.openedZoneId);
    selection = reduceSelection(
      viewer === openedZoneId
        ? context
        : selectionContextOf(view, scene, dependencies, viewer),
      NO_SELECTION,
      { kind: 'restore', cardIds: restoring.cardIds }
    ).selection;
    restoredMode = restoring.selectionMode;
    if (selection.length > 0 && viewer !== openedZoneId) reopened = viewer;
  }
  const hoveredCardId = stillShown(state.presentation.hoveredCardId);
  const drag = state.presentation.drag;
  // A new view mid-drag keeps the card in hand; only a target it no longer
  // has stops being lit.
  const reconciledDrag =
    drag && hasCard(scene, drag.cardId)
      ? drag.targetId === null || hasDropTarget(view, scene, drag.targetId)
        ? drag
        : { ...drag, targetId: null }
      : null;
  const contextMenuCardId = stillShown(state.overlays.contextMenuCardId);
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
  const input = state.overlays.input;
  const shortcutInputZone =
    input?.kind === 'shortcutCount' ? view.zones[input.zoneId] : undefined;
  // The prompt is for the seat at the bottom, which a flipped board (Solo,
  // coaching) turns to the other player's.
  const shortcutInputIsCurrent =
    input?.kind === 'shortcutCount' &&
    view.viewer.kind === 'player' &&
    actingPlayerIdOf(view, scene.bottomPlayerId) === input.playerId &&
    Boolean(view.players[input.playerId]) &&
    shortcutInputZone?.kind === 'hand' &&
    shortcutInputZone.ownerId === input.playerId;
  const inputCard =
    input && input.kind !== 'shortcutCount'
      ? scene.cards.find((card) => card.id === input.cardId)
      : undefined;
  const inputStack = inputCard ? view.stacks[inputCard.parentId] : undefined;
  const inputZone =
    input?.kind === 'count' ? view.zones[input.zoneId] : undefined;
  const reconciledInput =
    input?.kind === 'shortcutCount'
      ? shortcutInputIsCurrent
        ? input
        : null
      : input &&
          inputCard &&
          (input.kind === 'count'
            ? inputZone?.cards.some((card) => card.id === input.cardId)
            : inputStack &&
              (input.kind === 'damage' || inputStack.slot === 'active'))
        ? input
        : null;
  return {
    presentation: {
      selection,
      // Touch's selection mode ends with its last item, and comes back
      // with a refused group's.
      selectionMode:
        (state.presentation.selectionMode || restoredMode) &&
        selection.length > 0,
      hoveredCardId,
      targetableCardIds: [],
      drag: reconciledDrag,
      // A refused group's pile, open again for its cards.
      openedZoneId: reopened ?? openedZoneId,
      settling: pruneSettling(
        settlingEntries(state.presentation),
        scene,
        pendingCommandIds
      ),
    },
    playTargeting: null,
    overlays: {
      contextMenuCardId,
      preview: reconciledPreview,
      input: reconciledInput,
      ...markerOverlay(
        markerControlsStayOpen(view, scene, state.overlays.marker)
          ? state.overlays.marker
          : null
      ),
    },
    groupSubmissions: pruneGroupSubmissions(
      state.groupSubmissions,
      pendingCommandIds
    ),
    selectionRestore: null,
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
      for (const card of workArea.attachmentResolution.cards) ids.add(card.id);
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
  sameSelection(left.selection, right.selection) &&
  left.selectionMode === right.selectionMode &&
  left.hoveredCardId === right.hoveredCardId &&
  left.targetableCardIds.length === right.targetableCardIds.length &&
  left.targetableCardIds.every(
    (cardId, index) => right.targetableCardIds[index] === cardId
  ) &&
  left.drag === right.drag &&
  left.openedZoneId === right.openedZoneId &&
  sameSettling(left.settling, right.settling);

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
      replayLocalDisplay: undefined,
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
  // fresh route owner and therefore a fresh controller. A failed session
  // the player asked to try again is the one exception: it comes back
  // through connecting, and its table with it.
  if (
    terminalPhase(state.sessionPhase) &&
    !(state.sessionPhase === 'failed' && frame.sessionPhase === 'connecting')
  ) {
    return rejected(state);
  }

  if (!frame.view) {
    if (state.source && !sameSourceTimeline(state.source, frame.source)) {
      return rejected(state);
    }
    if (keepsLastSafeView(frame.sessionPhase) && previousView && state.scene) {
      let retainedScene = state.scene;
      if (state.replayLocalDisplay) {
        try {
          retainedScene = dependencies.createScene(previousView);
        } catch {
          return purgeRejectedRecipientProjection(state, frame.sessionPhase);
        }
        if (!sceneMatchesProjection(previousView, retainedScene)) {
          return purgeRejectedRecipientProjection(state, frame.sessionPhase);
        }
      }
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
        replayLocalDisplay: state.replayLocalDisplay
          ? { ...state.replayLocalDisplay, zoneModes: {}, cardModes: {} }
          : undefined,
        scene: retainedScene,
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
      if (retainedScene !== state.scene) {
        effects.push({
          kind: 'InstallScene',
          scene: retainedScene,
          mode: 'replace',
          motion: { cause: 'replace' },
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
      replayLocalDisplay: undefined,
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
  const metadataRefresh = frame.boundary === 'refresh';
  const phaseOnlyPublication =
    sameTimeline &&
    frame.boundary === 'advance' &&
    frame.view === previousView &&
    frame.view.revision === previousRevision &&
    (frame.source.kind === 'live' || !replayGenerationChanged);

  if ((recipientChanged || timelineChanged) && frame.boundary !== 'resync') {
    return rejected(state);
  }
  if (
    metadataRefresh &&
    (frame.source.kind !== 'live' ||
      !sameTimeline ||
      previousRevision === undefined ||
      frame.view.revision !== previousRevision ||
      frame.view === previousView ||
      recipientChanged ||
      frame.sessionPhase !== 'ready')
  ) {
    return rejected(state);
  }
  if (
    sameTimeline &&
    frame.source.kind === 'replay' &&
    Boolean(state.replayLocalDisplay) !== Boolean(frame.replayLocalDisclosure)
  ) {
    return rejected(state);
  }
  if (
    phaseOnlyPublication &&
    frame.sessionPhase !== state.sessionPhase &&
    state.replayLocalDisplay &&
    frame.replayLocalDisclosure
  ) {
    const replayLocalDisplay = reconcileReplayLocalDisplayState(
      frame.view,
      frame.replayLocalDisclosure
    );
    if (!replayLocalDisplay) return rejected(state);
    let scene: BoardScene;
    try {
      scene = dependencies.createScene(frame.view);
    } catch {
      return rejected(state);
    }
    if (!sceneMatchesProjection(frame.view, scene)) return rejected(state);
    const local = clearLocalPresentation(state);
    const next = nextState(state, {
      sessionPhase: frame.sessionPhase,
      source: frame.source,
      cursor: cursorFor(frame, frame.view),
      replayLocalDisplay,
      scene,
      sceneInstallMode: 'replace',
      ...local,
      canSubmitCommands: false,
    });
    const effects: BoardSessionControllerEffect[] = [];
    if (state.sessionPhase === 'ready' && frame.sessionPhase !== 'ready') {
      effects.push({
        kind: 'CancelRendererInteraction',
        reason: 'session_not_ready',
      });
    }
    effects.push({
      kind: 'InstallScene',
      scene,
      mode: 'replace',
      motion: { cause: 'replace' },
    });
    if (!samePresentation(state.presentation, next.presentation)) {
      effects.push({
        kind: 'InstallPresentation',
        presentation: next.presentation,
      });
    }
    return accepted(next, effects);
  }
  if (
    phaseOnlyPublication &&
    frame.sessionPhase !== state.sessionPhase &&
    !state.replayLocalDisplay
  ) {
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
    !replacementBoundary &&
    !metadataRefresh
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
    // The session republishes the same view when only its command queue
    // moved; that is when a settled card's command completes.
    const settling = pruneSettling(
      settlingEntries(state.presentation),
      state.scene,
      frame.pendingCommandIds
    );
    const presentation =
      settling === state.presentation.settling
        ? state.presentation
        : { ...state.presentation, settling };
    return accepted(
      nextState(state, {
        source: frame.source,
        cursor: cursorFor(frame, frame.view),
        canSubmitCommands: canSubmit(frame),
        presentation,
        groupSubmissions: pruneGroupSubmissions(
          state.groupSubmissions,
          frame.pendingCommandIds
        ),
      }),
      presentation === state.presentation
        ? []
        : [{ kind: 'InstallPresentation', presentation }]
    );
  }

  const resetsRenderer =
    state.scene !== undefined &&
    cursor !== null &&
    (recipientChanged || timelineChanged || replacementBoundary);

  const preserveReplayLocalModes =
    sameTimeline &&
    !replacementBoundary &&
    frame.boundary === 'advance' &&
    frame.sessionPhase === 'ready';
  const replayLocalDisplayCandidate = frame.replayLocalDisclosure
    ? reconcileReplayLocalDisplayState(
        frame.view,
        frame.replayLocalDisclosure,
        preserveReplayLocalModes ? state.replayLocalDisplay : undefined
      )
    : undefined;
  if (frame.replayLocalDisclosure && !replayLocalDisplayCandidate) {
    if (recipientChanged) {
      return purgeRejectedRecipientProjection(state, frame.sessionPhase);
    }
    return rejected(state);
  }
  const replayLocalDisplay = replayLocalDisplayCandidate ?? undefined;
  const displayView = applyReplayLocalDisclosure(
    frame.view,
    replayLocalDisplay
  );
  let scene: BoardScene;
  try {
    scene = dependencies.createScene(displayView);
  } catch {
    if (recipientChanged) {
      return purgeRejectedRecipientProjection(state, frame.sessionPhase);
    }
    return rejected(state);
  }
  if (!sceneMatchesProjection(frame.view, scene)) {
    if (recipientChanged) {
      return purgeRejectedRecipientProjection(state, frame.sessionPhase);
    }
    return rejected(state);
  }

  const mustClearLocal =
    cursor === null ||
    recipientChanged ||
    timelineChanged ||
    replacementBoundary ||
    frame.sessionPhase !== 'ready';
  const local = mustClearLocal
    ? clearLocalPresentation(state)
    : reconcilePresentation(
        state,
        frame.view,
        scene,
        dependencies,
        frame.pendingCommandIds
      );
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
    replayLocalDisplay,
    scene,
    sceneInstallMode: installMode,
    ...local,
    canSubmitCommands: canSubmit(frame),
  });
  const effects: BoardSessionControllerEffect[] = [];
  if (resetsRenderer) {
    effects.push({ kind: 'ResetRenderer', reason: 'identity_changed' });
  }
  // A same-revision frame from this client's queue animates as a prediction
  // or a rollback; a forward step animates as the room's move; anything that
  // cleared local state (a new recipient, a seek, a resync) simply appears.
  const motion: BoardSceneMotion = mustClearLocal
    ? { cause: 'replace' }
    : frame.motionHint
      ? { cause: frame.motionHint }
      : installMode === 'advance' || frame.boundary === 'refresh'
        ? { cause: 'advance' }
        : { cause: 'replace' };
  effects.push({ kind: 'InstallScene', scene, mode: installMode, motion });
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
  overlays: BoardOverlayState = state.overlays,
  playTargeting: BoardTargetingState | null = state.playTargeting
): BoardSessionControllerReduction => {
  if (
    samePresentation(state.presentation, presentation) &&
    sameOverlays(overlays, state.overlays) &&
    playTargeting === state.playTargeting
  ) {
    return ignored(state);
  }
  const next = nextState(state, { presentation, overlays, playTargeting });
  return accepted(next, [
    { kind: 'InstallPresentation', presentation: next.presentation },
  ]);
};

const handleIntent = (
  state: BoardSessionControllerState,
  intent: BoardIntent,
  dependencies: BoardSessionControllerDependencies,
  allowOpenedZoneCard = false
): BoardSessionControllerReduction => {
  const view = state.view;
  const scene = state.scene;
  if (!view || !scene) return rejectIntent(state, intent, 'no_installed_view');
  const hasPresentableCard = (cardId: ViewCardId): boolean =>
    allowOpenedZoneCard
      ? hasOpenedZoneCard(state, scene, cardId)
      : hasCard(scene, cardId);

  switch (intent.kind) {
    case 'CardSelected': {
      // A press with Shift or ⌘/Ctrl, or any tap in touch's selection
      // mode, adds the card to the selection or takes it out (ADR-042 §2):
      // a card on the table or in the open pile alike.
      const adding =
        state.presentation.selectionMode ||
        cardSelectionModeOf(intent) === 'add';
      const card = scene.cards.find(
        (candidate) =>
          candidate.id === intent.cardId &&
          (hasPresentableCard(candidate.id) ||
            (adding && hasOpenedZoneCard(state, scene, candidate.id)))
      );
      if (!card) return rejectIntent(state, intent, 'stale_card');
      if (state.playTargeting) {
        const targeting = state.playTargeting;
        const target = targeting.targets.find(
          (candidate) =>
            candidate.topCardId === intent.cardId ||
            (card.composition &&
              card.role === 'stackEvolution' &&
              card.parentId === candidate.stackId)
        );
        if (target && targeting.kind === 'group') {
          return submitGroup(
            state,
            view,
            scene,
            dependencies,
            targeting.cardIds,
            { kind: 'drop', targetId: target.stackId },
            null
          );
        }
        if (target && targeting.kind === 'attachOrEvolve') {
          const presentation: BoardPresentation = {
            ...state.presentation,
            selection: NO_SELECTION,
            targetableCardIds: [],
            drag: null,
          };
          const cleared = nextState(state, {
            presentation,
            playTargeting: null,
            overlays: emptyOverlays(),
          });
          const resolution = (
            dependencies.resolveAttachEvolveTarget ?? resolveAttachEvolveTarget
          )(view, targeting, target.topCardId);
          const effects: BoardSessionControllerEffect[] = [
            { kind: 'InstallPresentation', presentation },
          ];
          if (resolution.ok) {
            effects.push({
              kind: 'SubmitCommand',
              command: resolution.command,
            });
          } else {
            effects.push({
              kind: 'IntentRejected',
              intent,
              reason: resolution.reason,
            });
          }
          return accepted(cleared, effects);
        }
      }
      if (adding) {
        const context = selectionContextOf(
          view,
          scene,
          dependencies,
          state.presentation.openedZoneId
        );
        // One card picked as v1 picks it may be part of a Pokémon: as the
        // first of a group it stands for the whole Pokémon.
        const base =
          state.presentation.selection.length === 1
            ? normalizeSelection(context, state.presentation.selection).items
            : state.presentation.selection;
        const change = reduceSelection(context, base, {
          kind: 'add',
          cardId: intent.cardId,
        });
        const refused = change.refused[0];
        if (refused) return rejectIntent(state, intent, refused.reason);
        return installPresentation(
          state,
          {
            ...state.presentation,
            selection: change.selection,
            selectionMode:
              state.presentation.selectionMode && change.selection.length > 0,
            targetableCardIds: [],
            drag: null,
          },
          emptyOverlays(),
          null
        );
      }
      // A plain press: this card alone (v1's click), or none when it was
      // the one selected.
      if (
        cardSelectionModeOf(intent) !== 'replace' &&
        selectedCardIdOf(state.presentation) === intent.cardId
      ) {
        return installPresentation(
          state,
          {
            ...state.presentation,
            selection: NO_SELECTION,
            targetableCardIds: [],
            drag: null,
          },
          emptyOverlays(),
          null
        );
      }
      const retainOpenedZone =
        state.presentation.openedZoneId === card.parentId
          ? state.presentation.openedZoneId
          : null;
      return installPresentation(
        state,
        {
          ...state.presentation,
          selection: [intent.cardId],
          targetableCardIds: [],
          drag: null,
          openedZoneId: retainOpenedZone,
        },
        emptyOverlays(),
        null
      );
    }
    // A press on bare felt puts the selection down and ends any picking
    // of a Pokémon (ADR-042 §1).
    case 'BoardBackgroundPressed': {
      // The felt pressed: a refused group waiting to come back stays down.
      const settled = state.selectionRestore
        ? nextState(state, { selectionRestore: null })
        : state;
      return state.playTargeting || state.presentation.selection.length > 0
        ? installPresentation(
            settled,
            {
              ...state.presentation,
              selection: NO_SELECTION,
              selectionMode: false,
              targetableCardIds: [],
              drag: null,
            },
            state.playTargeting ? emptyOverlays() : state.overlays,
            null
          )
        : settled === state
          ? ignored(state)
          : accepted(settled);
    }
    case 'CardsSelected': {
      if (state.playTargeting) return ignored(state);
      const context = selectionContextOf(
        view,
        scene,
        dependencies,
        state.presentation.openedZoneId
      );
      // Cards that are no item (a pile's top, the other player's hidden
      // cards) are left out without a word: the rectangle and Select all
      // take what they can.
      const change =
        intent.mode === 'add'
          ? reduceSelection(
              context,
              normalizeSelection(context, state.presentation.selection).items,
              { kind: 'addMany', cardIds: intent.cardIds }
            )
          : reduceSelection(context, NO_SELECTION, {
              kind: 'replace',
              cardIds: intent.cardIds,
            });
      return installPresentation(
        state,
        {
          ...state.presentation,
          selection: change.selection,
          selectionMode:
            state.presentation.selectionMode && change.selection.length > 0,
          targetableCardIds: [],
          drag: null,
        },
        emptyOverlays(),
        null
      );
    }
    case 'SelectionModeChanged': {
      if (view.viewer.kind === 'spectator')
        return rejectIntent(state, intent, 'read_only');
      // Turned off (✕), it puts the selection down with it.
      return installPresentation(state, {
        ...state.presentation,
        selectionMode: intent.on,
        ...(intent.on ? {} : { selection: NO_SELECTION }),
      });
    }
    case 'CardContextRequested': {
      if (!hasPresentableCard(intent.cardId))
        return rejectIntent(state, intent, 'stale_card');
      if (view.viewer.kind === 'spectator')
        return rejectIntent(state, intent, 'read_only');
      // On a card of the group: the group's menu, the group kept.
      if (
        holdsGroup(state.presentation) &&
        isSelectedItem(
          selectionContextOf(
            view,
            scene,
            dependencies,
            state.presentation.openedZoneId
          ),
          state.presentation.selection,
          intent.cardId
        )
      ) {
        const next = nextState(state, {
          presentation: { ...state.presentation, drag: null },
          overlays: {
            contextMenuCardId: intent.cardId,
            preview: null,
            input: null,
          },
        });
        return accepted(next, [
          { kind: 'InstallPresentation', presentation: next.presentation },
        ]);
      }
      const next = nextState(state, {
        presentation: {
          ...state.presentation,
          // Keep the panel selection so its action row is usable on return.
          selection: allowOpenedZoneCard ? [intent.cardId] : NO_SELECTION,
          drag: null,
        },
        overlays: {
          contextMenuCardId: intent.cardId,
          preview: null,
          input: null,
        },
      });
      return accepted(next, [
        { kind: 'InstallPresentation', presentation: next.presentation },
      ]);
    }
    case 'CardPreviewRequested': {
      // A single-card preview may be asked for from inside the stack view,
      // where lower evolutions and attachments are not interactive on the
      // table; any card the scene knows can be looked at.
      const card = scene.cards.find(
        (candidate) =>
          candidate.id === intent.cardId &&
          (intent.single
            ? allowOpenedZoneCard
              ? hasOpenedZoneCard(state, scene, candidate.id)
              : true
            : hasPresentableCard(candidate.id))
      );
      if (!card) return rejectIntent(state, intent, 'stale_card');
      // A stack of one card has nothing more to show: open the card itself.
      const stack = view.stacks[card.parentId];
      const stackCardCount = stack
        ? stack.evolutionCards.length + stack.attachmentCards.length
        : 0;
      const preview: BoardPreviewState =
        stack && !intent.single && stackCardCount > 1
          ? {
              kind: 'stack',
              stackId: card.parentId,
              focusCardId: intent.cardId,
            }
          : { kind: 'card', cardId: intent.cardId };
      const next = nextState(state, {
        presentation: {
          ...state.presentation,
          // Keep the panel selection so its action row is usable on return;
          // reading a card leaves a group standing.
          selection: holdsGroup(state.presentation)
            ? state.presentation.selection
            : allowOpenedZoneCard
              ? [intent.cardId]
              : NO_SELECTION,
          drag: null,
        },
        overlays: { contextMenuCardId: null, preview, input: null },
      });
      return accepted(next, [
        { kind: 'InstallPresentation', presentation: next.presentation },
      ]);
    }
    case 'ZoneOpened': {
      if (
        !scene.zones.some(
          (zone) =>
            zone.id === intent.zoneId && openedZoneRemainsPresentable(zone)
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
      if (!hasPresentableCard(intent.cardId))
        return rejectIntent(state, intent, 'stale_card');
      // A selected card let go of with the rest of the group: one move.
      if (intent.groupCardIds && intent.groupCardIds.length > 1) {
        return submitGroup(
          state,
          view,
          scene,
          dependencies,
          intent.groupCardIds,
          {
            kind: 'drop',
            targetId: intent.targetId,
            ...(intent.index === undefined ? {} : { index: intent.index }),
          },
          { cardId: intent.cardId, x: intent.x, y: intent.y },
          allowOpenedZoneCard
        );
      }
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
      // Hold the card where it was dropped until the session resolves the
      // command. One dragged out of an opened zone is painted there too while
      // it settles (the renderer's held cards), so it flies on from the drop.
      // Top/Bottom changes only the pile's order, without lifting a card
      // onto the board while the command is pending.
      const settledCard =
        intent.pilePosition === undefined &&
        installedScene.cards.find(
          (card) =>
            card.id === intent.cardId &&
            (card.renderKey !== null || allowOpenedZoneCard)
        );
      const settling: readonly SettlingEntry[] = settledCard
        ? [
            ...settlingEntries(state.presentation).filter(
              (entry) => entry.cardId !== intent.cardId
            ),
            {
              cardId: intent.cardId,
              x: intent.x,
              y: intent.y,
              commandId: null,
              ...(movesWholeStack(resolution.command)
                ? { wholeStack: true }
                : {}),
              ...(intent.index === undefined
                ? {}
                : {
                    arrangement: {
                      targetId: intent.targetId,
                      index: intent.index,
                      revision: installedScene.revision,
                    },
                  }),
            },
          ]
        : intent.pilePosition === undefined
          ? settlingEntries(state.presentation)
          : settlingEntries(state.presentation).filter(
              (entry) => entry.cardId !== intent.cardId
            );
      const presentation = allowOpenedZoneCard
        ? {
            ...state.presentation,
            selection: NO_SELECTION,
            targetableCardIds: [],
            drag: null,
            settling,
          }
        : { ...state.presentation, drag: null, settling };
      const overlays = allowOpenedZoneCard ? emptyOverlays() : state.overlays;
      const playTargeting = allowOpenedZoneCard ? null : state.playTargeting;
      const presentationChanged = !samePresentation(
        state.presentation,
        presentation
      );
      const localChanged =
        presentationChanged ||
        !sameOverlays(state.overlays, overlays) ||
        state.playTargeting !== playTargeting;
      const next = localChanged
        ? nextState(state, { presentation, overlays, playTargeting })
        : state;
      return accepted(next, [
        ...(!presentationChanged
          ? []
          : ([
              { kind: 'InstallPresentation', presentation },
            ] satisfies BoardSessionControllerEffect[])),
        { kind: 'SubmitCommand', command: resolution.command },
      ]);
    }
    case 'MarkerPressed': {
      const marker = scene.markers.find(
        (candidate) => candidate.id === intent.markerId
      );
      if (!marker || !hasCard(scene, marker.parentCardId))
        return rejectIntent(state, intent, 'stale_card');
      if (view.viewer.kind === 'spectator' || !state.canSubmitCommands)
        return rejectIntent(state, intent, 'read_only');
      // A second press on the same marker puts its controls away.
      const open = openMarker(scene, state.overlays.marker);
      return installPresentation(
        state,
        { ...state.presentation, drag: null },
        {
          contextMenuCardId: null,
          preview: null,
          input: null,
          ...markerOverlay(
            open?.id === marker.id
              ? null
              : { cardId: marker.parentCardId, kind: marker.kind }
          ),
        }
      );
    }
    case 'BoardResizeRequested':
      return rejectIntent(state, intent, 'unsupported_intent');
  }
};

/** A group's moves take its cards away; its marks leave them selected. */
const MOVING_GROUP_ACTIONS: ReadonlySet<GroupAction['kind']> = new Set([
  'send',
  'play',
  'stadium',
  'drop',
]);

const rejectGroup = (
  state: BoardSessionControllerState,
  action: GroupAction | null,
  reason: GroupActionRejectionReason,
  itemCount: number,
  scene?: BoardScene,
  cardId?: ViewCardId
): BoardSessionControllerReduction => {
  const cardName = scene ? cardNameOf(scene, cardId) : undefined;
  return accepted(state, [
    {
      kind: 'GroupActionRejected',
      action,
      reason,
      itemCount,
      ...(cardId === undefined ? {} : { cardId }),
      ...(cardName === undefined ? {} : { cardName }),
    },
  ]);
};

/**
 * A dropped group, held where it was let go while its move is in flight:
 * the grabbed card and up to four more, settling and let go together.
 */
const groupSettling = (
  state: BoardSessionControllerState,
  view: MatchViewState,
  scene: BoardScene,
  cardIds: readonly ViewCardId[],
  compiled: Extract<GroupCompilation, { readonly ok: true }>,
  drop: { readonly cardId: ViewCardId; readonly x: number; readonly y: number },
  action: GroupAction,
  allowOpenedZoneCard: boolean
): readonly SettlingEntry[] => {
  const skipped = new Set<ViewCardId>(compiled.skipped);
  // The items the hand carried (carriedGroup, the gripped one and up to
  // four fanned behind it) come down where they were held; the rest fly
  // to their places when the room has moved them.
  const carried = new Map(
    carriedGroup(scene, { cardId: drop.cardId, groupCardIds: cardIds }).map(
      (item) => [item.itemId, item] as const
    )
  );
  const held = [...carried.keys()].filter((cardId) => !skipped.has(cardId));
  const dropId = `group:${String(state.generation)}`;
  const whole = wholeStackTops(view, compiled.command);
  const target =
    action.kind === 'drop'
      ? scene.zones.find((zone) => zone.id === action.targetId)
      : undefined;
  const width = target ? groupArrivalWidth(scene, cardIds, target) : 1;
  const entries = held.flatMap((cardId): SettlingEntry[] => {
    const card = scene.cards.find(
      (candidate) =>
        candidate.id === cardId &&
        (candidate.renderKey !== null ||
          allowOpenedZoneCard ||
          candidate.parentId === state.presentation.openedZoneId)
    );
    if (!card) return [];
    const item = carried.get(cardId);
    return [
      {
        cardId,
        x: drop.x + (item?.dx ?? 0),
        y: drop.y + (item?.dy ?? 0),
        commandId: null,
        dropId,
        ...(whole.has(cardId) ? { wholeStack: true } : {}),
        ...(action.kind === 'drop' && action.index !== undefined
          ? {
              arrangement: {
                targetId: action.targetId,
                index: action.index,
                revision: scene.revision,
                ...(width > 1 ? { width } : {}),
              },
            }
          : {}),
      },
    ];
  });
  return [
    ...settlingEntries(state.presentation).filter(
      (entry) => !held.includes(entry.cardId)
    ),
    ...entries,
  ];
};

/**
 * A group's one move or mark (ADR-042 §3-4), compiled by `compileGroup`
 * and sent as one command. A move puts the selection down and remembers
 * it, to give it back if the room refuses; a mark (damage, a condition,
 * reveal…) leaves it standing, as a single card's keys do.
 */
const submitGroup = (
  state: BoardSessionControllerState,
  view: MatchViewState,
  scene: BoardScene,
  dependencies: BoardSessionControllerDependencies,
  cardIds: readonly ViewCardId[],
  action: GroupAction,
  drop: {
    readonly cardId: ViewCardId;
    readonly x: number;
    readonly y: number;
  } | null,
  allowOpenedZoneCard = false
): BoardSessionControllerReduction => {
  if (state.sessionPhase !== 'ready')
    return rejectGroup(state, action, 'not_ready', cardIds.length);
  if (!state.canSubmitCommands)
    return rejectGroup(state, action, 'read_only', cardIds.length);
  const context = selectionContextOf(
    view,
    scene,
    dependencies,
    state.presentation.openedZoneId
  );
  const compiled = compileGroup(context, cardIds, action);
  if (!compiled.ok) {
    return rejectGroup(
      state,
      action,
      compiled.reason,
      cardIds.length,
      scene,
      compiled.cardId
    );
  }
  const moves = MOVING_GROUP_ACTIONS.has(action.kind);
  const settling = drop
    ? groupSettling(
        state,
        view,
        scene,
        cardIds,
        compiled,
        drop,
        action,
        allowOpenedZoneCard
      )
    : state.presentation.settling;
  const presentation: BoardPresentation = moves
    ? {
        ...state.presentation,
        selection: NO_SELECTION,
        selectionMode: false,
        targetableCardIds: [],
        drag: null,
        settling,
      }
    : { ...state.presentation, targetableCardIds: [], drag: null, settling };
  const next = nextState(state, {
    presentation,
    // The menu or the picking that asked for it is done.
    overlays: emptyOverlays(),
    playTargeting: null,
    ...(moves
      ? {
          groupSubmissions: [
            ...(state.groupSubmissions ?? NO_GROUP_SUBMISSIONS),
            {
              commandId: null,
              cardIds,
              ...(state.presentation.selectionMode
                ? { selectionMode: true }
                : {}),
              ...(state.presentation.openedZoneId
                ? { openedZoneId: state.presentation.openedZoneId }
                : {}),
            },
          ],
        }
      : {}),
  });
  return accepted(next, [
    ...(samePresentation(state.presentation, presentation)
      ? []
      : ([
          { kind: 'InstallPresentation', presentation },
        ] satisfies BoardSessionControllerEffect[])),
    { kind: 'SubmitCommand', command: compiled.command },
  ]);
};

/** The selection's move or mark, from its menu, the palette or a key. */
const handleGroupAction = (
  state: BoardSessionControllerState,
  action: GroupAction,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  const selection = state.presentation.selection;
  if (!state.view || !state.scene)
    return rejectGroup(state, action, 'no_installed_view', selection.length);
  if (selection.length === 0) return rejectGroup(state, action, 'empty', 0);
  return submitGroup(
    state,
    state.view,
    state.scene,
    dependencies,
    selection,
    action,
    null
  );
};

/**
 * `q`/`e` with a group: lights every Pokémon in play that takes all of
 * the selected cards, for the player to pick; the group stays selected.
 */
const beginGroupTargeting = (
  state: BoardSessionControllerState,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  const view = state.view;
  const scene = state.scene;
  const selection = state.presentation.selection;
  if (!view || !scene)
    return rejectGroup(state, null, 'no_installed_view', selection.length);
  if (state.sessionPhase !== 'ready')
    return rejectGroup(state, null, 'not_ready', selection.length);
  if (!state.canSubmitCommands)
    return rejectGroup(state, null, 'read_only', selection.length);
  if (selection.length === 0) return rejectGroup(state, null, 'empty', 0);
  const context = selectionContextOf(
    view,
    scene,
    dependencies,
    state.presentation.openedZoneId
  );
  const targets = view.playerOrder.flatMap((playerId) => {
    const board = view.boards[playerId];
    if (!board) return [];
    return [
      ...(board.activeStackId ? [board.activeStackId] : []),
      ...board.benchStackIds,
    ].flatMap((stackId) => {
      const topCardId = view.stacks[stackId]?.evolutionCards.at(-1)?.id;
      return topCardId &&
        compileGroup(context, selection, { kind: 'drop', targetId: stackId }).ok
        ? [{ stackId, topCardId }]
        : [];
    });
  });
  if (targets.length === 0)
    return rejectGroup(state, null, 'no_target', selection.length);
  const presentation: BoardPresentation = {
    ...state.presentation,
    targetableCardIds: targets.flatMap((target) => {
      const pieces = scene.cards.filter(
        (card) =>
          card.parentId === target.stackId &&
          card.role === 'stackEvolution' &&
          card.composition
      );
      return pieces.length ? pieces.map((card) => card.id) : [target.topCardId];
    }),
    drag: null,
  };
  const next = nextState(state, {
    presentation,
    playTargeting: { kind: 'group', cardIds: selection, targets },
    overlays: emptyOverlays(),
  });
  return accepted(next, [{ kind: 'InstallPresentation', presentation }]);
};

/**
 * A group drag's outcome over one target, compiled once per target and
 * place rather than on every move of the pointer (ADR-042 §8).
 */
let groupDropMemo: {
  readonly view: MatchViewState;
  readonly scene: BoardScene;
  readonly cardIds: readonly ViewCardId[];
  readonly targetId: string;
  readonly index: number | undefined;
  readonly eitherSeat: boolean;
  readonly result: GroupCompilation;
} | null = null;

const groupDropCompilation = (
  view: MatchViewState,
  scene: BoardScene,
  dependencies: BoardSessionControllerDependencies,
  openedZoneId: string | null,
  cardIds: readonly ViewCardId[],
  targetId: string,
  index: number | undefined
): GroupCompilation => {
  const eitherSeat = dependencies.controlsEverySeat?.() === true;
  const memo = groupDropMemo;
  if (
    memo &&
    memo.view === view &&
    memo.scene === scene &&
    memo.cardIds === cardIds &&
    memo.targetId === targetId &&
    memo.index === index &&
    memo.eitherSeat === eitherSeat
  ) {
    return memo.result;
  }
  const result = compileGroup(
    selectionContextOf(view, scene, dependencies, openedZoneId),
    cardIds,
    {
      kind: 'drop',
      targetId,
      ...(index === undefined ? {} : { index }),
    }
  );
  groupDropMemo = {
    view,
    scene,
    cardIds,
    targetId,
    index,
    eitherSeat,
    result,
  };
  return result;
};

/**
 * Whether dropping the held card on `targetId` would do something: the lit
 * target is always where the card goes. Its own place (a no-op) counts, as
 * the card goes back there.
 */
/**
 * What a drag held over `targetId` would do if dropped now: null when the
 * drop would not land there.
 */
const dropOutcome = (
  state: BoardSessionControllerState,
  drag: NonNullable<BoardPresentation['drag']>,
  targetId: string,
  dependencies: BoardSessionControllerDependencies
): { readonly command: WireGameCommand | null } | null => {
  const view = state.view;
  const scene = state.scene;
  if (
    !view ||
    !scene ||
    state.sessionPhase !== 'ready' ||
    !state.canSubmitCommands ||
    !hasDropTarget(view, scene, targetId)
  ) {
    return null;
  }
  if (drag.groupCardIds && drag.groupCardIds.length > 1) {
    const compiled = groupDropCompilation(
      view,
      scene,
      dependencies,
      state.presentation.openedZoneId,
      drag.groupCardIds,
      targetId,
      drag.index
    );
    if (compiled.ok) return { command: compiled.command };
    return compiled.reason === 'no_op' ? { command: null } : null;
  }
  const resolution = (dependencies.resolveDrop ?? resolveBoardDrop)(
    view,
    scene,
    {
      kind: 'CardDropRequested',
      cardId: drag.cardId,
      targetId,
      x: drag.x,
      y: drag.y,
      ...(drag.index === undefined ? {} : { index: drag.index }),
      ...(drag.detached ? { detached: true } : {}),
    }
  );
  if (resolution.ok) return { command: resolution.command };
  return resolution.reason === 'no_op' ? { command: null } : null;
};

/**
 * A drop that trades two Pokémon's places (onto another of the player's
 * Pokémon, a Benched one onto the occupied Active, or the Active onto a
 * bench of one, whose Pokémon comes up in its place as in v1): the table
 * marks the one it would swap with.
 */
const swapAction = (
  command: WireGameCommand | null
): NonNullable<BoardPresentation['drag']>['action'] => {
  if (command?.type !== 'MovePlayStack') return undefined;
  if (command.targetStackId)
    return { kind: 'swap', stackId: command.targetStackId };
  // Onto the other player's board: only their Active, pushed to their Bench,
  // gives way, and nothing of theirs comes across.
  const across = command.destinationBoard;
  if (across) {
    return command.destinationSlot === 'active' &&
      across.expectedActiveStackId !== null
      ? { kind: 'swap', stackId: across.expectedActiveStackId }
      : undefined;
  }
  if (
    command.destinationSlot === 'active' &&
    command.expectedActiveStackId !== null &&
    command.expectedActiveStackId !== command.stackId
  ) {
    return { kind: 'swap', stackId: command.expectedActiveStackId };
  }
  const [lone, ...others] = command.expectedBenchStackIds;
  if (
    command.destinationSlot === 'bench' &&
    command.expectedSourceSlot === 'active' &&
    lone !== undefined &&
    others.length === 0
  ) {
    return { kind: 'swap', stackId: lone };
  }
  return undefined;
};

/** A command's steps: a group's batch, or the one command itself. */
const stepsOf = (command: WireGameCommand): readonly WireGameCommand[] =>
  command.type === 'ApplyCardSteps'
    ? (command.steps as readonly WireGameCommand[])
    : [command];

/**
 * The drop moved a whole Pokémon: its stack settles with the grabbed card.
 * A group's move reads its steps: each Pokémon a step moves whole.
 */
const movesWholeStack = (command: WireGameCommand): boolean =>
  stepsOf(command).some(
    (step) =>
      step.type === 'MovePlayStack' || step.type === 'MovePlayStackToZone'
  );

/** The top cards of the Pokémon a command's steps move whole. */
const wholeStackTops = (
  view: MatchViewState,
  command: WireGameCommand
): ReadonlySet<ViewCardId> =>
  new Set(
    stepsOf(command).flatMap((step) => {
      const top =
        step.type === 'MovePlayStack' || step.type === 'MovePlayStackToZone'
          ? view.stacks[step.stackId]?.evolutionCards.at(-1)?.id
          : undefined;
      return top ? [top] : [];
    })
  );

const handlePresentationUpdate = (
  state: BoardSessionControllerState,
  update: BoardPresentationUpdate,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  if (!state.scene) return ignored(state);
  if (update.kind === 'DragChanged') {
    const drag = update.drag;
    // A card on the table, or one picked out of the opened pile's viewer.
    if (
      drag &&
      !hasCard(state.scene, drag.cardId) &&
      !hasOpenedZoneCard(state, state.scene, drag.cardId)
    )
      return ignored(state);
    // The card keeps following the pointer whatever is under it; only a
    // target the drop would take is lit, and a swap is marked as one.
    const shown = ((): BoardPresentation['drag'] => {
      if (!drag) return drag;
      const { action: _stale, ...held } = drag;
      if (held.targetId === null) return held;
      const outcome = dropOutcome(state, held, held.targetId, dependencies);
      if (!outcome) return { ...held, targetId: null };
      const action = swapAction(outcome.command);
      return action ? { ...held, action } : held;
    })();
    // A drag of a selected card carries the group, which stays selected;
    // any other drag goes alone and puts the selection down (ADR-042 §2).
    const carriesGroup =
      drag?.groupCardIds !== undefined && drag.groupCardIds.length > 1;
    return installPresentation(state, {
      ...state.presentation,
      drag: shown,
      ...(drag && !carriesGroup
        ? { selection: NO_SELECTION, selectionMode: false }
        : {}),
    });
  }
  return ignored(state);
};

/** The top card of the Pokémon a card in play belongs to. */
const topCardOfStackHolding = (
  view: MatchViewState,
  cardId: ViewCardId
): ViewCardId | undefined => {
  for (const stack of Object.values(view.stacks)) {
    if (
      stack.evolutionCards.some((card) => card.id === cardId) ||
      stack.attachmentCards.some((card) => card.id === cardId)
    )
      return stack.evolutionCards.at(-1)?.id;
  }
  return undefined;
};

const rejectOverlayAction = (
  state: BoardSessionControllerState,
  request: LegacyBoardOverlayActionRequest,
  reason: BoardOverlayActionRejectionReason
): BoardSessionControllerReduction =>
  accepted(state, [{ kind: 'OverlayActionRejected', request, reason }]);

const handleOverlayAction = (
  state: BoardSessionControllerState,
  request: LegacyBoardOverlayActionRequest,
  dependencies: BoardSessionControllerDependencies,
  direct = false
): BoardSessionControllerReduction => {
  const view = state.view;
  const scene = state.scene;
  if (!view || !scene) {
    return rejectOverlayAction(state, request, 'no_installed_view');
  }
  if (state.sessionPhase !== 'ready') {
    return rejectOverlayAction(state, request, 'not_ready');
  }
  const submittedInputIdentity =
    request.kind === 'context' &&
    'value' in request &&
    request.value !== undefined
      ? request.action === 'setDamage'
        ? ({ kind: 'damage' } as const)
        : request.action === 'setSpecialCondition'
          ? ({ kind: 'specialCondition' } as const)
          : isLegacyBoardCountActionId(request.action)
            ? ({ kind: 'count', action: request.action } as const)
            : null
      : null;
  const submittedInputMatches =
    request.kind === 'context' &&
    submittedInputIdentity !== null &&
    state.overlays.input?.kind === submittedInputIdentity.kind &&
    state.overlays.input.cardId === request.cardId &&
    (submittedInputIdentity.kind !== 'count' ||
      (state.overlays.input.kind === 'count' &&
        state.overlays.input.action === submittedInputIdentity.action));
  // A marker's open controls change that marker: its damage, its condition,
  // or its Ability's tick. They stay open for the next press.
  const fromMarkerControls =
    request.kind === 'context' &&
    state.overlays.marker?.cardId === request.cardId &&
    markerControlsStayOpen(view, scene, state.overlays.marker) &&
    (state.overlays.marker.kind === 'damage'
      ? request.action === 'setDamage' && 'value' in request
      : state.overlays.marker.kind === 'specialCondition'
        ? request.action === 'setSpecialCondition' && 'value' in request
        : request.action === 'toggleAbility');
  if (
    request.kind === 'context' &&
    ((!fromMarkerControls &&
      !direct &&
      (submittedInputIdentity
        ? !submittedInputMatches
        : state.overlays.contextMenuCardId !== request.cardId)) ||
      !scene.cards.some((card) => card.id === request.cardId))
  ) {
    return rejectOverlayAction(state, request, 'stale_card');
  }
  if (
    request.kind === 'zone' &&
    ((!direct && state.presentation.openedZoneId !== request.zoneId) ||
      !scene.zones.some((zone) => zone.id === request.zoneId))
  ) {
    return rejectOverlayAction(state, request, 'stale_zone');
  }
  if (
    request.kind === 'context' &&
    isReplayLocalDisclosureAction(request.action) &&
    state.source?.kind === 'replay' &&
    state.replayLocalDisplay
  ) {
    const replayLocalDisplay = toggleReplayLocalDisclosure(
      view,
      state.replayLocalDisplay,
      request.action,
      request.cardId
    );
    if (!replayLocalDisplay) {
      return rejectOverlayAction(state, request, 'unsupported_target');
    }
    let localScene: BoardScene;
    try {
      localScene = dependencies.createScene(
        applyReplayLocalDisclosure(view, replayLocalDisplay)
      );
    } catch {
      return rejected(state);
    }
    if (!sceneMatchesProjection(view, localScene)) return rejected(state);
    const local = clearLocalPresentation(state);
    const next = nextState(state, {
      replayLocalDisplay,
      scene: localScene,
      sceneInstallMode: 'replace',
      ...local,
    });
    return accepted(next, [
      {
        kind: 'InstallScene',
        scene: localScene,
        mode: 'replace',
        motion: { cause: 'layout' },
      },
      { kind: 'InstallPresentation', presentation: next.presentation },
    ]);
  }
  if (!state.canSubmitCommands) {
    return rejectOverlayAction(state, request, 'read_only');
  }
  const resolution = (
    dependencies.resolveOverlayAction ?? resolveLegacyBoardOverlayAction
  )(view, request, actingPlayerIdOf(view, scene.bottomPlayerId));
  if (!resolution.ok) {
    return rejectOverlayAction(state, request, resolution.reason);
  }
  if ('input' in resolution) {
    const local = clearLocalPresentation(state);
    // Damage and a Special Condition are set with the controls beside their
    // marker: damage typed into its number (selected, as v1's editor was)
    // or stepped by 10, a condition picked from the chips (put on as
    // Poisoned when there was none, as v1's editor started). The marker
    // lies on the Pokémon's top card, whichever of its cards (an Energy, a
    // lower Stage) the menu was opened on.
    const input = resolution.input;
    const controlsFor =
      input.kind === 'specialCondition' || input.kind === 'damage'
        ? {
            cardId: topCardOfStackHolding(view, input.cardId) ?? input.cardId,
            kind: input.kind,
            takesFocus: true as const,
          }
        : null;
    const next = nextState(state, {
      ...local,
      overlays: {
        contextMenuCardId: null,
        preview: null,
        input: controlsFor ? null : input,
        ...markerOverlay(controlsFor),
      },
    });
    return accepted(next, [
      { kind: 'InstallPresentation', presentation: next.presentation },
      ...(resolution.command
        ? ([
            { kind: 'SubmitCommand', command: resolution.command },
          ] satisfies BoardSessionControllerEffect[])
        : []),
    ]);
  }
  const submissions = [resolution.command, ...(resolution.followUps ?? [])].map(
    (command): BoardSessionControllerEffect => ({
      kind: 'SubmitCommand',
      command,
    })
  );
  if (fromMarkerControls) return accepted(state, submissions);
  if (request.kind === 'zone') {
    const local = clearLocalPresentation(state);
    const next = nextState(state, local);
    return accepted(next, [
      { kind: 'InstallPresentation', presentation: next.presentation },
      ...submissions,
    ]);
  }
  const next = submittedInputIdentity
    ? nextState(state, {
        overlays: { ...state.overlays, input: null },
      })
    : nextState(state, clearLocalPresentation(state));
  return accepted(next, [
    ...(submittedInputIdentity
      ? []
      : ([
          {
            kind: 'InstallPresentation',
            presentation: next.presentation,
          },
        ] satisfies BoardSessionControllerEffect[])),
    ...submissions,
  ]);
};

const rejectShortcutAction = (
  state: BoardSessionControllerState,
  request: LegacyBoardShortcutActionRequest,
  reason: BoardShortcutActionRejectionReason
): BoardSessionControllerReduction =>
  accepted(state, [{ kind: 'ShortcutActionRejected', request, reason }]);

const handleShortcutAction = (
  state: BoardSessionControllerState,
  request: LegacyBoardShortcutActionRequest,
  dependencies: BoardSessionControllerDependencies,
  direct = false
): BoardSessionControllerReduction => {
  const view = state.view;
  const scene = state.scene;
  if (!view || !scene) {
    return rejectShortcutAction(state, request, 'no_installed_view');
  }
  if (state.sessionPhase !== 'ready') {
    return rejectShortcutAction(state, request, 'not_ready');
  }
  if (!state.canSubmitCommands) {
    return rejectShortcutAction(state, request, 'read_only');
  }
  // A key pressed with several selected acts on all of them.
  if (request.action === 'groupAction')
    return handleGroupAction(state, request.group, dependencies);
  if (request.action === 'beginGroupAttach')
    return beginGroupTargeting(state, dependencies);
  if ('cardId' in request) {
    // The palette names any card the table has, a closed pile's buried
    // ones too; a press or key, only one it can reach.
    const reachable = direct
      ? scene.cards.some((card) => card.id === request.cardId)
      : hasCard(scene, request.cardId) ||
        hasOpenedZoneCard(state, scene, request.cardId);
    if (
      (!direct && selectedCardIdOf(state.presentation) !== request.cardId) ||
      !reachable
    ) {
      return rejectShortcutAction(state, request, 'stale_card');
    }
  }
  // `b` on a lone piece of a card printed in pieces joins its unfinished
  // Pokémon in play, as a group's `b` does (ADR-042 §5).
  if (request.action === 'moveCardToPlay' && request.slot === 'bench') {
    const joined = compileGroup(
      selectionContextOf(
        view,
        scene,
        dependencies,
        state.presentation.openedZoneId
      ),
      [request.cardId],
      { kind: 'play', slot: 'bench' }
    );
    if (joined.ok && joined.command.type === 'PlaceCardOnPlayStack') {
      const presentation: BoardPresentation = {
        ...state.presentation,
        selection: NO_SELECTION,
      };
      return accepted(nextState(state, { presentation }), [
        { kind: 'InstallPresentation', presentation },
        { kind: 'SubmitCommand', command: joined.command },
      ]);
    }
  }
  const submittedCountInput =
    isLegacyOwnHandShortcutAction(request.action) &&
    'value' in request &&
    request.value !== undefined;
  if (
    submittedCountInput &&
    !direct &&
    (state.overlays.input?.kind !== 'shortcutCount' ||
      state.overlays.input.action !== request.action)
  ) {
    return rejectShortcutAction(state, request, 'stale_input');
  }
  const resolution = (
    dependencies.resolveShortcutAction ?? resolveLegacyBoardShortcutAction
  )(view, request, actingPlayerIdOf(view, scene.bottomPlayerId));
  if (!resolution.ok) {
    return rejectShortcutAction(state, request, resolution.reason);
  }
  if ('input' in resolution) {
    const next = nextState(state, {
      overlays: {
        contextMenuCardId: null,
        preview: null,
        input: resolution.input,
      },
    });
    return accepted(next, []);
  }
  if ('targeting' in resolution) {
    const presentation: BoardPresentation = {
      ...state.presentation,
      selection: NO_SELECTION,
      targetableCardIds: resolution.targeting.targets.flatMap((target) => {
        const pieces = scene.cards.filter(
          (card) =>
            card.parentId === target.stackId &&
            card.role === 'stackEvolution' &&
            card.composition
        );
        return pieces.length
          ? pieces.map((card) => card.id)
          : [target.topCardId];
      }),
      drag: null,
      openedZoneId: null,
    };
    const next = nextState(state, {
      presentation,
      playTargeting: resolution.targeting,
      overlays: emptyOverlays(),
    });
    return accepted(next, [{ kind: 'InstallPresentation', presentation }]);
  }
  const stateAfterInput =
    submittedCountInput && state.overlays.input?.kind === 'shortcutCount'
      ? nextState(state, {
          overlays: { ...state.overlays, input: null },
        })
      : state;
  if (!resolution.dismissSelection) {
    return accepted(stateAfterInput, [
      { kind: 'SubmitCommand', command: resolution.command },
    ]);
  }
  const presentation: BoardPresentation = {
    ...stateAfterInput.presentation,
    selection: NO_SELECTION,
  };
  const next = nextState(stateAfterInput, { presentation });
  return accepted(next, [
    { kind: 'InstallPresentation', presentation },
    { kind: 'SubmitCommand', command: resolution.command },
  ]);
};

const rejectOncePerGameAction = (
  state: BoardSessionControllerState,
  targetPlayerId: string,
  action: OncePerGameAction,
  reason: OncePerGameActionRejectionReason
): BoardSessionControllerReduction =>
  accepted(state, [
    {
      kind: 'OncePerGameActionRejected',
      targetPlayerId,
      action,
      reason,
    },
  ]);

const handleOncePerGameAction = (
  state: BoardSessionControllerState,
  targetPlayerId: string,
  action: OncePerGameAction,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  if (!state.view || !state.scene) {
    return rejectOncePerGameAction(
      state,
      targetPlayerId,
      action,
      'no_installed_view'
    );
  }
  if (state.sessionPhase !== 'ready') {
    return rejectOncePerGameAction(state, targetPlayerId, action, 'not_ready');
  }
  if (!state.canSubmitCommands) {
    return rejectOncePerGameAction(state, targetPlayerId, action, 'read_only');
  }
  const resolution = (
    dependencies.resolveOncePerGameAction ?? resolveOncePerGameAction
  )(state.view, targetPlayerId, action);
  if (!resolution.ok) {
    return rejectOncePerGameAction(
      state,
      targetPlayerId,
      action,
      resolution.reason
    );
  }
  return accepted(state, [
    { kind: 'SubmitCommand', command: resolution.command },
  ]);
};

const refreshScene = (
  state: BoardSessionControllerState,
  dependencies: BoardSessionControllerDependencies,
  cause: 'layout' | 'flip' = 'layout'
): BoardSessionControllerReduction => {
  const view = state.view;
  if (!view) return rejected(state);
  let scene: BoardScene;
  try {
    scene = dependencies.createScene(
      applyReplayLocalDisclosure(view, state.replayLocalDisplay)
    );
  } catch {
    return rejected(state);
  }
  if (!sceneMatchesProjection(view, scene)) return rejected(state);
  const reconciled = reconcilePresentation(state, view, scene, dependencies);
  const presentation = reconciled.presentation.drag
    ? { ...reconciled.presentation, drag: null }
    : reconciled.presentation;
  const next = nextState(state, {
    scene,
    sceneInstallMode: 'replace',
    presentation,
    playTargeting: reconciled.playTargeting,
    overlays: reconciled.overlays,
    groupSubmissions: reconciled.groupSubmissions,
    selectionRestore: reconciled.selectionRestore,
  });
  const effects: BoardSessionControllerEffect[] = [
    {
      kind: 'CancelRendererInteraction',
      reason: 'projection_config_changed',
    },
    { kind: 'InstallScene', scene, mode: 'replace', motion: { cause } },
  ];
  if (!samePresentation(state.presentation, presentation)) {
    effects.push({ kind: 'InstallPresentation', presentation });
  }
  return accepted(next, effects);
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
      ? { selection: NO_SELECTION, selectionMode: false, targetableCardIds: [] }
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
    input: scope === 'all' || scope === 'input' ? null : state.overlays.input,
    ...markerOverlay(
      scope === 'all' || scope === 'marker' ? null : state.overlays.marker
    ),
  };
  return installPresentation(
    state,
    presentation,
    overlays,
    scope === 'all' || scope === 'selection' ? null : state.playTargeting
  );
};

export const reduceBoardSessionController = (
  state: BoardSessionControllerState,
  action: BoardSessionControllerAction,
  dependencies: BoardSessionControllerDependencies
): BoardSessionControllerReduction => {
  switch (action.kind) {
    case 'FrameReceived':
      return installFrame(state, action.frame, dependencies);
    case 'RefreshScene':
      return refreshScene(state, dependencies, action.cause);
    case 'RendererIntent':
      return handleIntent(state, action.intent, dependencies);
    case 'OpenedZoneCardIntent':
      return handleIntent(state, action.intent, dependencies, true);
    case 'LegacyOverlayActionRequested':
      return handleOverlayAction(
        state,
        action.request,
        dependencies,
        action.origin === 'palette'
      );
    case 'LegacyShortcutActionRequested':
      return handleShortcutAction(
        state,
        action.request,
        dependencies,
        action.origin === 'palette'
      );
    case 'GroupActionRequested':
      return handleGroupAction(state, action.action, dependencies);
    case 'OncePerGameActionRequested':
      return handleOncePerGameAction(
        state,
        action.targetPlayerId,
        action.action,
        dependencies
      );
    case 'RendererPresentationUpdated':
      return handlePresentationUpdate(state, action.update, dependencies);
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
    case 'DismissLocalPresentation': {
      const scope = action.scope ?? 'all';
      const reduction = dismissPresentation(state, scope);
      // Put away by the player, a pile stays shut and a selection stays
      // down when a refused group comes back.
      const zone = scope === 'all' || scope === 'zone';
      const selection = scope === 'all' || scope === 'selection';
      if (!zone && !selection) return reduction;
      const forget = <Entry extends { readonly openedZoneId?: string }>(
        entry: Entry
      ): Entry => {
        if (!zone || entry.openedZoneId === undefined) return entry;
        const { openedZoneId: _shut, ...rest } = entry;
        return rest as Entry;
      };
      const restore = reduction.state.selectionRestore;
      return {
        ...reduction,
        state: nextState(reduction.state, {
          groupSubmissions: (
            reduction.state.groupSubmissions ?? NO_GROUP_SUBMISSIONS
          ).map(forget),
          selectionRestore: selection || !restore ? null : forget(restore),
        }),
      };
    }
    case 'SubmissionRejected': {
      const entries = settlingEntries(state.presentation);
      const inDrop = newestDrop(entries);
      // A group's move that never left this client: its selection comes
      // straight back, the cards never having moved.
      const submissions = state.groupSubmissions ?? NO_GROUP_SUBMISSIONS;
      const unbound = submissions.findLastIndex(
        (entry) => entry.commandId === null
      );
      const unsent = unbound < 0 ? undefined : submissions[unbound];
      const restored = unsent?.cardIds;
      const restoring =
        restored !== undefined &&
        state.view !== undefined &&
        state.scene !== undefined &&
        state.presentation.selection.length === 0;
      const selection =
        restoring && state.view && state.scene
          ? reduceSelection(
              selectionContextOf(
                state.view,
                state.scene,
                dependencies,
                state.presentation.openedZoneId
              ),
              NO_SELECTION,
              { kind: 'restore', cardIds: restored! }
            ).selection
          : state.presentation.selection;
      const reduction = installPresentation(
        state,
        {
          ...state.presentation,
          selection,
          // Touch's selection mode comes back with the group it went with.
          ...(restoring
            ? {
                selectionMode:
                  unsent?.selectionMode === true && selection.length > 0,
              }
            : {}),
          targetableCardIds: [],
          drag: null,
          settling: inDrop
            ? entries.filter((entry, index) => !inDrop(entry, index))
            : entries,
        },
        state.overlays,
        null
      );
      if (unbound < 0) return reduction;
      return {
        ...reduction,
        state: nextState(reduction.state, {
          groupSubmissions: submissions.filter((_, index) => index !== unbound),
        }),
        outcome: 'accepted',
      };
    }
    case 'SubmissionQueued': {
      const entries = settlingEntries(state.presentation);
      const inDrop = newestDrop(entries);
      const submissions = state.groupSubmissions ?? NO_GROUP_SUBMISSIONS;
      const unbound = submissions.findLastIndex(
        (entry) => entry.commandId === null
      );
      if (!inDrop && unbound < 0) return ignored(state);
      const settling = !inDrop
        ? entries
        : action.predicted
          ? entries.filter((entry, index) => !inDrop(entry, index))
          : entries.map((entry, index) =>
              inDrop(entry, index)
                ? { ...entry, commandId: action.commandId }
                : entry
            );
      const presentation =
        settling === entries
          ? state.presentation
          : { ...state.presentation, settling };
      const groupSubmissions =
        unbound < 0
          ? submissions
          : submissions.map((entry, index) =>
              index === unbound
                ? {
                    ...entry,
                    commandId: action.commandId,
                    ...(action.predicted ? { predicted: true } : {}),
                  }
                : entry
            );
      return accepted(
        nextState(state, { presentation, groupSubmissions }),
        action.predicted && presentation !== state.presentation
          ? [{ kind: 'InstallPresentation', presentation }]
          : []
      );
    }
    case 'CommandRefused': {
      const submissions = state.groupSubmissions ?? NO_GROUP_SUBMISSIONS;
      const refused = submissions.find(
        (entry) => entry.commandId === action.commandId
      );
      if (!refused) return ignored(state);
      const groupSubmissions = submissions.filter((entry) => entry !== refused);
      const later: SelectionRestore = {
        cardIds: refused.cardIds,
        selectionMode: refused.selectionMode === true,
        ...(refused.openedZoneId ? { openedZoneId: refused.openedZoneId } : {}),
      };
      // Its cards are shown where it put them: the selection comes back
      // with the frame that takes them back (reconcilePresentation).
      if (refused.predicted || !state.view || !state.scene)
        return accepted(
          nextState(state, { groupSubmissions, selectionRestore: later })
        );
      // Nothing was shown moving: it comes back now.
      if (state.presentation.selection.length > 0)
        return accepted(nextState(state, { groupSubmissions }));
      const viewer = restoreViewer(
        state.scene,
        state.presentation.openedZoneId,
        refused.openedZoneId
      );
      const restored = reduceSelection(
        selectionContextOf(state.view, state.scene, dependencies, viewer),
        NO_SELECTION,
        { kind: 'restore', cardIds: refused.cardIds }
      ).selection;
      // Shown where a move queued before it puts them (its prediction still
      // standing), they are not all back yet: they come back with the frame
      // that withdraws it.
      if (restored.length < refused.cardIds.length)
        return accepted(
          nextState(state, { groupSubmissions, selectionRestore: later })
        );
      const presentation: BoardPresentation = {
        ...state.presentation,
        selection: restored,
        selectionMode: refused.selectionMode === true && restored.length > 0,
        ...(viewer !== state.presentation.openedZoneId
          ? { openedZoneId: viewer }
          : {}),
      };
      return accepted(
        nextState(state, { groupSubmissions, presentation }),
        samePresentation(state.presentation, presentation)
          ? []
          : [{ kind: 'InstallPresentation', presentation }]
      );
    }
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
    if (!this.disposed) this.options.onIdle?.();
    return true;
  }

  /** Whether an action is being reduced or its effects delivered right now. */
  isDispatching = (): boolean => this.dispatching;

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
