import { ROOM_ALIAS_PATTERN } from '@ptcgsim/protocol';
import { useSyncExternalStore } from 'react';

import { friendsSnapshot, subscribeFriends } from './friends-state.js';

/**
 * Where each friend is (ADR-055 presence): Online, In a game, Watching or
 * Offline with when they were last seen. The live socket (friends-live.ts)
 * fills it as the presence hub tells the account; nothing here is stored.
 */

export const PRESENCE_STATES = [
  'online',
  'playing',
  'watching',
  'offline',
] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export interface FriendPresence {
  readonly state: PresenceState;
  /** Offline: when they were last seen. */
  readonly lastSeen?: number;
  /**
   * Their room's code, to join or watch through (never shown): only for
   * a friend in a game or watching who doesn't appear offline.
   */
  readonly room?: string;
}

const isPresenceState = (value: unknown): value is PresenceState =>
  (PRESENCE_STATES as readonly unknown[]).includes(value);

const ROOM_CODE = ROOM_ALIAS_PATTERN;

/** A presence from the server, checked. */
export const readPresence = (value: unknown): FriendPresence | undefined => {
  const state: unknown = Reflect.get(Object(value), 'state');
  const lastSeen: unknown = Reflect.get(Object(value), 'lastSeen');
  const room: unknown = Reflect.get(Object(value), 'room');
  if (!isPresenceState(state)) return undefined;
  return {
    state,
    ...(typeof lastSeen === 'number' ? { lastSeen } : {}),
    ...(typeof room === 'string' && ROOM_CODE.test(room) ? { room } : {}),
  };
};

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

/** Everyone's presence at once, as the account first hears it. */
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

const onlineCount = (): number =>
  friendsSnapshot().list.friends.filter((entry) => {
    const state = presence.get(entry.id)?.state;
    return state !== undefined && state !== 'offline';
  }).length;

/** How many friends are online now: the bar's count. */
export const useOnlineFriends = (): number =>
  useSyncExternalStore(
    (listener) => {
      const unsubscribePresence = subscribePresence(listener);
      const unsubscribeFriends = subscribeFriends(listener);
      return () => {
        unsubscribePresence();
        unsubscribeFriends();
      };
    },
    onlineCount,
    onlineCount
  );
