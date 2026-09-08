import {
  applyEventBatch,
  assertMatchInvariants,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  stableSerialize,
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
  'shuffleZone',
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
