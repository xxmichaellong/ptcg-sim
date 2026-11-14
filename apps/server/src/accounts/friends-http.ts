import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from '../browser-json-http.js';
import type { RequestRateLimitDecision } from '../request-rate-limit.js';
import type {
  FriendAnswer,
  FriendProfile,
  FriendsView,
} from './account-friends.js';
import {
  isAccountId,
  readSessionToken,
  sessionCookieName,
  setCookie,
  sha256Hex,
} from './account-session.js';

/**
 * Friends over HTTP (ADR-055), for the signed-in player only:
 *
 * - `GET /v2/friends` is the player's list: friends, requests both ways,
 *   recent players, blocked.
 * - `POST /v2/friends/<User ID>` changes one friendship: `{ action }`,
 *   request, accept, decline, cancel, remove, block or unblock. It answers
 *   how it went and the whole list.
 * - `GET /v2/players/<User ID>` says who an id belongs to (name and
 *   avatar), before a request is sent.
 *
 * Every one asks the player's own account object, counted against the
 * account rate limit; changes are same-origin only.
 */

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

const isFriendAction = (value: unknown): value is FriendAction =>
  (FRIEND_ACTIONS as readonly unknown[]).includes(value);

/** Playing together (step 3): to my room, or asking into theirs. */
export type InviteKind = 'invite' | 'ask';

export type InviteOutcome =
  | 'sent'
  /** No tab of theirs is open. */
  | 'offline'
  /** An invite from someone not playing in a room now. */
  | 'not_in_room'
  | 'not_friends'
  | 'slow_down'
  | 'failed';

export type FriendsRoute =
  | { readonly kind: 'friends' }
  | { readonly kind: 'friend'; readonly id: string }
  /** `POST { kind, answering? }`: an invite or an ask (step 3). */
  | { readonly kind: 'invite'; readonly id: string }
  | { readonly kind: 'player'; readonly id: string }
  /** `PUT { appearOffline }` (step 2). */
  | { readonly kind: 'settings' }
  /** A tab's live line, a WebSocket to its account (step 2). */
  | { readonly kind: 'live' };

const ID = '(a_[A-Za-z0-9_-]{16})';

export const friendsRoute = (pathname: string): FriendsRoute | undefined => {
  if (pathname === '/v2/friends') return { kind: 'friends' };
  if (pathname === '/v2/friends/settings') return { kind: 'settings' };
  if (pathname === '/v2/account/live') return { kind: 'live' };
  const friend = new RegExp(`^/v2/friends/${ID}$`, 'u').exec(pathname);
  if (friend?.[1]) return { kind: 'friend', id: friend[1] };
  const invite = new RegExp(`^/v2/friends/${ID}/invite$`, 'u').exec(pathname);
  if (invite?.[1]) return { kind: 'invite', id: invite[1] };
  const player = new RegExp(`^/v2/players/${ID}$`, 'u').exec(pathname);
  if (player?.[1]) return { kind: 'player', id: player[1] };
  return undefined;
};

/** One account's object, as these routes use it. */
export interface FriendsAccountObject {
  friends(secretHash: string, now: number): Promise<FriendsView | null>;
  changeFriend(
    secretHash: string,
    now: number,
    otherId: string,
    action: FriendAction
  ): Promise<{
    readonly answer: FriendAnswer;
    readonly friends: FriendsView;
  } | null>;
  publicProfile(): Promise<FriendProfile | null>;
  setAppearOffline(
    secretHash: string,
    now: number,
    hidden: boolean
  ): Promise<FriendsView | null>;
  /** Takes the live line's upgrade (checks the session itself). */
  fetch(request: Request): Promise<Response>;
  inviteFriend(
    secretHash: string,
    now: number,
    otherId: string,
    kind: InviteKind,
    answering: boolean
  ): Promise<InviteOutcome | null>;
}

export interface FriendsHttpDependencies {
  readonly account: (accountId: string) => FriendsAccountObject;
  readonly now: () => number;
  readonly rateLimit: () => Promise<RequestRateLimitDecision>;
}

const signedOut = (request: Request): Response =>
  json({ error: 'signed_out' }, 401, {
    'Set-Cookie': setCookie(request, sessionCookieName(request), '', 0),
  });

const readAction = async (request: Request): Promise<FriendAction | undefined> => {
  if (!isIdentityJsonRequest(request)) return undefined;
  try {
    const action: unknown = Reflect.get(
      Object(await readBoundedJsonRequest(request, 256)),
      'action'
    );
    return isFriendAction(action) ? action : undefined;
  } catch {
    return undefined;
  }
};

