import { useSyncExternalStore } from 'react';

import type { FriendPresence } from './friends-api.js';

/**
 * Where each friend is (ADR-055 presence), as the account last said: the
 * list fills it when read (friends-state.ts) and the live line changes it
 * as friends come and go (friends-live.ts). Nothing here is stored.
 */

let presence: ReadonlyMap<string, FriendPresence> = new Map();
let version = 0;
const listeners = new Set<() => void>();

const publish = (next: ReadonlyMap<string, FriendPresence>): void => {
  presence = next;
  version += 1;
  for (const listener of listeners) listener();
};

export const subscribePresence = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const presenceOf = (id: string): FriendPresence | undefined =>
  presence.get(id);

/** Everyone's presence at once, as the account first says it. */
export const replacePresence = (
  entries: Readonly<Record<string, FriendPresence>>
): void => publish(new Map(Object.entries(entries)));

/** One friend's presence changed. */
export const updatePresence = (id: string, entry: FriendPresence): void => {
  const next = new Map(presence);
  next.set(id, entry);
  publish(next);
};

export const clearPresence = (): void => {
  if (presence.size > 0) publish(new Map());
};

export const usePresence = (id: string): FriendPresence | undefined =>
  useSyncExternalStore(
    subscribePresence,
    () => presence.get(id),
    () => presence.get(id)
  );

/** Re-renders on any presence change; the map itself. */
export const usePresenceMap = (): ReadonlyMap<string, FriendPresence> => {
  useSyncExternalStore(
    subscribePresence,
    () => version,
    () => version
  );
  return presence;
};
