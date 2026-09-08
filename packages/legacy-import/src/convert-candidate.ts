import {
  applyEventBatch,
  assertMatchInvariants,
  cloneMatchState,
  createEmptyMatch,
  executeCommand,
  MAX_DECK_CARDS,
  playerZoneId,
  stableSerialize,
  stadiumZoneId,
  type CardInstanceId,
  type CommandRejectionCode,
  type EventBatch,
  type GameCommand,
  type MatchId,
  type MatchSeatInput,
  type MatchState,
  type PlayStack,
  type PlayerId,
  type WorkAreaId,
} from '@ptcgsim/game-core';

import {
  decodeLegacyV1Decks,
  type LegacyV1DeckDecodeIssueCode,
} from './decode-decks.js';
import {
  decodeLegacyV1CardAnnotationActions,
  type LegacyV1CardAnnotationAction,
  type LegacyV1CardAnnotationDecodeIssueCode,
  type LegacyV1CardAnnotationZone,
} from './decode-card-annotations.js';
import {
  decodeLegacyV1HistoryActions,
  type LegacyV1HistoryAction,
  type LegacyV1HistoryActionDecodeIssueCode,
} from './decode-history-actions.js';
import {
  decodeLegacyV1LifecycleActions,
  type LegacyV1LifecycleAction,
  type LegacyV1LifecycleDecodeIssueCode,
} from './decode-lifecycle.js';
import {
  decodeLegacyV1MarkerActions,
  type LegacyV1AbilityMarkerZone,
  type LegacyV1MarkerAction,
  type LegacyV1MarkerActionDecodeIssueCode,
} from './decode-markers.js';
import {
  decodeLegacyV1MovementActions,
  type LegacyV1CardSourceZone,
  type LegacyV1LooseDestinationZone,
  type LegacyV1MovementAction,
  type LegacyV1MovementDecodeIssueCode,
} from './decode-movement.js';
import {
  decodeLegacyV1TableActions,
  type LegacyV1TableAction,
  type LegacyV1TableActionDecodeIssueCode,
} from './decode-table-actions.js';
import {
  decodeLegacyV1RandomActions,
  type LegacyV1RandomAction,
  type LegacyV1RandomActionDecodeIssueCode,
} from './decode-random-actions.js';
import {
  createLegacyV1ImportContext,
  LegacyV1ImportContextError,
  type LegacyV1ImportContextErrorCode,
  type LegacyV1ResolvedOutcome,
} from './import-context.js';
import type {
  LegacyExportUser,
  LegacySynchronizedActionName,
  ParsedLegacyExport,
} from './parse-export.js';

const CONVERTED_ACTIONS = new Set<LegacySynchronizedActionName>([
  'loadDeckData',
  'reset',
  'setup',
  'takeTurn',
  'draw',
  'discardAndDraw',
  'shuffleAndDraw',
  'shuffleBottomAndDraw',
  'viewDeck',
  'moveCardBundle',
  'leaveAll',
  'discardAll',
  'lostZoneAll',
  'handAll',
  'shuffleAll',
  'shuffleBottom',
  'discardBoard',
  'handBoard',
  'shuffleBoard',
  'lostZoneBoard',
  'shuffleZone',
  'moveToDeckTop',
  'shuffleIntoDeck',
  'switchWithDeckTop',
  'shufflePrizesToDeckBottom',
  'attack',
  'pass',
  'VSTARGXFunction',
  'useAbility',
  'removeAbilityCounter',
  'addDamageCounter',
  'updateDamageCounter',
  'removeDamageCounter',
  'addSpecialCondition',
  'updateSpecialCondition',
  'removeSpecialCondition',
  'rotateCard',
  'changeType',
  'playRandomCardFaceDown',
  'undo',
]);

const NON_EXPORTED_ACTIONS = new Set<LegacySynchronizedActionName>([
  'exchangeData',
  'lookAtCards',
  'stopLookingAtCards',
  'revealCards',
  'hideCards',
  'revealShortcut',
  'hideShortcut',
  'lookShortcut',
  'stopLookingShortcut',
]);

const MAX_LEGACY_V1_UNDO_CHECKPOINTS = 128;

type LegacyV1ConvertedAction =
  | LegacyV1CardAnnotationAction
  | LegacyV1HistoryAction
  | LegacyV1LifecycleAction
  | LegacyV1MarkerAction
  | LegacyV1MovementAction
  | LegacyV1RandomAction
  | LegacyV1TableAction;

export interface LegacyV1CandidateTarget {
  readonly matchId: MatchId;
  readonly selfSeat: MatchSeatInput;
  readonly opponentSeat: MatchSeatInput;
}

export type LegacyV1CandidateIssueCode =
  | 'unsupported_action'
  | 'non_exported_action'
  | 'decoder_coverage_error'
  | 'invalid_target'
  | 'source_state_mismatch'
  | 'canonical_error'
  | `annotation.${LegacyV1CardAnnotationDecodeIssueCode}`
  | `deck.${LegacyV1DeckDecodeIssueCode}`
  | `history.${LegacyV1HistoryActionDecodeIssueCode}`
  | `lifecycle.${LegacyV1LifecycleDecodeIssueCode}`
  | `marker.${LegacyV1MarkerActionDecodeIssueCode}`
  | `movement.${LegacyV1MovementDecodeIssueCode}`
  | `random.${LegacyV1RandomActionDecodeIssueCode}`
  | `table.${LegacyV1TableActionDecodeIssueCode}`
  | `context.${LegacyV1ImportContextErrorCode}`
  | `command.${CommandRejectionCode}`;

export interface LegacyV1CandidateIssue {
  readonly code: LegacyV1CandidateIssueCode;
  readonly recordIndex: number | null;
  readonly path: string;
  readonly message: string;
}

export interface LegacyV1AppliedRecord {
  readonly recordIndex: number;
  readonly action: LegacyV1ConvertedAction['type'];
  readonly batches: readonly EventBatch[];
}

interface LegacyV1UndoHistoryEntry {
  readonly recordIndex: number;
  readonly player: LegacyExportUser;
  readonly checkpoint: MatchState;
  readonly sourceDamageMarkerStackIds: ReadonlySet<PlayStack['id']>;
  readonly sourceSpecialConditionTopCardIds: ReadonlyMap<
    PlayStack['id'],
    CardInstanceId
  >;
}

