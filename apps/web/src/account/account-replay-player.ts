import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import { toast } from '../ui/toast.js';
import { fetchReplayPart, type ReplaySource } from './replay-api.js';
import { takeReplayLink } from './replay-link-capture.js';

/**
 * Watching a game kept in an account (ADR-053) on the table.
 *
 * A game is served in parts of up to 128 moves, each a replay file as any
 * other; the Solo table plays them with its own replay. Stepping on from a
 * part's last move loads the next, and back from its first, the one
 * before at its end, so a long game plays as one.
 *
 * The table that can play one says so (`registerReplayTable`): the live
 * Solo table, ready. A shared game's link waits for it, then plays.
 */

export interface ReplayTable {
  /** Plays a replay file; false if the table couldn't take it. */
  readonly play: (file: Uint8Array) => Promise<boolean>;
  /** Goes to the end of what is playing. */
  readonly toEnd: () => void;
}

interface Watching {
  readonly source: ReplaySource;
  readonly part: number;
  readonly parts: number;
  readonly replayId: string;
}

let table: ReplayTable | undefined;
let watching: Watching | undefined;
let loading = false;
const listeners = new Set<() => void>();

interface PlayerSnapshot {
  /** A table is there to play on. */
  readonly ready: boolean;
  readonly loading: boolean;
  readonly watching: Watching | undefined;
}

let snapshot: PlayerSnapshot = { ready: false, loading: false, watching };

const publish = (): void => {
  snapshot = { ready: table !== undefined, loading, watching };
  for (const listener of [...listeners]) listener();
};

export const useReplayTable = (): PlayerSnapshot =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );

const load = async (
  source: ReplaySource,
  part: number,
  atEnd = false
): Promise<boolean> => {
  const target = table;
  if (!target || loading) return false;
  loading = true;
  publish();
  try {
    const fetched = await fetchReplayPart(source, part);
    if (table !== target) return false;
    if (!(await target.play(fetched.file))) throw new Error('not played');
    watching = {
      source,
      part: fetched.part,
      parts: fetched.parts,
      replayId: fetched.replayId,
    };
    if (atEnd) target.toEnd();
    return true;
  } catch {
    toast({
      title: t`Couldn't load that game. Try again.`,
      tone: 'danger',
      id: 'account-replay',
    });
    return false;
  } finally {
    loading = false;
    publish();
  }
};

/** Plays a game from its first move. */
export const watchReplay = (source: ReplaySource): Promise<boolean> =>
  load(source, 0);

/** The table can play a game now; returns how to say it can't any more. */
export const registerReplayTable = (next: ReplayTable): (() => void) => {
  table = next;
  publish();
  const shared = takeReplayLink();
  if (shared) void load({ kind: 'shared', token: shared }, 0);
  return () => {
    if (table !== next) return;
    table = undefined;
    publish();
  };
};

/**
 * The part on from this one (or back), when the replay playing is an
 * account game's and there is one: true if it is loading it.
 */
export const stepAcrossParts = (
  direction: 'next' | 'previous',
  playing:
    | {
        readonly replayId: string;
        readonly atStart: boolean;
        readonly atEnd: boolean;
      }
    | undefined
): boolean => {
  if (!watching || !playing || playing.replayId !== watching.replayId) {
    return false;
  }
  if (
    direction === 'next' &&
    playing.atEnd &&
    watching.part < watching.parts - 1
  ) {
    void load(watching.source, watching.part + 1);
    return true;
  }
  if (direction === 'previous' && playing.atStart && watching.part > 0) {
    void load(watching.source, watching.part - 1, true);
    return true;
  }
  return false;
};

/** Which part is playing, when an account game with several is. */
export const playingPart = (
  replayId: string | undefined
): { readonly part: number; readonly parts: number } | undefined =>
  watching && watching.replayId === replayId && watching.parts > 1
    ? { part: watching.part, parts: watching.parts }
    : undefined;

/** The replay was left: nothing of a game is playing. */
export const stopWatching = (): void => {
  if (!watching) return;
  watching = undefined;
  publish();
};
