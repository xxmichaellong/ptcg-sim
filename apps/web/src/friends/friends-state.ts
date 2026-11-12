import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import { AccountRequestError } from '../account/account-api.js';
import {
  accountSnapshot,
  refreshAccount,
  subscribeAccount,
} from '../account/account-state.js';
import { toast } from '../ui/toast.js';
import {
  EMPTY_FRIENDS,
  fetchFriends,
  postFriendChange,
  putAppearOffline,
  type FriendAction,
  type FriendChangeAnswer,
  type FriendsList,
} from './friends-api.js';
import {
  clearPresence,
  presenceOf,
  replacePresence,
  subscribePresence,
} from './friends-presence.js';

/**
 * The signed-in player's friends (ADR-055), for every screen: read when
 * someone signs in, again when Friends opens, when the page comes back
 * into view, and when the live socket says the list changed
 * (friends-live.ts). Changes answer with the whole list, which replaces
 * this one.
 */

export interface FriendsSnapshot {
  readonly status: 'signed-out' | 'loading' | 'ready' | 'failed';
  readonly list: FriendsList;
  /** The account the list is for. */
  readonly accountId: string | null;
}

const SIGNED_OUT: FriendsSnapshot = Object.freeze({
  status: 'signed-out',
  list: EMPTY_FRIENDS,
  accountId: null,
});

let snapshot: FriendsSnapshot = SIGNED_OUT;
const listeners = new Set<() => void>();

const publish = (next: FriendsSnapshot): void => {
  snapshot = next;
  noticeRequests(next);
  // A list read with its friends' presence brings that up to date too.
  if (next.status === 'signed-out') clearPresence();
  else if (next.list.presence) replacePresence(next.list.presence);
  for (const listener of listeners) listener();
};

export const friendsSnapshot = (): FriendsSnapshot => snapshot;

export const subscribeFriends = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useFriends = (): FriendsSnapshot =>
  useSyncExternalStore(subscribeFriends, friendsSnapshot, friendsSnapshot);

const onlineCount = (): number =>
  snapshot.list.friends.filter((entry) => {
    const state = presenceOf(entry.id)?.state;
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

// ---- Requests announced once a device ------------------------------------

const SEEN_KEY = 'ptcgsim.friends.v1';

interface Seen {
  readonly accountId: string;
  /** Requests asked up to here have been announced or seen. */
  readonly upTo: number;
}

const readSeen = (accountId: string): number | undefined => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null');
    return Reflect.get(Object(value), 'accountId') === accountId
      ? Number(Reflect.get(Object(value), 'upTo')) || 0
      : undefined;
  } catch {
    return undefined;
  }
};

const writeSeen = (seen: Seen): void => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Private windows: announced again next visit.
  }
};

let openFriendsHandler: (() => void) | undefined;

/** What "Tap to answer" opens: the Friends sheet (FriendsSheet.tsx). */
export const setOpenFriendsHandler = (open: (() => void) | undefined): void => {
  openFriendsHandler = open;
};

/** New requests since this device last said so: one notice for them. */
const noticeRequests = (next: FriendsSnapshot): void => {
  if (next.status !== 'ready' || !next.accountId) return;
  const latest = Math.max(0, ...next.list.incoming.map((entry) => entry.since));
  const seen = readSeen(next.accountId);
  if (seen === undefined) {
    // A device's first look announces nothing old.
    writeSeen({ accountId: next.accountId, upTo: latest });
    return;
  }
  const fresh = next.list.incoming.filter((entry) => entry.since > seen);
  if (fresh.length === 0) return;
  writeSeen({ accountId: next.accountId, upTo: latest });
  const first = fresh[0];
  const count = fresh.length;
  toast({
    id: 'friend-requests',
    title:
      count === 1 && first
        ? t`${first.name} wants to be friends`
        : t`You have ${count} friend requests`,
    ...(openFriendsHandler
      ? {
          action: {
            label: t({ message: 'Answer', context: 'a friend request' }),
            onAction: () => openFriendsHandler?.(),
          },
        }
      : {}),
  });
};

/** The requests on screen have been seen. */
export const markRequestsSeen = (): void => {
  const { accountId, list } = snapshot;
  if (!accountId || list.incoming.length === 0) return;
  writeSeen({
    accountId,
    upTo: Math.max(...list.incoming.map((entry) => entry.since)),
  });
};

// ---- Reading and changing --------------------------------------------------

let reading: Promise<void> | undefined;

/** Reads the list again; calls in flight are shared. */
export const refreshFriends = (): Promise<void> => {
  const accountId = accountSnapshot().account?.id ?? null;
  if (!accountId) {
    if (snapshot !== SIGNED_OUT) publish(SIGNED_OUT);
    return Promise.resolve();
  }
  if (snapshot.accountId !== accountId) {
    publish({ status: 'loading', list: EMPTY_FRIENDS, accountId });
  }
  reading ??= fetchFriends()
    .then(
      (list) => {
        if (accountSnapshot().account?.id !== accountId) return;
        publish({ status: 'ready', list, accountId });
      },
      (error: unknown) => {
        if (error instanceof AccountRequestError && error.status === 401) {
          void refreshAccount();
          return;
        }
        if (snapshot.status !== 'ready') {
          publish({ ...snapshot, status: 'failed' });
        }
      }
    )
    .finally(() => {
      reading = undefined;
    });
  return reading;
};

