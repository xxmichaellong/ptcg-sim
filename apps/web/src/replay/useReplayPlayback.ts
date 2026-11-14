import type {
  ReplayPlaybackController,
  ReplayPlaybackState,
} from '@ptcgsim/client-session';
import { useSyncExternalStore } from 'react';

export type ReplayPlaybackStore = Pick<
  ReplayPlaybackController,
  'getSnapshot' | 'subscribe'
>;

/** React subscribes to playback; the controller remains renderer-neutral. */
export const useReplayPlayback = (
  playback: ReplayPlaybackStore
): ReplayPlaybackState =>
  useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
    playback.getSnapshot
  );
