import {
  applyEventBatch,
  stableHash,
  type MatchState,
  type PlayerId,
} from '@ptcgsim/game-core';

import type {
  AuthorityMode,
  ReplayHistory,
  ReplayHistoryEntry,
  UndoCheckpoint,
} from './model.js';

const hasEvent = (entry: ReplayHistoryEntry, type: string): boolean =>
  entry.batch.events.some((event) => event.type === type);

/**
 * The moves undo can still take back, oldest first. An undo pops the move it
 * reverted; loading a deck replaces every card identity, so nothing before it
 * can be restored. Moves older than the history's base were compacted away and
 * their checkpoints are gone, which is why the scan starts at the base.
 */
const undoStack = (history: ReplayHistory): ReplayHistoryEntry[] => {
  const stack: ReplayHistoryEntry[] = [];
  for (const entry of history.entries) {
    if (hasEvent(entry, 'UndoApplied')) stack.pop();
    else if (hasEvent(entry, 'DeckLoaded')) stack.length = 0;
    else stack.push(entry);
  }
  return stack;
};

/** The state at `revision`, rebuilt from the history's base. */
const stateAtRevision = (
  history: ReplayHistory,
  revision: number
): { readonly state: MatchState; readonly stateHash: string } | undefined => {
  if (history.baseState.revision === revision) {
    return { state: history.baseState, stateHash: history.baseStateHash };
  }
  let state = history.baseState;
  for (const entry of history.entries) {
    state = applyEventBatch(state, entry.batch);
    if (entry.batch.revision !== revision) continue;
    // Every entry was verified when it was appended; one hash here proves the
    // rebuilt checkpoint is the state the room actually held.
    const stateHash = stableHash(state);
    if (stateHash !== entry.resultingStateHash) {
      throw new Error('Undo checkpoint does not match its replay history');
    }
    return { state, stateHash };
  }
  return undefined;
};

/**
 * The checkpoint an undo by `playerId` would restore, or undefined when there
 * is nothing it may take back.
 *
 * Solo has one controller acting for both seats, so it takes back whatever
 * happened last. In multiplayer a player takes back only their own move, and
 * only while it is still the newest one standing: once the opponent has acted
 * on top of it, it is part of the shared game.
 */
export const undoCheckpointFor = (
  history: ReplayHistory,
  mode: AuthorityMode,
  playerId: PlayerId
): UndoCheckpoint | undefined => {
  const reverted = undoStack(history).at(-1);
  if (!reverted) return undefined;
  const issuer = reverted.batch.issuer;
  if (mode === 'multiplayer' && issuer?.playerId !== playerId) {
    return undefined;
  }
  const revertedRevision = reverted.batch.revision;
  const checkpoint = stateAtRevision(history, revertedRevision - 1);
  if (!checkpoint) return undefined;
  return {
    state: checkpoint.state,
    stateHash: checkpoint.stateHash,
    // Batches recorded before the issuer was kept still need a stable id.
    revertedCommandId: issuer?.commandId ?? `revision:${revertedRevision}`,
    revertedRevision,
  };
};
