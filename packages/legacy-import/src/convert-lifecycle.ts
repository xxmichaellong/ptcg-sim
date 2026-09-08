import {
  applyEventBatch,
  assertMatchInvariants,
  createEmptyMatch,
  executeCommand,
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

const LIFECYCLE_ACTIONS = new Set<LegacySynchronizedActionName>([
  'loadDeckData',
  'reset',
  'setup',
  'takeTurn',
]);

export interface LegacyV1LifecycleCandidateTarget {
  readonly matchId: MatchId;
  readonly selfSeat: MatchSeatInput;
  readonly opponentSeat: MatchSeatInput;
}

export type LegacyV1LifecycleCandidateIssueCode =
  | 'unsupported_action'
  | 'invalid_target'
  | 'canonical_error'
  | `deck.${LegacyV1DeckDecodeIssueCode}`
  | `lifecycle.${LegacyV1LifecycleDecodeIssueCode}`
  | `context.${LegacyV1ImportContextErrorCode}`
  | `command.${CommandRejectionCode}`;

export interface LegacyV1LifecycleCandidateIssue {
  readonly code: LegacyV1LifecycleCandidateIssueCode;
  readonly recordIndex: number | null;
  readonly path: string;
  readonly message: string;
}

export interface LegacyV1AppliedLifecycleRecord {
  readonly recordIndex: number;
  readonly action: LegacyV1LifecycleAction['type'];
  readonly batches: readonly EventBatch[];
}

export type LegacyV1LifecycleCandidateResult =
  | {
      readonly ok: true;
      readonly state: MatchState;
      readonly records: readonly LegacyV1AppliedLifecycleRecord[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1LifecycleCandidateIssue[];
    };

const failure = (
  issue: LegacyV1LifecycleCandidateIssue
): LegacyV1LifecycleCandidateResult => ({ ok: false, issues: [issue] });

const targetPlayerId = (
  target: LegacyV1LifecycleCandidateTarget,
  player: LegacyExportUser
): PlayerId =>
  player === 'self' ? target.selfSeat.playerId : target.opponentSeat.playerId;

/**
 * Builds a private canonical candidate only when every admitted record belongs
 * to the fully decoded lifecycle subset. Failures return no state, and callers
 * must discard the whole result rather than installing an intermediate batch.
 */
export const buildLegacyV1LifecycleCandidate = (
  parsed: ParsedLegacyExport,
  target: LegacyV1LifecycleCandidateTarget
): LegacyV1LifecycleCandidateResult => {
  const unsupportedIndex = parsed.actions.findIndex(
    (action) => !LIFECYCLE_ACTIONS.has(action.action)
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
  const records: LegacyV1AppliedLifecycleRecord[] = [];
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
        readonly issue: LegacyV1LifecycleCandidateIssue;
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
          message: 'Canonical lifecycle application failed',
        },
      };
    }
  };

  for (const action of decodedLifecycle.actions) {
    const playerId = targetPlayerId(target, action.player);
    const batches: EventBatch[] = [];
    const apply = (
      command: GameCommand,
      outcome?: LegacyV1ResolvedOutcome
    ): LegacyV1LifecycleCandidateResult | null => {
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
      throw new Error('Lifecycle candidate does not match event replay');
    }
  } catch {
    return failure({
      code: 'canonical_error',
      recordIndex: null,
      path: '$',
      message: 'Canonical lifecycle candidate failed final validation',
    });
  }

  return { ok: true, state, records };
};
