import { useEffect } from 'react';

import { accountSnapshot, subscribeAccount } from '../account/account-state.js';
import { readPresence, readPresenceMap } from './friends-api.js';
import {
  clearPresence,
  replacePresence,
  updatePresence,
} from './friends-presence.js';
import { changedJustNow, refreshFriends } from './friends-state.js';

/**
 * The signed-in tab's live line to its account (ADR-055 presence): one
 * WebSocket to the account's own object, open while someone is signed in.
 * The tab says where it is (a room, as player or spectator, or none); the
 * account answers with its friends' presence and tells of changes as they
 * come: a friend's new state, the list changed, an invite (step 3).
 * Pings every 50 s keep it open through proxies; the object answers them
 * without waking.
 */

export type LiveWhere =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'room';
      readonly role: 'player' | 'spectator';
      readonly room: string;
    };

const PING_EVERY_MS = 50_000;
/** Waits before trying again, longer each time. */
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

let where: LiveWhere = { kind: 'none' };
let socket: WebSocket | undefined;
let accountId: string | null = null;
let attempts = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let ping: ReturnType<typeof setInterval> | undefined;

const messageListeners = new Set<(message: unknown) => void>();

/** Hears the line's other messages (invites, step 3). */
export const onLiveMessage = (
  listener: (message: unknown) => void
): (() => void) => {
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
};

const send = (message: unknown): void => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const sameWhere = (left: LiveWhere, right: LiveWhere): boolean =>
  left.kind === right.kind &&
  (left.kind === 'none' ||
    (right.kind === 'room' &&
      left.role === right.role &&
      left.room === right.room));

/** Where this tab is now: the room route says, as it changes. */
export const reportWhere = (next: LiveWhere): void => {
  if (sameWhere(where, next)) return;
  where = next;
  send({ type: 'where', where });
};

const received = (data: unknown): void => {
  const type: unknown = Reflect.get(Object(data), 'type');
  if (type === 'presence') {
    const all: unknown = Reflect.get(Object(data), 'friends');
    if (all && typeof all === 'object') {
      replacePresence(readPresenceMap(all));
      return;
    }
    const id: unknown = Reflect.get(Object(data), 'id');
    const presence = readPresence(Reflect.get(Object(data), 'view'));
    if (typeof id === 'string' && presence) updatePresence(id, presence);
    return;
  }
  if (type === 'friends') {
    // This tab's own change already brought the list.
    if (!changedJustNow()) void refreshFriends();
    return;
  }
  for (const listener of messageListeners) listener(data);
};

const stop = (): void => {
  if (retry !== undefined) clearTimeout(retry);
  if (ping !== undefined) clearInterval(ping);
  retry = undefined;
  ping = undefined;
  const closing = socket;
  socket = undefined;
  if (closing) {
    closing.onclose = null;
    closing.onmessage = null;
    try {
      closing.close(1000, 'signed out');
    } catch {
      // Already gone.
    }
  }
};

const connect = (): void => {
  if (!accountId || typeof WebSocket !== 'function') return;
  const url = new URL('/v2/account/live', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const opened = new WebSocket(url);
  socket = opened;
  opened.onopen = () => {
    attempts = 0;
    opened.send(JSON.stringify({ type: 'hello', where }));
    ping = setInterval(() => {
      if (opened.readyState === WebSocket.OPEN) opened.send('ping');
    }, PING_EVERY_MS);
  };
  opened.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string' || event.data === 'pong') return;
    try {
      received(JSON.parse(event.data));
    } catch {
      // Not a message of ours.
    }
  };
  opened.onclose = () => {
    if (ping !== undefined) clearInterval(ping);
    ping = undefined;
    if (socket !== opened) return;
    socket = undefined;
    if (!accountId) return;
    const wait = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)] ?? 30_000;
    attempts += 1;
    retry = setTimeout(() => {
      retry = undefined;
      // Signed out meanwhile, the account read again says so first.
      if (accountSnapshot().account?.id === accountId) connect();
    }, wait);
  };
};

/**
 * The room route says where this tab is; gone, it is nowhere (the Play
 * online page, between tables).
 */
export const FriendsWhere = ({
  where: next,
}: {
  readonly where: LiveWhere;
}): null => {
  const role = next.kind === 'room' ? next.role : undefined;
  const room = next.kind === 'room' ? next.room : undefined;
  useEffect(() => {
    reportWhere(room && role ? { kind: 'room', role, room } : { kind: 'none' });
  }, [role, room]);
  useEffect(() => () => reportWhere({ kind: 'none' }), []);
  return null;
};

/** Where this tab is, as last said. */
export const currentWhere = (): LiveWhere => where;

let started = false;

/** Opens the line while someone is signed in; the app calls it once. */
export const startFriendsLive = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const follow = (): void => {
    const next = accountSnapshot().account?.id ?? null;
    if (next === accountId) return;
    stop();
    clearPresence();
    accountId = next;
    attempts = 0;
    if (accountId) connect();
  };
  subscribeAccount(follow);
  follow();
  // Back online after a dropped connection: try at once.
  window.addEventListener('online', () => {
    if (accountId && !socket) {
      if (retry !== undefined) clearTimeout(retry);
      retry = undefined;
      attempts = 0;
      connect();
    }
  });
};