const readInvite = async (
  request: Request
): Promise<
  { readonly kind: InviteKind; readonly answering: boolean } | undefined
> => {
  if (!isIdentityJsonRequest(request)) return undefined;
  try {
    const body = Object(await readBoundedJsonRequest(request, 256));
    const kind: unknown = Reflect.get(body, 'kind');
    const answering: unknown = Reflect.get(body, 'answering');
    return kind === 'invite' || kind === 'ask'
      ? { kind, answering: answering === true }
      : undefined;
  } catch {
    return undefined;
  }
};

const readHidden = async (request: Request): Promise<boolean | undefined> => {
  if (!isIdentityJsonRequest(request)) return undefined;
  try {
    const value: unknown = Reflect.get(
      Object(await readBoundedJsonRequest(request, 256)),
      'appearOffline'
    );
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The live line: a same-origin WebSocket upgrade, counted, handed to the
 * account's object, which checks the session itself.
 */
const openLive = async (
  request: Request,
  dependencies: FriendsHttpDependencies
): Promise<Response> => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'upgrade_required' }, 426);
  }
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) {
    return json({ error: 'forbidden' }, 403);
  }
  const token = readSessionToken(request);
  if (!token) return signedOut(request);
  const decision = await dependencies.rateLimit();
  if (!decision.allowed) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }
  return dependencies.account(token.accountId).fetch(request);
};

export const handleFriendsRequest = async (
  request: Request,
  route: FriendsRoute,
  dependencies: FriendsHttpDependencies
): Promise<Response> => {
  if (route.kind === 'live') return openLive(request, dependencies);
  if (route.kind === 'invite') {
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    }
    if (!isSameOriginBrowserRequest(request)) {
      return json({ error: 'forbidden' }, 403);
    }
    const invite = await readInvite(request);
    if (!invite) return json({ error: 'invalid_request' }, 400);
    const token = readSessionToken(request);
    if (!token) return signedOut(request);
    const decision = await dependencies.rateLimit();
    if (!decision.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    const outcome = await dependencies
      .account(token.accountId)
      .inviteFriend(
        await sha256Hex(token.secret),
        dependencies.now(),
        route.id,
        invite.kind,
        invite.answering
      );
    return outcome ? json({ outcome }, 200) : signedOut(request);
  }
  if (route.kind === 'settings') {
    if (request.method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT' });
    }
    if (!isSameOriginBrowserRequest(request)) {
      return json({ error: 'forbidden' }, 403);
    }
    const hidden = await readHidden(request);
    if (hidden === undefined) return json({ error: 'invalid_request' }, 400);
    const token = readSessionToken(request);
    if (!token) return signedOut(request);
    const decision = await dependencies.rateLimit();
    if (!decision.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    const friends = await dependencies
      .account(token.accountId)
      .setAppearOffline(await sha256Hex(token.secret), dependencies.now(), hidden);
    return friends ? json({ friends: { ...friends } }, 200) : signedOut(request);
  }
  const reading = route.kind !== 'friend';
  if (reading && request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (!reading && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }
  if (reading && request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ error: 'forbidden' }, 403);
  }
  if (!reading && !isSameOriginBrowserRequest(request)) {
    return json({ error: 'forbidden' }, 403);
  }
  const token = readSessionToken(request);
  if (!token) return signedOut(request);
  const decision = await dependencies.rateLimit();
  if (!decision.allowed) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }
  const secretHash = await sha256Hex(token.secret);
  const own = dependencies.account(token.accountId);
  const now = dependencies.now();
  switch (route.kind) {
    case 'friends': {
      const friends = await own.friends(secretHash, now);
      return friends ? json({ friends: { ...friends } }, 200) : signedOut(request);
    }
    case 'player': {
      // Signed in to look anyone up: the session is checked first.
      const friends = await own.friends(secretHash, now);
      if (!friends) return signedOut(request);
      if (!isAccountId(route.id)) return json({ error: 'not_found' }, 404);
      const profile = await dependencies.account(route.id).publicProfile();
      return profile
        ? json({ player: { ...profile } }, 200)
        : json({ error: 'not_found' }, 404);
    }
    case 'friend': {
      const action = await readAction(request);
      if (!action) return json({ error: 'invalid_request' }, 400);
      const changed = await own.changeFriend(secretHash, now, route.id, action);
      return changed
        ? json(
            { ...changed.answer, friends: { ...changed.friends } },
            200
          )
        : signedOut(request);
    }
  }
};