/** What a change said, as a notice; undefined says nothing. */
const outcomeNotice = (
  answer: FriendChangeAnswer
):
  | { readonly title: string; readonly tone: 'success' | 'warning' }
  | undefined => {
  const name = answer.name ?? t({ message: 'That player', context: 'friends' });
  switch (answer.outcome) {
    case 'sent':
      return { title: t`Friend request sent to ${name}`, tone: 'success' };
    case 'friends':
      return { title: t`You and ${name} are now friends!`, tone: 'success' };
    case 'blocked':
      return { title: t`${name} blocked`, tone: 'success' };
    case 'unblocked':
      return { title: t`${name} unblocked`, tone: 'success' };
    case 'declined':
    case 'cancelled':
    case 'removed':
      return undefined;
    case 'self':
      return { title: t`That's your own User ID.`, tone: 'warning' };
    case 'you_blocked':
      return {
        title: t`Unblock ${name} to send a friend request`,
        tone: 'warning',
      };
    case 'cooldown':
      return { title: t`You can ask ${name} again tomorrow`, tone: 'warning' };
    case 'full':
      return { title: t`You can have up to 200 friends`, tone: 'warning' };
    case 'too_many_sent':
      return {
        title: t`You've sent 50 requests. Wait for answers or cancel some.`,
        tone: 'warning',
      };
    case 'slow_down':
      return { title: t`Slow down! Try again in a moment.`, tone: 'warning' };
    case 'unavailable':
      return {
        title: t`${name} can't take friend requests right now`,
        tone: 'warning',
      };
    case 'missing':
      return { title: t`No player has that ID.`, tone: 'warning' };
    case 'gone':
      return { title: t`That request was withdrawn`, tone: 'warning' };
    case 'failed':
      return { title: t`Couldn't do that. Try again.`, tone: 'warning' };
  }
};

/**
 * Changes one friendship and says how it went. Taps are spaced as the
 * server asks: one that comes too soon waits its second and goes once.
 */
/** When this tab last changed the list: its own echo is not read again. */
let changedAt = 0;
export const changedJustNow = (): boolean => Date.now() - changedAt < 1500;

/** Appear offline on or off (ADR-055 presence). */
export const setAppearOffline = async (hidden: boolean): Promise<void> => {
  const accountId = snapshot.accountId;
  if (!accountId) return;
  // Shown at once; put back if the server says no.
  publish({ ...snapshot, list: { ...snapshot.list, appearOffline: hidden } });
  try {
    const list = await putAppearOffline(hidden);
    changedAt = Date.now();
    if (accountSnapshot().account?.id === accountId) {
      publish({ status: 'ready', list, accountId });
    }
  } catch {
    publish({
      ...snapshot,
      list: { ...snapshot.list, appearOffline: !hidden },
    });
    toast({
      id: 'friend-change',
      title: t`Couldn't do that. Try again.`,
      tone: 'danger',
    });
  }
};

export const changeFriend = async (
  id: string,
  action: FriendAction
): Promise<FriendChangeAnswer | undefined> => {
  const accountId = snapshot.accountId;
  let answer: FriendChangeAnswer;
  try {
    answer = await postFriendChange(id, action);
    if (answer.outcome === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      answer = await postFriendChange(id, action);
    }
  } catch (error) {
    if (error instanceof AccountRequestError && error.status === 401) {
      void refreshAccount();
      return undefined;
    }
    toast({
      id: 'friend-change',
      title: t`Couldn't do that. Try again.`,
      tone: 'danger',
    });
    return undefined;
  }
  changedAt = Date.now();
  if (accountId && accountSnapshot().account?.id === accountId) {
    publish({ status: 'ready', list: answer.friends, accountId });
  }
  const notice = outcomeNotice(answer);
  if (notice) toast({ id: 'friend-change', ...notice });
  return answer;
};

// ---- Following the account -------------------------------------------------

/** A page back in view reads the list again after this long. */
const REFRESH_AFTER_MS = 2 * 60 * 1000;
let readAt = 0;
let started = false;

/** Starts following the account's friends; the app calls it once. */
export const startFriends = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  let accountId: string | null = null;
  const follow = (): void => {
    const next = accountSnapshot().account?.id ?? null;
    if (next === accountId) return;
    accountId = next;
    readAt = Date.now();
    void refreshFriends();
  };
  subscribeAccount(follow);
  follow();
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      accountId &&
      Date.now() - readAt > REFRESH_AFTER_MS
    ) {
      readAt = Date.now();
      void refreshFriends();
    }
  });
};