export type LegacyV1CandidateResult =
  | {
      readonly ok: true;
      readonly state: MatchState;
      readonly records: readonly LegacyV1AppliedRecord[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1CandidateIssue[];
    };

const failure = (issue: LegacyV1CandidateIssue): LegacyV1CandidateResult => ({
  ok: false,
  issues: [issue],
});

const targetPlayerId = (
  target: LegacyV1CandidateTarget,
  player: LegacyExportUser
): PlayerId =>
  player === 'self' ? target.selfSeat.playerId : target.opponentSeat.playerId;

const candidateSourceZoneId = (
  playerId: PlayerId,
  sourceZone: LegacyV1CardSourceZone
): ReturnType<typeof playerZoneId> | null => {
  switch (sourceZone) {
    case 'deck':
    case 'deckCover':
      return playerZoneId(playerId, 'deck');
    case 'hand':
      return playerZoneId(playerId, 'hand');
    case 'prizes':
      return playerZoneId(playerId, 'prizes');
    case 'discard':
    case 'discardCover':
      return playerZoneId(playerId, 'discard');
    case 'lostZone':
    case 'lostZoneCover':
      return playerZoneId(playerId, 'lostZone');
    case 'board':
      return playerZoneId(playerId, 'board');
    case 'stadium':
      return stadiumZoneId();
    case 'active':
    case 'bench':
    case 'attachedCards':
    case 'viewCards':
      return null;
  }
};

const candidateDestinationZoneId = (
  playerId: PlayerId,
  destinationZone: LegacyV1LooseDestinationZone
): ReturnType<typeof playerZoneId> => {
  switch (destinationZone) {
    case 'deck':
      return playerZoneId(playerId, 'deck');
    case 'hand':
      return playerZoneId(playerId, 'hand');
    case 'prizes':
      return playerZoneId(playerId, 'prizes');
    case 'discard':
    case 'discardCover':
      return playerZoneId(playerId, 'discard');
    case 'lostZone':
    case 'lostZoneCover':
      return playerZoneId(playerId, 'lostZone');
    case 'board':
      return playerZoneId(playerId, 'board');
  }
};

const candidateSourceCardId = (
  state: MatchState,
  playerId: PlayerId,
  sourceZoneId: ReturnType<typeof playerZoneId>,
  sourceZoneName: LegacyV1CardSourceZone,
  sourceIndex: number
) => {
  const sourceZone = state.zones[sourceZoneId];
  const expectedSourceIndex =
    sourceZoneName === 'deckCover'
      ? 0
      : sourceZoneName === 'discardCover' || sourceZoneName === 'lostZoneCover'
        ? (sourceZone?.cardIds.length ?? 0) - 1
        : sourceIndex;
  const cardId =
    sourceIndex === expectedSourceIndex
      ? sourceZone?.cardIds[sourceIndex]
      : undefined;
  const card = cardId ? state.cards[cardId] : undefined;
  return sourceZone &&
    cardId &&
    card &&
    (sourceZone.ownerId ?? card.ownerId) === playerId
    ? cardId
    : null;
};

interface CandidatePlayStackCard {
  readonly cardId: CardInstanceId;
  readonly kind: 'attachment' | 'lowerEvolution' | 'top';
  readonly stack: PlayStack;
}

const candidatePlayStackCardAtLegacyIndex = (
  state: MatchState,
  playerId: PlayerId,
  playZone: 'active' | 'bench',
  legacyCardIndex: number
): CandidatePlayStackCard | null => {
  const board = state.boards[playerId];
  if (!board) return null;
  const stackIds =
    playZone === 'active'
      ? board.activeStackId
        ? [board.activeStackId]
        : []
      : board.benchStackIds;
  let legacyIndex = 0;

  for (const stackId of stackIds) {
    const stack = state.stacks[stackId];
    if (
      !stack ||
      stack.boardPlayerId !== playerId ||
      stack.evolutionCardIds.length === 0 ||
      [...stack.evolutionCardIds, ...stack.attachmentCardIds].some(
        (cardId) => state.cards[cardId]?.ownerId !== playerId
      )
    ) {
      return null;
    }

    // V1 refresh moves each successively newer unattached top to the front,
    // leaving the complete evolution line newest-to-oldest, followed by the
    // versioned attachment order.
    const legacyCardIds = [
      ...[...stack.evolutionCardIds].reverse(),
      ...stack.attachmentCardIds,
    ];
    const offset = legacyCardIndex - legacyIndex;
    const cardId = legacyCardIds[offset];
    if (cardId) {
      return {
        cardId,
        kind:
          offset === 0
            ? 'top'
            : offset < stack.evolutionCardIds.length
              ? 'lowerEvolution'
              : 'attachment',
        stack,
      };
    }
    legacyIndex += legacyCardIds.length;
    if (legacyCardIndex < legacyIndex) return null;
  }

  return null;
};

const candidatePlayStackTopAtLegacyIndex = (
  state: MatchState,
  playerId: PlayerId,
  playZone: 'active' | 'bench',
  legacyCardIndex: number
): PlayStack | null => {
  const source = candidatePlayStackCardAtLegacyIndex(
    state,
    playerId,
    playZone,
    legacyCardIndex
  );
  return source?.kind === 'top' ? source.stack : null;
};

type CandidateAbilityMarkerTarget =
  | {
      readonly kind: 'stack';
      readonly stack: PlayStack;
    }
  | {
      readonly kind: 'card';
      readonly cardId: CardInstanceId;
    };

const candidateAbilityMarkerTarget = (
  state: MatchState,
  playerId: PlayerId,
  zone: LegacyV1AbilityMarkerZone,
  sourceIndex: number
): CandidateAbilityMarkerTarget | null => {
  if (zone === 'active' || zone === 'bench') {
    const source = candidatePlayStackCardAtLegacyIndex(
      state,
      playerId,
      zone,
      sourceIndex
    );
    if (source?.kind === 'top') {
      return { kind: 'stack', stack: source.stack };
    }
    if (source?.kind === 'attachment') {
      return { kind: 'card', cardId: source.cardId };
    }
    // V1 can put a marker on a lower evolution card, but canonical state owns
    // the play-stack marker at the current top. Refuse that lossy conversion.
    return null;
  }

  const zoneId =
    zone === 'stadium' ? stadiumZoneId() : playerZoneId(playerId, 'discard');
  const cardId = candidateSourceCardId(
    state,
    playerId,
    zoneId,
    zone,
    sourceIndex
  );
  return cardId ? { kind: 'card', cardId } : null;
};

interface CandidateStagedCard {
  readonly cardId: CardInstanceId;
  readonly workAreaId: WorkAreaId;
}

interface CandidateStagedCards {
  readonly canonicalCardIds: readonly CardInstanceId[];
  readonly legacyCardIds: readonly CardInstanceId[];
  readonly workAreaId: WorkAreaId;
}

interface CandidateInspectionCards {
  readonly cardIds: readonly CardInstanceId[];
  readonly workAreaId: WorkAreaId;
}

interface CandidateInspectionCard {
  readonly cardId: CardInstanceId;
  readonly workAreaId: WorkAreaId;
}

const candidateInspectionCardsInLegacyOrder = (
  state: MatchState,
  playerId: PlayerId
): CandidateInspectionCards | null => {
  const inspection = state.workAreas[playerId]?.inspection;
  if (
    !inspection ||
    inspection.sourceZoneId !== playerZoneId(playerId, 'deck') ||
    inspection.cardIds.length === 0 ||
    inspection.cardIds.some(
      (cardId) => state.cards[cardId]?.ownerId !== playerId
    )
  ) {
    return null;
  }
  return { cardIds: inspection.cardIds, workAreaId: inspection.id };
};

const candidateInspectionCardAtLegacyIndex = (
  state: MatchState,
  playerId: PlayerId,
  legacyCardIndex: number
): CandidateInspectionCard | null => {
  const inspection = candidateInspectionCardsInLegacyOrder(state, playerId);
  const cardId = inspection?.cardIds[legacyCardIndex];
  return inspection && cardId
    ? { cardId, workAreaId: inspection.workAreaId }
    : null;
};

const candidateStagedCardsInLegacyOrder = (
  state: MatchState,
  playerId: PlayerId
): CandidateStagedCards | null => {
  const resolution = state.workAreas[playerId]?.attachmentResolution;
  if (!resolution) return null;

  // Recursive V1 departure moves the newest lower evolution first, then each
  // successively older stage, before preserving the live attachment order.
  const canonicalCardIds = [
    ...resolution.evolutionCardIds,
    ...resolution.attachmentCardIds,
  ];
  const legacyCardIds = [
    ...[...resolution.evolutionCardIds].reverse(),
    ...resolution.attachmentCardIds,
  ];
  if (
    legacyCardIds.length === 0 ||
    legacyCardIds.some((cardId) => state.cards[cardId]?.ownerId !== playerId)
  ) {
    return null;
  }
  return {
    canonicalCardIds,
    legacyCardIds,
    workAreaId: resolution.id,
  };
};

const candidateStagedCardAtLegacyIndex = (
  state: MatchState,
  playerId: PlayerId,
  legacyCardIndex: number
): CandidateStagedCard | null => {
  const staged = candidateStagedCardsInLegacyOrder(state, playerId);
  if (!staged) return null;
  const cardId = staged.legacyCardIds[legacyCardIndex];
  return cardId ? { cardId, workAreaId: staged.workAreaId } : null;
};

interface CandidateCardAnnotationTarget {
  readonly cardId: CardInstanceId;
  readonly expectedSourceId:
    ReturnType<typeof playerZoneId> | PlayStack['id'] | WorkAreaId;
}

const candidateCardAnnotationTarget = (
  state: MatchState,
  playerId: PlayerId,
  zone: LegacyV1CardAnnotationZone,
  sourceIndex: number
): CandidateCardAnnotationTarget | null => {
  if (zone === 'active' || zone === 'bench') {
    const source = candidatePlayStackCardAtLegacyIndex(
      state,
      playerId,
      zone,
      sourceIndex
    );
    return source && source.kind !== 'lowerEvolution'
      ? { cardId: source.cardId, expectedSourceId: source.stack.id }
      : null;
  }
  if (zone === 'attachedCards') {
    const source = candidateStagedCardAtLegacyIndex(
      state,
      playerId,
      sourceIndex
    );
    return source
      ? { cardId: source.cardId, expectedSourceId: source.workAreaId }
      : null;
  }
  if (zone === 'viewCards') {
    const source = candidateInspectionCardAtLegacyIndex(
      state,
      playerId,
      sourceIndex
    );
    return source
      ? { cardId: source.cardId, expectedSourceId: source.workAreaId }
      : null;
  }

  const sourceZoneId = candidateSourceZoneId(playerId, zone);
  if (!sourceZoneId) return null;
  const cardId = candidateSourceCardId(
    state,
    playerId,
    sourceZoneId,
    zone,
    sourceIndex
  );
  return cardId ? { cardId, expectedSourceId: sourceZoneId } : null;
};

const translateLegacyShuffleBasis = (
  legacyCardIds: readonly CardInstanceId[],
  canonicalCardIds: readonly CardInstanceId[],
  shuffleIndices: readonly number[]
): readonly number[] | null => {
  if (
    legacyCardIds.length !== canonicalCardIds.length ||
    shuffleIndices.length !== legacyCardIds.length
  ) {
    return null;
  }
  const canonicalIndexByCardId = new Map(
    canonicalCardIds.map((cardId, index) => [cardId, index] as const)
  );
  if (canonicalIndexByCardId.size !== canonicalCardIds.length) return null;

  const translated: number[] = [];
  for (const legacyIndex of shuffleIndices) {
    const cardId = legacyCardIds[legacyIndex];
    if (cardId === undefined) return null;
    const canonicalIndex = canonicalIndexByCardId.get(cardId);
    if (canonicalIndex === undefined) return null;
    translated.push(canonicalIndex);
  }
  return new Set(translated).size === translated.length ? translated : null;
};

const translateLegacyInDeckShuffle = (
  deckCount: number,
  sourceIndex: number,
  shuffleIndices: readonly number[]
): readonly number[] => {
  const legacyPreShufflePositions = Array.from(
    { length: deckCount },
    (_, index) => index
  ).filter((index) => index !== sourceIndex);
  legacyPreShufflePositions.push(sourceIndex);
  return shuffleIndices.map((index) => legacyPreShufflePositions[index]!);
};

/**
 * Builds a private canonical candidate only when every admitted record belongs
 * to the closed set of fully decoded action atoms. Failures return no state,
 * and callers must discard the whole result rather than installing an
 * intermediate batch.
 */
export const buildLegacyV1Candidate = (
  parsed: ParsedLegacyExport,
  target: LegacyV1CandidateTarget
): LegacyV1CandidateResult => {
  const nonExportedIndex = parsed.actions.findIndex((action) =>
    NON_EXPORTED_ACTIONS.has(action.action)
  );
  if (nonExportedIndex >= 0) {
    return failure({
      code: 'non_exported_action',
      recordIndex: nonExportedIndex + 1,
      path: `$[${nonExportedIndex + 1}].action`,
      message: 'Legacy action cannot occur in a native V1 action export',
    });
  }

  const unsupportedIndex = parsed.actions.findIndex(
    (action) => !CONVERTED_ACTIONS.has(action.action)
  );
  if (unsupportedIndex >= 0) {
    return failure({
      code: 'unsupported_action',
      recordIndex: unsupportedIndex + 1,
      path: `$[${unsupportedIndex + 1}].action`,
      message: 'Legacy action family has not been semantically converted',
    });
  }

  const decodedLifecycle = decodeLegacyV1LifecycleActions(parsed);
  if (!decodedLifecycle.ok) {
    const issue = decodedLifecycle.issues[0]!;
    return failure({
      code: `lifecycle.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedHistory = decodeLegacyV1HistoryActions(parsed);
  if (!decodedHistory.ok) {
    const issue = decodedHistory.issues[0]!;
    return failure({
      code: `history.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedCardAnnotations = decodeLegacyV1CardAnnotationActions(parsed);
  if (!decodedCardAnnotations.ok) {
    const issue = decodedCardAnnotations.issues[0]!;
    return failure({
      code: `annotation.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedMovement = decodeLegacyV1MovementActions(parsed);
  if (!decodedMovement.ok) {
    const issue = decodedMovement.issues[0]!;
    return failure({
      code: `movement.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedMarkers = decodeLegacyV1MarkerActions(parsed);
  if (!decodedMarkers.ok) {
    const issue = decodedMarkers.issues[0]!;
    return failure({
      code: `marker.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedTableActions = decodeLegacyV1TableActions(parsed);
  if (!decodedTableActions.ok) {
    const issue = decodedTableActions.issues[0]!;
    return failure({
      code: `table.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const decodedRandomActions = decodeLegacyV1RandomActions(parsed);
  if (!decodedRandomActions.ok) {
    const issue = decodedRandomActions.issues[0]!;
    return failure({
      code: `random.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  const convertedActions: LegacyV1ConvertedAction[] = [
    ...decodedCardAnnotations.actions,
    ...decodedHistory.actions,
    ...decodedLifecycle.actions,
    ...decodedMarkers.actions,
    ...decodedMovement.actions,
    ...decodedRandomActions.actions,
    ...decodedTableActions.actions,
  ].sort((left, right) => left.recordIndex - right.recordIndex);
  const decoderCoverageIndex = parsed.actions.findIndex(
    (sourceAction, actionIndex) => {
      const decodedAction = convertedActions[actionIndex];
      return (
        decodedAction?.recordIndex !== actionIndex + 1 ||
        decodedAction.type !== sourceAction.action
      );
    }
  );
  if (
    convertedActions.length !== parsed.actions.length ||
    decoderCoverageIndex >= 0
  ) {
    const recordIndex =
      decoderCoverageIndex >= 0 ? decoderCoverageIndex + 1 : null;
    return failure({
      code: 'decoder_coverage_error',
      recordIndex,
      path: recordIndex === null ? '$' : `$[${recordIndex}].action`,
      message: 'Legacy action must be decoded exactly once before conversion',
    });
  }

  const decodedDecks = decodeLegacyV1Decks(parsed);
  if (!decodedDecks.ok) {
    const issue = decodedDecks.issues[0]!;
    return failure({
      code: `deck.${issue.code}`,
      recordIndex: issue.recordIndex,
      path: issue.path,
      message: issue.message,
    });
  }

  for (const action of decodedLifecycle.actions) {
    if (action.type !== 'setup') continue;
    const entries =
      action.player === 'self'
        ? decodedDecks.selfEntries
        : decodedDecks.opponentEntries;
    const expandedDeckCards = entries.reduce(
      (total, entry) => total + entry.count,
      0
    );
    if (action.shuffleIndices.length !== expandedDeckCards) {
      return failure({
        code: 'lifecycle.invalid_shuffle_permutation',
        recordIndex: action.recordIndex,
        path: `$[${action.recordIndex}].parameters[0]`,
        message: 'Setup permutation length must match the expanded source deck',
      });
    }
  }

  if (target.selfSeat.playerId === target.opponentSeat.playerId) {
    return failure({
      code: 'invalid_target',
      recordIndex: null,
      path: '$target',
      message: 'Legacy conversion target must contain two distinct seats',
    });
  }

  let state: MatchState;
  try {
    state = createEmptyMatch(target.matchId, [
      target.selfSeat,
      target.opponentSeat,
    ]);
  } catch {
    return failure({
      code: 'invalid_target',
      recordIndex: null,
      path: '$target',
      message: 'Legacy conversion target cannot create a canonical match',
    });
  }

  const importContext = createLegacyV1ImportContext();
  // A source damage node can temporarily contain empty/zero/negative text
  // before blur removes it, while canonical state normalizes that value to
  // null. Track source-node existence separately so a later edit before blur
  // remains valid without admitting an update that never had a source marker.
  const sourceDamageMarkerStackIds = new Set<PlayStack['id']>();
  // Unlike damage, V1 removes a condition node whenever its active host leaves
  // the slot or evolves. Remember the exact host top so record-boundary cleanup
  // can distinguish that automatic removal from a transient empty/zero edit.
  const sourceSpecialConditionTopCardIds = new Map<
    PlayStack['id'],
    CardInstanceId
  >();
  // V2 intentionally uses one authoritative whole-match branch instead of
  // replaying V1's two independently mutable per-seat JavaScript logs. Each
  // retained entry is one admitted V1 record, even when that record maps to
  // multiple canonical batches or to a source-authentic state no-op.
  const undoHistory: LegacyV1UndoHistoryEntry[] = [];
  const records: LegacyV1AppliedRecord[] = [];
  const entriesFor = (player: LegacyExportUser) =>
    player === 'self' ? decodedDecks.selfEntries : decodedDecks.opponentEntries;

  const execute = (
    recordIndex: number,
    command: GameCommand,
    outcome?: LegacyV1ResolvedOutcome
  ):
    | { readonly ok: true; readonly batch: EventBatch }
    | {
        readonly ok: false;
        readonly issue: LegacyV1CandidateIssue;
      } => {
    const actionContext = importContext.forAction(recordIndex, outcome);
    try {
      const result = executeCommand(
        state,
        command,
        actionContext.commandContext
      );
      actionContext.finish();
      if (!result.accepted) {
        return {
          ok: false,
          issue: {
            code: `command.${result.code}`,
            recordIndex,
            path: `$[${recordIndex}].action`,
            message: result.message,
          },
        };
      }
      state = result.state;
      return { ok: true, batch: result.batch };
    } catch (error) {
      if (error instanceof LegacyV1ImportContextError) {
        return {
          ok: false,
          issue: {
            code: `context.${error.code}`,
            recordIndex: error.recordIndex,
            path: `$[${error.recordIndex}].parameters`,
            message: error.message,
          },
        };
      }
      return {
        ok: false,
        issue: {
          code: 'canonical_error',
          recordIndex,
          path: `$[${recordIndex}]`,
          message: 'Canonical legacy action application failed',
        },
      };
    }
  };

  for (const action of convertedActions) {
    const stateBeforeAction = state;
    const damageMarkersBeforeAction = new Set(sourceDamageMarkerStackIds);
    const specialConditionsBeforeAction = new Map(
      sourceSpecialConditionTopCardIds
    );
    const playerId = targetPlayerId(target, action.player);
    const batches: EventBatch[] = [];
    const apply = (
      command: GameCommand,
      outcome?: LegacyV1ResolvedOutcome
    ): LegacyV1CandidateResult | null => {
      const result = execute(action.recordIndex, command, outcome);
      if (!result.ok) return failure(result.issue);
      batches.push(result.batch);
      return null;
    };

    switch (action.type) {
      case 'loadDeckData': {
        const problem = apply({
          type: 'LoadDeck',
          playerId,
          entries: entriesFor(action.player),
        });
        if (problem) return problem;
        undoHistory.length = 0;
        break;
      }
      case 'undo': {
        const checkpoint = undoHistory.at(-1);
        if (!checkpoint) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message: 'Recorded undo has no retained whole-match action',
          });
        }
        if (checkpoint.player !== action.player) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Recorded per-player undo conflicts with the canonical whole-match action order',
          });
        }

        // V1 records visible no-ops in its action arrays. Removing one changes
        // the legacy branch but has no canonical state transition to restore.
        // Preserve that branch behavior without fabricating a historical
        // revision solely to force an UndoApplied event.
        if (checkpoint.checkpoint.revision === state.revision) {
          state = checkpoint.checkpoint;
        } else {
          const problem = apply({
            type: 'ApplySoloUndo',
            // The export is from the controller's `self` perspective; `user`
            // selects the bottom-seat announcement/target after board flips.
            actorPlayerId: target.selfSeat.playerId,
            targetPlayerId: playerId,
            revertedCommandId: `legacy:v1:record:${checkpoint.recordIndex}`,
            revertedRevision: checkpoint.checkpoint.revision + 1,
            checkpoint: cloneMatchState(checkpoint.checkpoint),
          });
          if (problem) return problem;
        }

        sourceDamageMarkerStackIds.clear();
        for (const stackId of checkpoint.sourceDamageMarkerStackIds) {
          sourceDamageMarkerStackIds.add(stackId);
        }
        sourceSpecialConditionTopCardIds.clear();
        for (const [
          stackId,
          cardId,
        ] of checkpoint.sourceSpecialConditionTopCardIds) {
          sourceSpecialConditionTopCardIds.set(stackId, cardId);
        }
        undoHistory.pop();
        break;
      }
      case 'reset': {
        const problem = apply({
          type: 'LoadDeck',
          playerId,
          entries: action.build ? entriesFor(action.player) : [],
        });
        if (problem) return problem;
        break;
      }
      case 'setup': {
        const loadProblem = apply({
          type: 'LoadDeck',
          playerId,
          entries: entriesFor(action.player),
        });
        if (loadProblem) return loadProblem;
        const setupProblem = apply(
          { type: 'SetupPlayer', playerId },
          { kind: 'shuffle', indices: action.shuffleIndices }
        );
        if (setupProblem) return setupProblem;
        break;
      }
      case 'takeTurn': {
        const problem = apply({ type: 'StartTurn', playerId });
        if (problem) return problem;
        break;
      }
      case 'attack':
      case 'pass': {
        const problem = apply({
          type: action.type === 'attack' ? 'DeclareAttack' : 'PassTurn',
          playerId,
        });
        if (problem) return problem;
        break;
      }
      case 'VSTARGXFunction': {
        const player = state.players[playerId];
        if (!player) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Recorded once-per-game marker action has no canonical player',
          });
        }
        const used =
          action.marker === 'gx'
            ? player.oncePerGame.gxUsed
            : player.oncePerGame.vstarUsed;
        const problem = apply({
          type: 'SetOncePerGameMarker',
          playerId,
          marker: action.marker,
          used: !used,
        });
        if (problem) return problem;
        break;
      }
      case 'useAbility':
      case 'removeAbilityCounter': {
        const targetMarker = candidateAbilityMarkerTarget(
          state,
          playerId,
          action.zone,
          action.sourceIndex
        );
        if (!targetMarker) {
          const sourceIndexParameter = action.type === 'useAbility' ? 2 : 1;
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[${sourceIndexParameter}]`,
            message:
              'Recorded ability marker coordinate does not identify an exact canonical stack top, attachment, discard card, or stadium card',
          });
        }

        const requestedUsed = action.type === 'useAbility';
        const used =
          targetMarker.kind === 'stack'
            ? targetMarker.stack.abilityUsed
            : state.cards[targetMarker.cardId]?.abilityUsed;
        if (used === requestedUsed) break;

        const problem = apply(
          targetMarker.kind === 'stack'
            ? {
                type: 'SetAbilityUsed',
                stackId: targetMarker.stack.id,
                used: requestedUsed,
              }
            : {
                type: 'SetCardAbilityUsed',
                cardId: targetMarker.cardId,
                used: requestedUsed,
              }
        );
        if (problem) return problem;
        break;
      }
      case 'addDamageCounter':
      case 'updateDamageCounter':
      case 'removeDamageCounter': {
        const stack = candidatePlayStackTopAtLegacyIndex(
          state,
          playerId,
          action.zone,
          action.sourceIndex
        );
        if (!stack) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded damage marker coordinate does not identify an exact canonical stack top',
          });
        }
        const sourceMarkerExists = sourceDamageMarkerStackIds.has(stack.id);
        if (action.type === 'updateDamageCounter' && !sourceMarkerExists) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Recorded damage update requires an existing source damage marker',
          });
        }

        if (action.type === 'addDamageCounter' && sourceMarkerExists) break;
        if (action.type === 'removeDamageCounter' && !sourceMarkerExists) break;
        const damage =
          action.type === 'removeDamageCounter' ? null : action.damage;

        if (stack.damage !== damage) {
          const problem = apply({
            type: 'SetDamage',
            stackId: stack.id,
            damage,
          });
          if (problem) return problem;
        }
        if (action.type === 'addDamageCounter') {
          sourceDamageMarkerStackIds.add(stack.id);
        } else if (action.type === 'removeDamageCounter') {
          sourceDamageMarkerStackIds.delete(stack.id);
        }
        break;
      }
      case 'addSpecialCondition':
      case 'updateSpecialCondition':
      case 'removeSpecialCondition': {
        const stack = candidatePlayStackTopAtLegacyIndex(
          state,
          playerId,
          action.zone,
          action.sourceIndex
        );
        if (!stack) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded special-condition coordinate does not identify an exact canonical active stack top',
          });
        }
        const topCardId = stack.evolutionCardIds.at(-1)!;
        const sourceMarkerExists =
          sourceSpecialConditionTopCardIds.get(stack.id) === topCardId;
        if (action.type === 'updateSpecialCondition' && !sourceMarkerExists) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Recorded special-condition update requires an existing source marker',
          });
        }

        if (action.type === 'addSpecialCondition' && sourceMarkerExists) break;
        if (action.type === 'removeSpecialCondition' && !sourceMarkerExists)
          break;
        const condition =
          action.type === 'removeSpecialCondition' ? null : action.condition;

        if (stack.specialCondition !== condition) {
          const problem = apply({
            type: 'SetSpecialCondition',
            stackId: stack.id,
            condition,
          });
          if (problem) return problem;
        }
        if (action.type === 'addSpecialCondition') {
          sourceSpecialConditionTopCardIds.set(stack.id, topCardId);
        } else if (action.type === 'removeSpecialCondition') {
          sourceSpecialConditionTopCardIds.delete(stack.id);
        }
        break;
      }
      case 'rotateCard': {
        if (action.zone === 'stadium') {
          const cardId = candidateSourceCardId(
            state,
            playerId,
            stadiumZoneId(),
            'stadium',
            action.sourceIndex
          );
          const card = cardId ? state.cards[cardId] : undefined;
          if (!cardId || !card) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[1]`,
              message:
                'Recorded stadium rotation coordinate does not identify the current player card',
            });
          }
          const problem = apply({
            type: 'SetCardOrientation',
            cardId,
            orientationQuarterTurns: ((card.orientationQuarterTurns + 1) %
              4) as 0 | 1 | 2 | 3,
          });
          if (problem) return problem;
          break;
        }

        const source = candidatePlayStackCardAtLegacyIndex(
          state,
          playerId,
          action.zone,
          action.sourceIndex
        );
        if (!source) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded play rotation coordinate does not identify the current player stack card',
          });
        }

        if (!action.single) {
          const problem = apply({
            type: 'RotateStack',
            stackId: source.stack.id,
            rotationQuarterTurns: ((source.stack.rotationQuarterTurns + 1) %
              4) as 0 | 1 | 2 | 3,
          });
          if (problem) return problem;
          break;
        }

        const card = state.cards[source.cardId];
        if (!card) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded single-card rotation coordinate does not identify a canonical card',
          });
        }
        const problem = apply({
          type: 'SetCardOrientation',
          cardId: source.cardId,
          orientationQuarterTurns: card.orientationQuarterTurns === 1 ? 0 : 1,
        });
        if (problem) return problem;
        break;
      }
      case 'changeType': {
        const targetCard = candidateCardAnnotationTarget(
          state,
          playerId,
          action.zone,
          action.sourceIndex
        );
        if (!targetCard) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded category-change coordinate does not identify an exact supported current player card',
          });
        }

        const card = state.cards[targetCard.cardId];
        const board = state.zones[playerZoneId(playerId, 'board')];
        if (!card || !board) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded category-change target has no canonical card or loose board',
          });
        }
        if (
          targetCard.expectedSourceId === board.id &&
          board.cardIds.at(-1) === card.id &&
          card.currentCategory === action.category &&
          card.orientationQuarterTurns === 0 &&
          !card.abilityUsed
        ) {
          break;
        }

        const problem = apply({
          type: 'ChangeCardCategory',
          playerId,
          cardId: targetCard.cardId,
          expectedSourceId: targetCard.expectedSourceId,
          category: action.category,
        });
        if (problem) return problem;
        break;
      }
      case 'discardBoard':
      case 'handBoard':
      case 'shuffleBoard':
      case 'lostZoneBoard': {
        const board = state.zones[playerZoneId(playerId, 'board')];
        if (!board) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Recorded loose-board action has no canonical player board',
          });
        }

        if (board.cardIds.length === 0) {
          if (
            action.type === 'shuffleBoard' &&
            action.shuffleIndices !== null
          ) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'An empty-board shuffle must carry the V1 null permutation sentinel',
            });
          }
          break;
        }

        const destination =
          action.type === 'discardBoard'
            ? 'discard'
            : action.type === 'handBoard'
              ? 'hand'
              : action.type === 'lostZoneBoard'
                ? 'lostZone'
                : 'shuffleIntoDeck';
        let outcome: LegacyV1ResolvedOutcome | undefined;
        if (action.type === 'shuffleBoard') {
          const deck = state.zones[playerZoneId(playerId, 'deck')];
          if (
            !deck ||
            action.shuffleIndices === null ||
            action.shuffleIndices.length !==
              deck.cardIds.length + board.cardIds.length
          ) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded board-shuffle length does not match the source-state deck-plus-board card count',
            });
          }
          outcome = { kind: 'shuffle', indices: action.shuffleIndices };
        }

        const problem = apply(
          {
            type: 'ResolveLooseBoardCards',
            playerId,
            expectedBoardCardIds: [...board.cardIds],
            destination,
          },
          outcome
        );
        if (problem) return problem;
        break;
      }
      case 'draw': {
        const deck = state.zones[playerZoneId(playerId, 'deck')];
        if (!deck || action.count > deck.cardIds.length) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded draw count exceeds the source-state deck card count',
          });
        }
        const problem = apply({
          type: 'DrawCards',
          playerId,
          count: action.count,
        });
        if (problem) return problem;
        break;
      }
      case 'playRandomCardFaceDown': {
        const hand = state.zones[playerZoneId(playerId, 'hand')];
        const board = state.zones[playerZoneId(playerId, 'board')];
        if (
          !hand ||
          !board ||
          action.randomIndex >= hand.cardIds.length ||
          board.cardIds.length >= MAX_DECK_CARDS
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded random hand index cannot be applied to the exact current target hand and loose board',
          });
        }
        const problem = apply(
          {
            type: 'PlayRandomCardFaceDown',
            actorPlayerId: targetPlayerId(target, action.initiator),
            targetPlayerId: playerId,
          },
          { kind: 'randomInt', value: action.randomIndex }
        );
        if (problem) return problem;
        break;
      }
      case 'discardAndDraw': {
        const deck = state.zones[playerZoneId(playerId, 'deck')];
        if (!deck || action.count > deck.cardIds.length) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded discard-and-draw count exceeds the source-state deck card count',
          });
        }
        const problem = apply({
          type: 'DiscardHandAndDraw',
          playerId,
          count: action.count,
        });
        if (problem) return problem;
        break;
      }
      case 'shuffleAndDraw': {
        const deck = state.zones[playerZoneId(playerId, 'deck')];
        const hand = state.zones[playerZoneId(playerId, 'hand')];
        const combinedCount =
          (deck?.cardIds.length ?? 0) + (hand?.cardIds.length ?? 0);
        if (!deck || !hand || action.count > combinedCount) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded shuffle-and-draw count exceeds the source-state deck-plus-hand card count',
          });
        }
        if (action.shuffleIndices.length !== combinedCount) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded shuffle-and-draw length does not match the source-state deck-plus-hand card count',
          });
        }
        const problem = apply(
          {
            type: 'ShuffleHandIntoDeckAndDraw',
            playerId,
            count: action.count,
          },
          { kind: 'shuffle', indices: action.shuffleIndices }
        );
        if (problem) return problem;
        break;
      }
      case 'shuffleBottomAndDraw': {
        const deck = state.zones[playerZoneId(playerId, 'deck')];
        const hand = state.zones[playerZoneId(playerId, 'hand')];
        const combinedCount =
          (deck?.cardIds.length ?? 0) + (hand?.cardIds.length ?? 0);
        if (!deck || !hand || action.count > combinedCount) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded shuffle-bottom-and-draw count exceeds the source-state deck-plus-hand card count',
          });
        }
        if (action.shuffleIndices.length !== hand.cardIds.length) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded shuffle-bottom-and-draw length does not match the source-state hand card count',
          });
        }
        const problem = apply(
          {
            type: 'ShuffleHandToDeckBottomAndDraw',
            playerId,
            count: action.count,
          },
          { kind: 'shuffle', indices: action.shuffleIndices }
        );
        if (problem) return problem;
        break;
      }
      case 'viewDeck': {
        const deck = state.zones[playerZoneId(playerId, 'deck')];
        if (!deck || deck.cardIds.length !== action.expectedDeckCount) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[3]`,
            message:
              'Recorded view-deck deck-count witness does not match the exact current deck state',
          });
        }
        const viewerId = targetPlayerId(target, action.initiator);
        const inspection = state.workAreas[playerId]?.inspection;
        if (
          inspection &&
          (inspection.viewerIds.length !== 1 ||
            inspection.viewerIds[0] !== viewerId)
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].action`,
            message:
              'Repeated V1 deck inspection by a different viewer requires per-card visibility that the canonical work area cannot represent',
          });
        }
        if (action.count === 0) break;
        const problem = apply({
          type: 'ExtractDeckCardsForInspection',
          playerId,
          viewerIds: [viewerId],
          count: action.count,
          edge: action.edge,
          ...(inspection
            ? {
                expectedInspection: {
                  inspectionId: inspection.inspectionId,
                  workAreaId: inspection.id,
                  cardIds: [...inspection.cardIds],
                  viewerIds: [...inspection.viewerIds],
                },
              }
            : {}),
        });
        if (problem) return problem;
        break;
      }
      case 'moveCardBundle': {
        if (
          (action.sourceZone === 'active' || action.sourceZone === 'bench') &&
          (action.destinationZone === 'active' ||
            action.destinationZone === 'bench')
        ) {
          const source = candidatePlayStackCardAtLegacyIndex(
            state,
            playerId,
            action.sourceZone,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded move-card source coordinate does not identify a current active/bench card',
            });
          }
          const targetStack =
            typeof action.targetIndex === 'number'
              ? candidatePlayStackTopAtLegacyIndex(
                  state,
                  playerId,
                  action.destinationZone,
                  action.targetIndex
                )
              : null;
          if (source.kind !== 'top') {
            if (!targetStack) {
              return failure({
                code: 'source_state_mismatch',
                recordIndex: action.recordIndex,
                path: `$[${action.recordIndex}].parameters[4]`,
                message:
                  'Recorded lower active/bench card does not identify a current stack-top target',
              });
            }
            const problem = apply({
              type: 'PlaceCardOnPlayStack',
              playerId,
              cardId: source.cardId,
              expectedSourceId: source.stack.id,
              targetStackId: targetStack.id,
              expectedTargetTopCardId: targetStack.evolutionCardIds.at(-1)!,
              mode: 'attachment',
            });
            if (problem) return problem;
            break;
          }
          const stack = source.stack;
          if (
            typeof action.targetIndex === 'number' &&
            (!targetStack ||
              targetStack.id === stack.id ||
              action.sourceZone === action.destinationZone)
          ) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[4]`,
              message:
                'Recorded target coordinate does not identify a distinct opposite-slot active/bench stack top',
            });
          }
          const board = state.boards[playerId]!;
          if (
            !targetStack &&
            ((action.sourceZone === 'active' &&
              action.destinationZone === 'active') ||
              (action.sourceZone === 'bench' &&
                action.destinationZone === 'bench' &&
                board.benchStackIds.at(-1) === stack.id))
          ) {
            break;
          }
          const problem = apply({
            type: 'MovePlayStack',
            stackId: stack.id,
            expectedSourceSlot: action.sourceZone,
            expectedActiveStackId: board.activeStackId,
            expectedBenchStackIds: [...board.benchStackIds],
            destinationSlot: action.destinationZone,
            ...(targetStack ? { targetStackId: targetStack.id } : {}),
          });
          if (problem) return problem;
          break;
        }

        if (
          (action.sourceZone === 'active' || action.sourceZone === 'bench') &&
          action.mode === 'move' &&
          action.destinationZone !== 'active' &&
          action.destinationZone !== 'bench' &&
          action.destinationZone !== 'stadium'
        ) {
          const source = candidatePlayStackCardAtLegacyIndex(
            state,
            playerId,
            action.sourceZone,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded move-card source coordinate does not identify a current active/bench card',
            });
          }
          const problem = apply({
            type: 'MoveCardFromStack',
            cardId: source.cardId,
            expectedStackId: source.stack.id,
            destinationZoneId: candidateDestinationZoneId(
              playerId,
              action.destinationZone
            ),
          });
          if (problem) return problem;
          break;
        }

        if (action.sourceZone === 'viewCards') {
          const source = candidateInspectionCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded inspected-card coordinate does not identify a current deck-inspection card',
            });
          }

          if (
            action.destinationZone === 'active' ||
            action.destinationZone === 'bench'
          ) {
            if (typeof action.targetIndex !== 'number') {
              const boardZoneId = playerZoneId(playerId, 'board');
              const departureProblem = apply({
                type: 'MoveInspectedCard',
                cardId: source.cardId,
                expectedWorkAreaId: source.workAreaId,
                destinationZoneId: boardZoneId,
              });
              if (departureProblem) return departureProblem;
              const placementProblem = apply({
                type: 'MoveCardToPlay',
                cardId: source.cardId,
                expectedSourceZoneId: boardZoneId,
                boardPlayerId: playerId,
                slot: action.destinationZone,
              });
              if (placementProblem) return placementProblem;
              break;
            }
            const targetStack = candidatePlayStackTopAtLegacyIndex(
              state,
              playerId,
              action.destinationZone,
              action.targetIndex
            );
            if (!targetStack) {
              return failure({
                code: 'source_state_mismatch',
                recordIndex: action.recordIndex,
                path: `$[${action.recordIndex}].parameters[4]`,
                message:
                  'Recorded inspected-card destination does not identify a current stack top',
              });
            }
            const card = state.cards[source.cardId]!;
            const problem = apply({
              type: 'PlaceCardOnPlayStack',
              playerId,
              cardId: source.cardId,
              expectedSourceId: source.workAreaId,
              targetStackId: targetStack.id,
              expectedTargetTopCardId: targetStack.evolutionCardIds.at(-1)!,
              mode:
                card.currentCategory === 'Pokémon' ? 'evolution' : 'attachment',
            });
            if (problem) return problem;
            break;
          }

          const problem =
            action.mode === 'bottom'
              ? apply({
                  type: 'MoveCardToDeckBottom',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                })
              : action.destinationZone === 'stadium'
                ? apply({
                    type: 'MoveCardToStadium',
                    playerId,
                    cardId: source.cardId,
                    expectedSourceId: source.workAreaId,
                    expectedStadiumCardId:
                      state.zones[stadiumZoneId()]?.cardIds[0] ?? null,
                  })
                : apply({
                    type: 'MoveInspectedCard',
                    cardId: source.cardId,
                    expectedWorkAreaId: source.workAreaId,
                    destinationZoneId: candidateDestinationZoneId(
                      playerId,
                      action.destinationZone
                    ),
                  });
          if (problem) return problem;
          break;
        }

        if (action.sourceZone === 'attachedCards') {
          const source = candidateStagedCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded attached-card coordinate does not identify a current staged card',
            });
          }

          if (
            action.destinationZone === 'active' ||
            action.destinationZone === 'bench'
          ) {
            if (typeof action.targetIndex !== 'number') {
              const boardZoneId = playerZoneId(playerId, 'board');
              const departureProblem = apply({
                type: 'MoveStagedCard',
                cardId: source.cardId,
                expectedWorkAreaId: source.workAreaId,
                destinationZoneId: boardZoneId,
              });
              if (departureProblem) return departureProblem;
              const placementProblem = apply({
                type: 'MoveCardToPlay',
                cardId: source.cardId,
                expectedSourceZoneId: boardZoneId,
                boardPlayerId: playerId,
                slot: action.destinationZone,
              });
              if (placementProblem) return placementProblem;
              break;
            }
            const targetStack = candidatePlayStackTopAtLegacyIndex(
              state,
              playerId,
              action.destinationZone,
              action.targetIndex
            );
            if (!targetStack) {
              return failure({
                code: 'source_state_mismatch',
                recordIndex: action.recordIndex,
                path: `$[${action.recordIndex}].parameters[4]`,
                message:
                  'Recorded staged-card destination does not identify a current stack top',
              });
            }
            const card = state.cards[source.cardId]!;
            const problem = apply({
              type: 'PlaceCardOnPlayStack',
              playerId,
              cardId: source.cardId,
              expectedSourceId: source.workAreaId,
              targetStackId: targetStack.id,
              expectedTargetTopCardId: targetStack.evolutionCardIds.at(-1)!,
              mode:
                card.currentCategory === 'Pokémon' ? 'evolution' : 'attachment',
            });
            if (problem) return problem;
            break;
          }

          const problem =
            action.mode === 'bottom'
              ? apply({
                  type: 'MoveCardToDeckBottom',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                })
              : action.destinationZone === 'stadium'
                ? apply({
                    type: 'MoveCardToStadium',
                    playerId,
                    cardId: source.cardId,
                    expectedSourceId: source.workAreaId,
                    expectedStadiumCardId:
                      state.zones[stadiumZoneId()]?.cardIds[0] ?? null,
                  })
                : apply({
                    type: 'MoveStagedCard',
                    cardId: source.cardId,
                    expectedWorkAreaId: source.workAreaId,
                    destinationZoneId: candidateDestinationZoneId(
                      playerId,
                      action.destinationZone
                    ),
                  });
          if (problem) return problem;
          break;
        }

        const sourceZoneId = candidateSourceZoneId(playerId, action.sourceZone);
        if (!sourceZoneId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Current closed candidate cannot resolve this legacy source container',
          });
        }
        const cardId = candidateSourceCardId(
          state,
          playerId,
          sourceZoneId,
          action.sourceZone,
          action.sourceIndex
        );
        if (!cardId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[3]`,
            message:
              'Recorded move-card source coordinate does not identify the current player card',
          });
        }

        if (
          action.destinationZone === 'active' ||
          action.destinationZone === 'bench'
        ) {
          const targetStack =
            typeof action.targetIndex === 'number'
              ? candidatePlayStackTopAtLegacyIndex(
                  state,
                  playerId,
                  action.destinationZone,
                  action.targetIndex
                )
              : null;
          if (typeof action.targetIndex === 'number' && !targetStack) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[4]`,
              message:
                'Recorded target coordinate does not identify a current active/bench stack top',
            });
          }
          const card = state.cards[cardId]!;
          const problem = targetStack
            ? apply({
                type: 'PlaceCardOnPlayStack',
                playerId,
                cardId,
                expectedSourceId: sourceZoneId,
                targetStackId: targetStack.id,
                expectedTargetTopCardId: targetStack.evolutionCardIds.at(-1)!,
                mode:
                  card.currentCategory === 'Pokémon'
                    ? 'evolution'
                    : 'attachment',
              })
            : apply({
                type: 'MoveCardToPlay',
                cardId,
                expectedSourceZoneId: sourceZoneId,
                boardPlayerId: playerId,
                slot: action.destinationZone,
              });
          if (problem) return problem;
          break;
        }

        const destinationZoneId =
          action.mode === 'bottom'
            ? playerZoneId(playerId, 'deck')
            : action.destinationZone === 'stadium'
              ? stadiumZoneId()
              : candidateDestinationZoneId(playerId, action.destinationZone);
        const destination = state.zones[destinationZoneId];
        if (
          sourceZoneId === destinationZoneId &&
          action.sourceIndex === (destination?.cardIds.length ?? 0) - 1
        ) {
          break;
        }

        const problem =
          action.mode === 'bottom'
            ? apply({
                type: 'MoveCardToDeckBottom',
                playerId,
                cardId,
                expectedSourceId: sourceZoneId,
              })
            : action.destinationZone === 'stadium'
              ? apply({
                  type: 'MoveCardToStadium',
                  playerId,
                  cardId,
                  expectedSourceId: sourceZoneId,
                  expectedStadiumCardId: destination?.cardIds[0] ?? null,
                })
              : apply({
                  type: 'MoveCard',
                  cardId,
                  expectedSourceZoneId: sourceZoneId,
                  destinationZoneId,
                });
        if (problem) return problem;
        break;
      }
      case 'leaveAll': {
        const resolution = state.workAreas[playerId]?.attachmentResolution;
        const board = state.boards[playerId];
        const evolutionCards = resolution?.evolutionCardIds.map(
          (cardId) => state.cards[cardId]
        );
        const attachmentCards = resolution?.attachmentCardIds.map(
          (cardId) => state.cards[cardId]
        );
        if (
          !resolution ||
          !board ||
          !evolutionCards ||
          evolutionCards.length === 0 ||
          evolutionCards.some(
            (card) =>
              !card ||
              card.ownerId !== playerId ||
              card.currentCategory !== 'Pokémon'
          ) ||
          !attachmentCards ||
          attachmentCards.some(
            (card) =>
              !card ||
              card.ownerId !== playerId ||
              card.currentCategory === 'Pokémon'
          )
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded leave-all source does not identify an exact restorable staged stack',
          });
        }
        const problem = apply({
          type: 'RestoreStagedStack',
          playerId,
          expectedWorkAreaId: resolution.id,
          expectedActiveStackId: board.activeStackId,
          expectedBenchStackIds: [...board.benchStackIds],
          destinationSlot: action.destinationSlot,
        });
        if (problem) return problem;
        break;
      }
      case 'discardAll':
      case 'lostZoneAll':
      case 'handAll': {
        const destinationKind =
          action.type === 'discardAll'
            ? 'discard'
            : action.type === 'lostZoneAll'
              ? 'lostZone'
              : 'hand';
        const destinationZoneId = playerZoneId(playerId, destinationKind);
        const destination = state.zones[destinationZoneId];
        if (action.sourceZone === 'viewCards') {
          const inspection = candidateInspectionCardsInLegacyOrder(
            state,
            playerId
          );
          if (!inspection) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[1]`,
              message:
                'Recorded inspection bulk source does not identify a current same-owner deck-inspection work area',
            });
          }
          if (
            !destination ||
            destination.cardIds.length + inspection.cardIds.length >
              MAX_DECK_CARDS
          ) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[1]`,
              message:
                'Recorded inspection bulk move exceeds the current destination capacity',
            });
          }
          const problem = apply({
            type: 'ResolveInspectionCards',
            playerId,
            expectedWorkAreaId: inspection.workAreaId,
            destination: destinationKind,
          });
          if (problem) return problem;
          break;
        }

        const staged = candidateStagedCardsInLegacyOrder(state, playerId);
        if (!staged) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded staged bulk source does not identify a current same-owner work area',
          });
        }
        if (
          !destination ||
          destination.cardIds.length + staged.legacyCardIds.length >
            MAX_DECK_CARDS
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded staged bulk move exceeds the current destination capacity',
          });
        }
        for (const cardId of staged.legacyCardIds) {
          const problem = apply({
            type: 'MoveStagedCard',
            cardId,
            expectedWorkAreaId: staged.workAreaId,
            destinationZoneId,
          });
          if (problem) return problem;
        }
        break;
      }
      case 'shuffleAll':
      case 'shuffleBottom': {
        const deckId = playerZoneId(playerId, 'deck');
        const deck = state.zones[deckId];
        if (action.sourceZone === 'viewCards') {
          const inspection = candidateInspectionCardsInLegacyOrder(
            state,
            playerId
          );
          if (!inspection) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[1]`,
              message:
                'Recorded inspection shuffle source does not identify a current same-owner deck-inspection work area',
            });
          }
          if (
            !deck ||
            deck.cardIds.length + inspection.cardIds.length > MAX_DECK_CARDS
          ) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded inspection shuffle exceeds the current deck capacity',
            });
          }
          const shuffleBasisLength =
            action.type === 'shuffleAll'
              ? deck.cardIds.length + inspection.cardIds.length
              : inspection.cardIds.length;
          if (action.shuffleIndices.length !== shuffleBasisLength) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded inspection shuffle length does not match its exact V1 permutation basis',
            });
          }
          const problem = apply(
            {
              type: 'ResolveInspectionCards',
              playerId,
              expectedWorkAreaId: inspection.workAreaId,
              destination:
                action.type === 'shuffleAll'
                  ? 'shuffleIntoDeck'
                  : 'shuffleToDeckBottom',
            },
            { kind: 'shuffle', indices: action.shuffleIndices }
          );
          if (problem) return problem;
          break;
        }

        const staged = candidateStagedCardsInLegacyOrder(state, playerId);
        if (!staged) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded staged shuffle source does not identify a current same-owner work area',
          });
        }
        if (
          !deck ||
          deck.cardIds.length + staged.canonicalCardIds.length > MAX_DECK_CARDS
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded staged shuffle exceeds the current deck capacity',
          });
        }
        const legacyShuffleBasis =
          action.type === 'shuffleAll'
            ? [...deck.cardIds, ...staged.legacyCardIds]
            : staged.legacyCardIds;
        const canonicalShuffleBasis =
          action.type === 'shuffleAll'
            ? [...deck.cardIds, ...staged.canonicalCardIds]
            : staged.canonicalCardIds;
        const canonicalShuffleIndices = translateLegacyShuffleBasis(
          legacyShuffleBasis,
          canonicalShuffleBasis,
          action.shuffleIndices
        );
        if (!canonicalShuffleIndices) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded staged shuffle length does not match its exact V1 permutation basis',
          });
        }
        const problem = apply(
          {
            type: 'ResolveStagedCards',
            playerId,
            expectedWorkAreaId: staged.workAreaId,
            destination:
              action.type === 'shuffleAll'
                ? 'shuffleIntoDeck'
                : 'shuffleToDeckBottom',
          },
          { kind: 'shuffle', indices: canonicalShuffleIndices }
        );
        if (problem) return problem;
        break;
      }
      case 'shuffleZone': {
        const zoneId = playerZoneId(playerId, action.zone);
        const zone = state.zones[zoneId];
        if (!zone || action.shuffleIndices.length !== zone.cardIds.length) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded prize shuffle length does not match the source-state zone',
          });
        }
        const problem = apply(
          { type: 'ShuffleZone', zoneId },
          { kind: 'shuffle', indices: action.shuffleIndices }
        );
        if (problem) return problem;
        break;
      }
      case 'moveToDeckTop': {
        if (action.sourceZone === 'attachedCards') {
          const source = candidateStagedCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded move-to-top source coordinate does not identify a current staged card',
            });
          }
          const problem = apply({
            type: 'MoveCardToDeckTop',
            playerId,
            cardId: source.cardId,
            expectedSourceId: source.workAreaId,
          });
          if (problem) return problem;
          break;
        }

        if (action.sourceZone === 'viewCards') {
          const source = candidateInspectionCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded move-to-top source coordinate does not identify a current deck-inspection card',
            });
          }
          const problem = apply({
            type: 'MoveCardToDeckTop',
            playerId,
            cardId: source.cardId,
            expectedSourceId: source.workAreaId,
          });
          if (problem) return problem;
          break;
        }

        const sourceZoneId = candidateSourceZoneId(playerId, action.sourceZone);
        if (!sourceZoneId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Current closed candidate cannot resolve this legacy source container',
          });
        }
        const cardId = candidateSourceCardId(
          state,
          playerId,
          sourceZoneId,
          action.sourceZone,
          action.sourceIndex
        );
        if (!cardId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded move-to-top source coordinate does not identify the current player card',
          });
        }

        const deckId = playerZoneId(playerId, 'deck');
        if (sourceZoneId === deckId && action.sourceIndex === 0) break;

        const problem = apply({
          type: 'MoveCardToDeckTop',
          playerId,
          cardId,
          expectedSourceId: sourceZoneId,
        });
        if (problem) return problem;
        break;
      }
      case 'shuffleIntoDeck': {
        if (action.sourceZone === 'attachedCards') {
          const source = candidateStagedCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded shuffle-into-deck source coordinate does not identify a current staged card',
            });
          }
          const deck = state.zones[playerZoneId(playerId, 'deck')]!;
          if (action.shuffleIndices.length !== deck.cardIds.length + 1) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded shuffle-into-deck length does not match the post-move source deck',
            });
          }
          const problem = apply(
            {
              type: 'ShuffleCardIntoDeck',
              playerId,
              cardId: source.cardId,
              expectedSourceId: source.workAreaId,
            },
            { kind: 'shuffle', indices: action.shuffleIndices }
          );
          if (problem) return problem;
          break;
        }

        if (action.sourceZone === 'viewCards') {
          const source = candidateInspectionCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded shuffle-into-deck source coordinate does not identify a current deck-inspection card',
            });
          }
          const deck = state.zones[playerZoneId(playerId, 'deck')]!;
          if (action.shuffleIndices.length !== deck.cardIds.length + 1) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[3]`,
              message:
                'Recorded shuffle-into-deck length does not match the post-move source deck',
            });
          }
          const problem = apply(
            {
              type: 'ShuffleCardIntoDeck',
              playerId,
              cardId: source.cardId,
              expectedSourceId: source.workAreaId,
            },
            { kind: 'shuffle', indices: action.shuffleIndices }
          );
          if (problem) return problem;
          break;
        }

        const sourceZoneId = candidateSourceZoneId(playerId, action.sourceZone);
        if (!sourceZoneId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Current closed candidate cannot resolve this legacy source container',
          });
        }
        const cardId = candidateSourceCardId(
          state,
          playerId,
          sourceZoneId,
          action.sourceZone,
          action.sourceIndex
        );
        if (!cardId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded shuffle-into-deck source coordinate does not identify the current player card',
          });
        }

        const deckId = playerZoneId(playerId, 'deck');
        const deck = state.zones[deckId]!;
        const sourceIsDeck = sourceZoneId === deckId;
        const expectedShuffleCount =
          deck.cardIds.length + (sourceIsDeck ? 0 : 1);
        if (action.shuffleIndices.length !== expectedShuffleCount) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[3]`,
            message:
              'Recorded shuffle-into-deck length does not match the post-move source deck',
          });
        }
        const canonicalShuffleIndices = sourceIsDeck
          ? translateLegacyInDeckShuffle(
              deck.cardIds.length,
              action.sourceIndex,
              action.shuffleIndices
            )
          : action.shuffleIndices;
        const problem = apply(
          {
            type: 'ShuffleCardIntoDeck',
            playerId,
            cardId,
            expectedSourceId: sourceZoneId,
          },
          { kind: 'shuffle', indices: canonicalShuffleIndices }
        );
        if (problem) return problem;
        break;
      }
      case 'switchWithDeckTop': {
        if (action.sourceZone === 'attachedCards') {
          const source = candidateStagedCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded deck-top-switch source coordinate does not identify a current staged card',
            });
          }
          const deck = state.zones[playerZoneId(playerId, 'deck')];
          const problem = apply(
            deck?.cardIds[0]
              ? {
                  type: 'SwapCardWithDeckTop',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                  stagedReturnTo: 'legacyFlatTailV1',
                }
              : {
                  type: 'MoveCardToDeckTop',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                }
          );
          if (problem) return problem;
          break;
        }
        if (action.sourceZone === 'viewCards') {
          const source = candidateInspectionCardAtLegacyIndex(
            state,
            playerId,
            action.sourceIndex
          );
          if (!source) {
            return failure({
              code: 'source_state_mismatch',
              recordIndex: action.recordIndex,
              path: `$[${action.recordIndex}].parameters[2]`,
              message:
                'Recorded deck-top-switch source coordinate does not identify a current inspection card',
            });
          }
          const deck = state.zones[playerZoneId(playerId, 'deck')];
          const problem = apply(
            deck?.cardIds[0]
              ? {
                  type: 'SwapCardWithDeckTop',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                  inspectionReturnTo: 'sourceTail',
                }
              : {
                  type: 'MoveCardToDeckTop',
                  playerId,
                  cardId: source.cardId,
                  expectedSourceId: source.workAreaId,
                }
          );
          if (problem) return problem;
          break;
        }
        const sourceZoneId = candidateSourceZoneId(playerId, action.sourceZone);
        if (!sourceZoneId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Current closed candidate cannot resolve this legacy source container',
          });
        }
        const cardId = candidateSourceCardId(
          state,
          playerId,
          sourceZoneId,
          action.sourceZone,
          action.sourceIndex
        );
        if (!cardId) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[2]`,
            message:
              'Recorded deck-top-switch source coordinate does not identify the current player card',
          });
        }

        const deckId = playerZoneId(playerId, 'deck');
        const previousDeckTopId = state.zones[deckId]?.cardIds[0];
        const moveSelectedProblem = apply({
          type: 'MoveCardToDeckTop',
          playerId,
          cardId,
          expectedSourceId: sourceZoneId,
        });
        if (moveSelectedProblem) return moveSelectedProblem;

        if (previousDeckTopId) {
          const returnTopProblem = apply({
            type: 'MoveCard',
            cardId: previousDeckTopId,
            expectedSourceZoneId: deckId,
            destinationZoneId: sourceZoneId,
          });
          if (returnTopProblem) return returnTopProblem;
        }
        break;
      }
      case 'shufflePrizesToDeckBottom': {
        const prizesId = playerZoneId(playerId, 'prizes');
        const prizes = state.zones[prizesId];
        if (
          !prizes ||
          prizes.cardIds.length === 0 ||
          action.shuffleIndices.length !== prizes.cardIds.length
        ) {
          return failure({
            code: 'source_state_mismatch',
            recordIndex: action.recordIndex,
            path: `$[${action.recordIndex}].parameters[1]`,
            message:
              'Recorded shuffled-prize length does not match the non-empty source-state prize zone',
          });
        }

        const problem = apply(
          { type: 'MovePrizesToDeckBottom', playerId },
          { kind: 'shuffle', indices: action.shuffleIndices }
        );
        if (problem) return problem;
        break;
      }
    }
    // V1 automatically removes a special-condition node when its exact host
    // top evolves, leaves play, or moves off the active slot. Canonical movement
    // already clears the value; this keeps private source-node presence aligned
    // so a later markerless update still fails closed.
    for (const [stackId, topCardId] of sourceSpecialConditionTopCardIds) {
      const stack = state.stacks[stackId];
      if (
        !stack ||
        stack.slot !== 'active' ||
        stack.evolutionCardIds.at(-1) !== topCardId
      ) {
        sourceSpecialConditionTopCardIds.delete(stackId);
      }
    }

    if (action.type !== 'loadDeckData' && action.type !== 'undo') {
      undoHistory.push({
        recordIndex: action.recordIndex,
        player: action.player,
        checkpoint: stateBeforeAction,
        sourceDamageMarkerStackIds: damageMarkersBeforeAction,
        sourceSpecialConditionTopCardIds: specialConditionsBeforeAction,
      });
      if (undoHistory.length > MAX_LEGACY_V1_UNDO_CHECKPOINTS) {
        undoHistory.shift();
      }
    }

    records.push({
      recordIndex: action.recordIndex,
      action: action.type,
      batches,
    });
  }

  try {
    assertMatchInvariants(state);
    const replayed = records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    assertMatchInvariants(replayed);
    if (stableSerialize(replayed) !== stableSerialize(state)) {
      throw new Error('Legacy candidate does not match event replay');
    }
  } catch {
    return failure({
      code: 'canonical_error',
      recordIndex: null,
      path: '$',
      message: 'Canonical legacy candidate failed final validation',
    });
  }

  return { ok: true, state, records };
};
