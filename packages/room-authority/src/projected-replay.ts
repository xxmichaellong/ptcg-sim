import type { MatchViewState, ViewerRole } from '@ptcgsim/game-core';
import type { PresentationEvent } from '@ptcgsim/protocol';

import {
  emptyProjectionIdentityState,
  projectRecipient,
  type OpaqueIdSource,
} from './identity-registry.js';
import type { ReplayHistory } from './model.js';
import { presentationEventsForBatch } from './presentation-events.js';
import { replayHistoryStates } from './replay-history.js';

export interface ProjectedReplayFrame {
  readonly snapshot: MatchViewState;
  readonly presentationEvents: readonly PresentationEvent[];
}

export interface ProjectedReplay {
  readonly viewer: ViewerRole;
  readonly startRevision: number;
  readonly endRevision: number;
  readonly truncated: boolean;
  readonly frames: readonly ProjectedReplayFrame[];
}

/**
 * Reconstructs canonical history only inside the authority boundary, then
 * emits a fresh, viewer-scoped opaque projection for every retained revision.
 */
export const buildProjectedReplay = (
  history: ReplayHistory,
  viewer: ViewerRole,
  opaqueIds: OpaqueIdSource
): ProjectedReplay => {
  if (viewer.kind === 'player' && !history.baseState.players[viewer.playerId]) {
    throw new Error('Replay viewer is not a player in this match');
  }
  const states = replayHistoryStates(history);
  let identities = emptyProjectionIdentityState();
  const frames: ProjectedReplayFrame[] = [];
  for (const [index, state] of states.entries()) {
    const entry = index === 0 ? undefined : history.entries[index - 1];
    if (entry?.batch.events.some((event) => event.type === 'UndoApplied')) {
      // Undo restores an older visibility generation. Rotating all replay-local
      // aliases prevents correlation with identities from the discarded branch.
      identities = emptyProjectionIdentityState();
    }
    const projected = projectRecipient(state, viewer, identities, opaqueIds);
    identities = projected.identities;
    frames.push({
      snapshot: projected.snapshot,
      presentationEvents: entry ? presentationEventsForBatch(entry.batch) : [],
    });
  }
  const startRevision = frames[0]!.snapshot.revision;
  return {
    viewer:
      viewer.kind === 'player'
        ? { kind: 'player', playerId: viewer.playerId }
        : { kind: 'spectator' },
    startRevision,
    endRevision: frames.at(-1)!.snapshot.revision,
    truncated: startRevision > 0,
    frames,
  };
};
