import { AccountRequestError } from '../account/account-api.js';

/**
 * The friends routes (ADR-055, apps/server/src/accounts/friends-http.ts),
 * as the app calls them, checked as they come back.
 */

const ACCOUNT_ID = /^a_[A-Za-z0-9_-]{16}$/u;

export const isUserId = (value: unknown): value is string =>
  typeof value === 'string' && ACCOUNT_ID.test(value);

/**
 * A User ID found in pasted text: the id itself, an invite link
 * (`/#friend=<id>`), or any text with one in it.
 */
export const findUserId = (text: string): string | undefined =>
  /a_[A-Za-z0-9_-]{16}(?![A-Za-z0-9_-])/u.exec(text)?.[0];

export interface FriendProfile {
  readonly id: string;
  readonly name: string;
  /** `initials`, or `emblem:<card-back emblem>`. */
  readonly avatar: string;
}

export interface FriendEntry extends FriendProfile {
  /** Friends since, or asked at. */
  readonly since: number;
}

export interface RecentPlayer {
  readonly id: string;
  readonly name: string;
  readonly playedAt: number;
}

export interface FriendsList {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly FriendEntry[];
  readonly outgoing: readonly FriendEntry[];
  readonly blocked: readonly FriendProfile[];
  readonly recent: readonly RecentPlayer[];
  readonly appearOffline: boolean;
}

export const EMPTY_FRIENDS: FriendsList = Object.freeze({
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  recent: [],
  appearOffline: false,
});

export const FRIEND_ACTIONS = [
  'request',
  'accept',
  'decline',
  'cancel',
  'remove',
  'block',
  'unblock',
] as const;
export type FriendAction = (typeof FRIEND_ACTIONS)[number];

/** How a change went (the server's FriendOutcome). */
export type FriendOutcome =
  | 'sent'
  | 'friends'
  | 'declined'
  | 'cancelled'
  | 'removed'
  | 'blocked'
  | 'unblocked'
  | 'self'
  | 'you_blocked'
  | 'cooldown'
  | 'full'
  | 'too_many_sent'
  | 'slow_down'
  | 'unavailable'
  | 'missing'
  | 'gone'
  | 'failed';

const OUTCOMES: readonly FriendOutcome[] = [
  'sent',
  'friends',
  'declined',
  'cancelled',
  'removed',
  'blocked',
  'unblocked',
  'self',
  'you_blocked',
  'cooldown',
  'full',
  'too_many_sent',
  'slow_down',
  'unavailable',
  'missing',
  'gone',
  'failed',
];

const readProfile = (value: unknown): FriendProfile | undefined => {
  const id: unknown = Reflect.get(Object(value), 'id');
  const name: unknown = Reflect.get(Object(value), 'name');
  const avatar: unknown = Reflect.get(Object(value), 'avatar');
  return isUserId(id) && typeof name === 'string'
    ? { id, name, avatar: typeof avatar === 'string' ? avatar : 'initials' }
    : undefined;
};

const readEntry = (value: unknown): FriendEntry | undefined => {
  const profile = readProfile(value);
  const since: unknown = Reflect.get(Object(value), 'since');
  return profile && typeof since === 'number'
    ? { ...profile, since }
    : undefined;
};

const readRecent = (value: unknown): RecentPlayer | undefined => {
  const id: unknown = Reflect.get(Object(value), 'id');
  const name: unknown = Reflect.get(Object(value), 'name');
  const playedAt: unknown = Reflect.get(Object(value), 'playedAt');
  return isUserId(id) &&
    typeof name === 'string' &&
    typeof playedAt === 'number'
    ? { id, name, playedAt }
    : undefined;
};

const list = <Item>(
  value: unknown,
  read: (item: unknown) => Item | undefined
) => (Array.isArray(value) ? value.flatMap((item) => read(item) ?? []) : []);

/** A list from the server, checked. */
export const readFriendsList = (value: unknown): FriendsList => {
  const read = (key: string): unknown => Reflect.get(Object(value), key);
  return {
    friends: list(read('friends'), readEntry),
    incoming: list(read('incoming'), readEntry),
    outgoing: list(read('outgoing'), readEntry),
    blocked: list(read('blocked'), readProfile),
    recent: list(read('recent'), readRecent),
    appearOffline: read('appearOffline') === true,
  };
};

const errorOf = async (response: Response): Promise<AccountRequestError> => {
  let code = 'failed';
  try {
    const error: unknown = Reflect.get(Object(await response.json()), 'error');
    if (typeof error === 'string') code = error;
  } catch {
    // Only its status.
  }
  return new AccountRequestError(response.status, code);
};

const send = async (
  path: string,
  method: string,
  body?: unknown
): Promise<unknown> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorOf(response);
  return response.json();
};

export const fetchFriends = async (): Promise<FriendsList> =>
  readFriendsList(
    Reflect.get(Object(await send('/v2/friends', 'GET')), 'friends')
  );

export interface FriendChangeAnswer {
  readonly outcome: FriendOutcome;
  readonly name?: string;
  readonly friends: FriendsList;
}

export const postFriendChange = async (
  id: string,
  action: FriendAction
): Promise<FriendChangeAnswer> => {
  const body = await send(`/v2/friends/${id}`, 'POST', { action });
  const outcome: unknown = Reflect.get(Object(body), 'outcome');
  const name: unknown = Reflect.get(Object(body), 'name');
  return {
    outcome: (OUTCOMES as readonly unknown[]).includes(outcome)
      ? (outcome as FriendOutcome)
      : 'failed',
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
    friends: readFriendsList(Reflect.get(Object(body), 'friends')),
  };
};

/** Who an id belongs to; undefined when nobody has it. */
export const lookUpPlayer = async (
  id: string
): Promise<FriendProfile | undefined> => {
  try {
    return readProfile(
      Reflect.get(Object(await send(`/v2/players/${id}`, 'GET')), 'player')
    );
  } catch (error) {
    if (error instanceof AccountRequestError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
};

/** A link that opens Friends on this player, to add them. */
export const friendInviteLink = (id: string, origin = window.location.origin) =>
  `${origin}/#friend=${id}`;
