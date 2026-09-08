import {
  applyEventBatch,
  assertMatchInvariants,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  stableSerialize,
  stadiumZoneId,
  type CommandRejectionCode,
  type EventBatch,
  type GameCommand,
  type MatchId,
  type MatchSeatInput,
  type MatchState,
  type PlayerId,
} from '@ptcgsim/game-core';

import {
  decodeLegacyV1Decks,
  type LegacyV1DeckDecodeIssueCode,
} from './decode-decks.js';
import {
  decodeLegacyV1LifecycleActions,
  type LegacyV1LifecycleAction,
  type LegacyV1LifecycleDecodeIssueCode,
} from './decode-lifecycle.js';
import {
  decodeLegacyV1MovementActions,
  type LegacyV1CardSourceZone,
  type LegacyV1MovementAction,
  type LegacyV1MovementDecodeIssueCode,
} from './decode-movement.js';
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
  'shuffleZone',
  'moveToDeckTop',
  'shuffleIntoDeck',
  'switchWithDeckTop',
  'shufflePrizesToDeckBottom',
]);

type LegacyV1ConvertedAction = LegacyV1LifecycleAction | LegacyV1MovementAction;

export interface LegacyV1CandidateTarget {
  readonly matchId: MatchId;
  readonly selfSeat: MatchSeatInput;
  readonly opponentSeat: MatchSeatInput;
}

export type LegacyV1CandidateIssueCode =
  | 'unsupported_action'
  | 'decoder_coverage_error'
  | 'invalid_target'
  | 'source_state_mismatch'
  | 'canonical_error'
  | `deck.${LegacyV1DeckDecodeIssueCode}`
  | `lifecycle.${LegacyV1LifecycleDecodeIssueCode}`
  | `movement.${LegacyV1MovementDecodeIssueCode}`
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

  const convertedActions: LegacyV1ConvertedAction[] = [
    ...decodedLifecycle.actions,
    ...decodedMovement.actions,
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
