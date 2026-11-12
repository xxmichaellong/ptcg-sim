import { ROOM_ALIAS_PATTERN } from '@ptcgsim/protocol';

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

export const PRESENCE_STATES = [
  'online',
  'playing',
  'watching',
  'offline',
] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/**
 * Where a friend is (ADR-055 presence): Online, In a game, Watching, or
 * Offline with when they were last seen.
 */
export interface FriendPresence {
  readonly state: PresenceState;
  /** Offline: when they were last seen. */
  readonly lastSeen?: number;
  /**
   * Their room's code, to join or watch through (never shown): only for a
   * friend in a game or watching who doesn't appear offline.
   */
  readonly room?: string;
}

const isPresenceState = (value: unknown): value is PresenceState =>
  (PRESENCE_STATES as readonly unknown[]).includes(value);

/** A presence from the server, checked. */
export const readPresence = (value: unknown): FriendPresence | undefined => {
  const state: unknown = Reflect.get(Object(value), 'state');
  const lastSeen: unknown = Reflect.get(Object(value), 'lastSeen');
  const room: unknown = Reflect.get(Object(value), 'room');
  if (!isPresenceState(state)) return undefined;
  return {
    state,
    ...(typeof lastSeen === 'number' ? { lastSeen } : {}),
    ...(typeof room === 'string' && ROOM_ALIAS_PATTERN.test(room)
      ? { room }
      : {}),
  };
};

/** Presences by friend, checked. */
export const readPresenceMap = (
  value: unknown
): Readonly<Record<string, FriendPresence>> => {
  const entries: Record<string, FriendPresence> = {};
  if (value && typeof value === 'object') {
    for (const [id, item] of Object.entries(value)) {
      const presence = readPresence(item);
      if (isUserId(id) && presence) entries[id] = presence;
    }
  }
  return entries;
};

export interface FriendsList {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly FriendEntry[];
  readonly outgoing: readonly FriendEntry[];
  readonly blocked: readonly FriendProfile[];
  readonly recent: readonly RecentPlayer[];
  readonly appearOffline: boolean;
  /** Friends' presence as the list was read, where the hub answered. */
  readonly presence?: Readonly<Record<string, FriendPresence>>;
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
    ...(read('presence') === undefined
      ? {}
      : { presence: readPresenceMap(read('presence')) }),
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

/** Appear offline on or off; answers the list. */
export const putAppearOffline = async (
  appearOffline: boolean
): Promise<FriendsList> =>
  readFriendsList(
    Reflect.get(
      Object(await send('/v2/friends/settings', 'PUT', { appearOffline })),
      'friends'
    )
  );

/** Playing together (step 3): to my room, or asking into theirs. */
export type InviteKind = 'invite' | 'ask';

/** How an invite or an ask went (the server's InviteOutcome). */
export type InviteOutcome =
  'sent' | 'offline' | 'not_in_room' | 'not_friends' | 'slow_down' | 'failed';

const INVITE_OUTCOMES: readonly InviteOutcome[] = [
  'sent',
  'offline',
  'not_in_room',
  'not_friends',
  'slow_down',
  'failed',
];

export const postInvite = async (
  id: string,
  kind: InviteKind,
  answering: boolean
): Promise<InviteOutcome> => {
  const outcome: unknown = Reflect.get(
    Object(
      await send(`/v2/friends/${id}/invite`, 'POST', {
        kind,
        ...(answering ? { answering: true } : {}),
      })
    ),
    'outcome'
  );
  return (INVITE_OUTCOMES as readonly unknown[]).includes(outcome)
    ? (outcome as InviteOutcome)
    : 'failed';
};

/** An invite or an ask as the live line brings it. */
export interface InviteMessage {
  readonly kind: InviteKind;
  readonly from: FriendProfile;
  /** An invite's room, to join by. */
  readonly room?: string;
  /** Letting in: an invite that answers this tab's ask. */
  readonly answering: boolean;
  readonly sentAt: number;
  readonly expiresAt: number;
}

export const readInviteMessage = (
  value: unknown
): InviteMessage | undefined => {
  const type: unknown = Reflect.get(Object(value), 'type');
  const from = readProfile(Reflect.get(Object(value), 'from'));
  const room: unknown = Reflect.get(Object(value), 'room');
  const sentAt: unknown = Reflect.get(Object(value), 'sentAt');
  const expiresAt: unknown = Reflect.get(Object(value), 'expiresAt');
  if (
    (type !== 'invite' && type !== 'ask') ||
    !from ||
    typeof sentAt !== 'number' ||
    typeof expiresAt !== 'number'
  ) {
    return undefined;
  }
  if (
    type === 'invite' &&
    !(typeof room === 'string' && ROOM_ALIAS_PATTERN.test(room))
  ) {
    return undefined;
  }
  return {
    kind: type,
    from,
    ...(type === 'invite' && typeof room === 'string' ? { room } : {}),
    answering: Reflect.get(Object(value), 'answering') === true,
    sentAt,
    expiresAt,
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
