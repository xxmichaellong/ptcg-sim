import {
  applyEventBatch,
  cloneMatchState,
  stableHash,
  stableSerialize,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';

import {
  MAX_REPLAY_EVENT_BYTES,
  type ReplayHistory,
  type ReplayHistoryEntry,
} from './model.js';

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(stableSerialize(value)).byteLength;

export const replayHistoryEventBytes = (history: ReplayHistory): number =>
  utf8Bytes(history.entries);

export const createReplayHistory = (state: MatchState): ReplayHistory => {
  const baseState = cloneMatchState(state);
  return {
    baseState,
    baseStateHash: stableHash(baseState),
    entries: [],
  };
};

export const cloneReplayHistory = (history: ReplayHistory): ReplayHistory => ({
  baseState: cloneMatchState(history.baseState),
  baseStateHash: history.baseStateHash,
  entries: history.entries.map((entry) => ({
    batch: structuredClone(entry.batch),
    resultingStateHash: entry.resultingStateHash,
  })),
});

const applyReplayEntry = (
  state: MatchState,
  entry: ReplayHistoryEntry
): MatchState => {
  const next = applyEventBatch(state, entry.batch);
  if (stableHash(next) !== entry.resultingStateHash) {
    throw new Error('Replay history result hash does not match');
  }
  return next;
};

export const appendReplayHistory = (
  history: ReplayHistory,
  batch: EventBatch,
  resultingState: MatchState,
  maximumEntries: number,
  maximumEventBytes = MAX_REPLAY_EVENT_BYTES
): ReplayHistory => {
  if (batch.revision !== resultingState.revision) {
    throw new Error('Replay batch and resulting state revisions differ');
  }
  let baseState = history.baseState;
  let baseStateHash = history.baseStateHash;
  const entry: ReplayHistoryEntry = {
    batch: structuredClone(batch),
    resultingStateHash: stableHash(resultingState),
  };
  const entries = [...history.entries, entry];
  while (
    entries.length > maximumEntries ||
    utf8Bytes(entries) > maximumEventBytes
  ) {
    const removed = entries.shift();
    if (!removed) break;
    baseState = applyReplayEntry(baseState, removed);
    baseStateHash = stableHash(baseState);
  }
  return {
    baseState,
    baseStateHash,
    entries,
  };
};

export const replayHistoryStates = (
  history: ReplayHistory
): readonly MatchState[] => {
  const states: MatchState[] = [cloneMatchState(history.baseState)];
  for (const entry of history.entries) {
    states.push(applyReplayEntry(states.at(-1)!, entry));
  }
  return states;
};
