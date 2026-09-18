import { useSyncExternalStore } from 'react';

import type {
  ReplaySessionCoordinator,
  ReplaySessionCoordinatorState,
} from './ReplaySessionCoordinator.js';

export type ReplaySessionStore = Pick<
  ReplaySessionCoordinator,
  'getSnapshot' | 'subscribe'
>;

/** React observes the coordinator; neither React nor a renderer owns replay. */
export const useReplaySession = (
  coordinator: ReplaySessionStore
): ReplaySessionCoordinatorState =>
  useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot
  );
