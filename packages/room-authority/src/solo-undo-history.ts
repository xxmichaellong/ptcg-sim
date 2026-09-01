import {
  applyEventBatch,
  cloneMatchState,
  stableHash,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';

import type {
  SoloUndoCheckpoint,
  SoloUndoHistory,
  SoloUndoHistoryEntry,
} from './model.js';

export const emptySoloUndoHistory = (): SoloUndoHistory => ({
  baseState: null,
  baseStateHash: null,
  entries: [],
});

export const cloneSoloUndoHistory = (
  history: SoloUndoHistory
): SoloUndoHistory => ({
  baseState: history.baseState ? cloneMatchState(history.baseState) : null,
  baseStateHash: history.baseStateHash,
  entries: history.entries.map((entry) => ({
    ...entry,
    events: structuredClone(entry.events),
  })),
});

const applyHistoryEntry = (
  state: MatchState,
  entry: SoloUndoHistoryEntry
): MatchState => {
  const checkpointState = { ...state, revision: entry.checkpointRevision };
  if (stableHash(checkpointState) !== entry.checkpointHash) {
    throw new Error('Solo undo history checkpoint hash does not match');
  }
  return applyEventBatch(checkpointState, {
    revision: entry.revertedRevision,
    events: entry.events,
  });
};

export const materializeSoloUndoCheckpoint = (
  history: SoloUndoHistory
): SoloUndoCheckpoint | undefined => {
  const latest = history.entries.at(-1);
  if (!latest || !history.baseState) return undefined;
  let state = cloneMatchState(history.baseState);
  for (const entry of history.entries.slice(0, -1)) {
    state = applyHistoryEntry(state, entry);
  }
  state = { ...state, revision: latest.checkpointRevision };
  if (stableHash(state) !== latest.checkpointHash) {
    throw new Error('Solo undo history cannot restore its latest checkpoint');
  }
  return {
    state,
    stateHash: latest.checkpointHash,
    revertedCommandId: latest.revertedCommandId,
    revertedRevision: latest.revertedRevision,
  };
};

export const appendSoloUndoHistory = (
  history: SoloUndoHistory,
  checkpointState: MatchState,
  revertedCommandId: string,
  eventBatch: EventBatch,
  maximumEntries: number
): SoloUndoHistory => {
  let baseState = history.baseState
    ? cloneMatchState(history.baseState)
    : cloneMatchState(checkpointState);
  const entry: SoloUndoHistoryEntry = {
    checkpointRevision: checkpointState.revision,
    checkpointHash: stableHash(checkpointState),
    revertedCommandId,
    revertedRevision: eventBatch.revision,
    events: structuredClone(eventBatch.events),
  };
  let entries = [...history.entries, entry];
  while (entries.length > maximumEntries) {
    const removed = entries.shift();
    if (!removed) break;
    baseState = applyHistoryEntry(baseState, removed);
  }
  return {
    baseState,
    baseStateHash: stableHash(baseState),
    entries,
  };
};

export const popSoloUndoHistory = (
  history: SoloUndoHistory
): SoloUndoHistory => ({
  ...cloneSoloUndoHistory(history),
  entries: history.entries.slice(0, -1).map((entry) => ({
    ...entry,
    events: structuredClone(entry.events),
  })),
});

export const replaySoloUndoHistory = (
  history: SoloUndoHistory,
  currentRevision: number
): MatchState | undefined => {
  if (!history.baseState) return undefined;
  let state = cloneMatchState(history.baseState);
  for (const entry of history.entries) state = applyHistoryEntry(state, entry);
  return { ...state, revision: currentRevision };
};
