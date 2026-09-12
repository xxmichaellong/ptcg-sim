import { collectInvariantProblems } from './invariants.js';
import type { MatchState } from './model.js';

const sameOrderedValues = <Value>(
  left: readonly Value[],
  right: readonly Value[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/**
 * Validates the state-level portion of an authority-approved undo checkpoint.
 * The authority remains responsible for proving that the checkpoint came from
 * its own bounded history rather than accepting it from a client.
 */
export const soloUndoCheckpointProblem = (
  current: MatchState,
  checkpoint: MatchState
): string | undefined => {
  if (checkpoint.schemaVersion !== current.schemaVersion) {
    return 'Undo checkpoint uses a different state schema';
  }
  if (checkpoint.matchId !== current.matchId) {
    return 'Undo checkpoint belongs to another match';
  }
  if (
    !Number.isSafeInteger(checkpoint.revision) ||
    checkpoint.revision < 0 ||
    checkpoint.revision >= current.revision
  ) {
    return 'Undo checkpoint revision is not earlier than current state';
  }
  if (checkpoint.rngVersion !== current.rngVersion) {
    return 'Undo checkpoint uses a different randomization version';
  }
  if (!sameOrderedValues(checkpoint.playerOrder, current.playerOrder)) {
    return 'Undo checkpoint changes the match seats';
  }
  const problems = collectInvariantProblems(checkpoint);
  return problems.length > 0
    ? `Undo checkpoint is invalid: ${problems[0]}`
    : undefined;
};
