import {
  browserJsonResponse as json,
  browserNoContentResponse,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from '../browser-json-http.js';
import type { RequestRateLimitDecision } from '../request-rate-limit.js';
import {
  isAccountId,
  readSessionToken,
  sessionCookieName,
  setCookie,
  sha256Hex,
} from './account-session.js';
import {
  isReplayId,
  isShareSecret,
  type AccountReplayPart,
  type ReplayListing,
  type StarOutcome,
} from './account-replays.js';

/**
 * An account's games over HTTP (ADR-053):
 *
 * - `GET /v2/account/replays` lists them, newest first.
 * - `PATCH /v2/account/replays/<id>` stars or unstars one (`{starred}`),
 *   `DELETE` deletes it.
 * - `GET /v2/account/replays/<id>/parts/<n>` is one part of it, from the
 *   player's own seat.
 * - `POST /v2/account/replays/<id>/share` gives it a share link (the same
 *   one each time, `/#replay=<account>.<id>.<secret>`), `DELETE` takes the
 *   link back.
 * - `GET /v2/replays/<account>/<id>/<secret>/parts/<n>` is a part through
 *   a share link, as a spectator sees it. Nobody needs to be signed in.
 *
 * Changes are same-origin; every request is counted per address. Reads
 * refuse other sites.
 */

export type ReplayRoute =
  | { readonly kind: 'list' }
  | { readonly kind: 'replay'; readonly id: string }
  | { readonly kind: 'part'; readonly id: string; readonly part: number }
  | { readonly kind: 'share'; readonly id: string }
  | {
      readonly kind: 'shared_part';
      readonly accountId: string;
      readonly id: string;
      readonly secret: string;
      readonly part: number;
    };

const MAX_PART = 64;

const partNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^(0|[1-9][0-9]{0,2})$/u.test(value)) {
    return undefined;
  }
  const part = Number(value);
  return part <= MAX_PART ? part : undefined;
};

export const replayRoute = (pathname: string): ReplayRoute | undefined => {
  if (pathname === '/v2/account/replays') return { kind: 'list' };
  const own =
    /^\/v2\/account\/replays\/([A-Za-z0-9_-]{22})(?:\/(share|parts\/([0-9]+)))?$/u.exec(
      pathname
    );
  if (own && isReplayId(own[1])) {
    if (own[2] === undefined) return { kind: 'replay', id: own[1] };
    if (own[2] === 'share') return { kind: 'share', id: own[1] };
    const part = partNumber(own[3]);
    return part === undefined
      ? undefined
      : { kind: 'part', id: own[1], part };
  }
  const shared =
    /^\/v2\/replays\/(a_[A-Za-z0-9_-]{16})\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]{22})\/parts\/([0-9]+)$/u.exec(
      pathname
    );
  if (
    shared &&
    isAccountId(shared[1]) &&
    isReplayId(shared[2]) &&
    isShareSecret(shared[3])
  ) {
    const part = partNumber(shared[4]);
    return part === undefined
      ? undefined
      : {
          kind: 'shared_part',
          accountId: shared[1],
          id: shared[2],
          secret: shared[3],
          part,
        };
  }
  return undefined;
};

/** The account object's replay calls, as the routes use them. */
export interface ReplayAccountObject {
  listReplays(
    secretHash: string,
    now: number
  ): Promise<readonly ReplayListing[] | null>;
  starReplay(
    secretHash: string,
    now: number,
    id: string,
    starred: boolean
  ): Promise<StarOutcome | null>;
  deleteReplay(
    secretHash: string,
    now: number,
    id: string
  ): Promise<boolean | null>;
  shareReplay(
    secretHash: string,
    now: number,
    id: string,
    shared: boolean
  ): Promise<{ readonly found: boolean; readonly secret?: string } | null>;
  replayPart(
    secretHash: string,
    now: number,
    id: string,
    part: number
  ): Promise<AccountReplayPart | 'missing' | null>;
  sharedReplayPart(
    id: string,
    secret: string,
    part: number
  ): Promise<AccountReplayPart | 'missing'>;
}

export interface ReplayHttpDependencies {
  readonly account: (accountId: string) => ReplayAccountObject;
  readonly now: () => number;
  readonly rateLimit: () => Promise<RequestRateLimitDecision>;
}

/**
 * Where a share link opens: the app, with the game in its fragment, which
 * never reaches a server or a Referer (as an invitation's, ADR-020).
 */
export const replayShareLink = (
  accountId: string,
  id: string,
  secret: string
): string => `/#replay=${accountId}.${id}.${secret}`;

const listingBody = (accountId: string, replay: ReplayListing) => ({
  id: replay.id,
  filedAt: replay.filedAt,
  ...(replay.startedAt === undefined ? {} : { startedAt: replay.startedAt }),
  moves: replay.moves,
  parts: replay.parts,
  players: replay.players,
  playerOrder: replay.playerOrder,
  viewer: replay.viewer,
  mode: replay.mode,
  truncated: replay.truncated,
  starred: replay.starred,
  ...(replay.share
    ? { shareLink: replayShareLink(accountId, replay.id, replay.share) }
    : {}),
});

const signedOut = (request: Request): Response =>
  json({ error: 'signed_out' }, 401, {
    'Set-Cookie': setCookie(request, sessionCookieName(request), '', 0),
  });

const tooMany = (decision: RequestRateLimitDecision): Response =>
  json({ error: 'rate_limited' }, 429, {
    'Retry-After': String(decision.retryAfterSeconds),
  });

const methodNotAllowed = (allow: string): Response =>
  json({ error: 'method_not_allowed' }, 405, { Allow: allow });

const partResponse = (part: AccountReplayPart): Response =>
  json(part as unknown as Record<string, unknown>, 200);

const readStarred = async (request: Request): Promise<boolean | undefined> => {
  if (!isIdentityJsonRequest(request)) return undefined;
  try {
    const body = await readBoundedJsonRequest(request, 256);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'starred')
    ) {
      return undefined;
    }
    const starred: unknown = Reflect.get(body, 'starred');
    return typeof starred === 'boolean' ? starred : undefined;
  } catch {
    return undefined;
  }
};

export const handleReplayRequest = async (
  request: Request,
  route: ReplayRoute,
  dependencies: ReplayHttpDependencies
): Promise<Response> => {
  const reading = request.method === 'GET';
  const allowed =
    route.kind === 'list' || route.kind === 'part' || route.kind === 'shared_part'
      ? 'GET'
      : route.kind === 'replay'
        ? 'PATCH, DELETE'
        : 'POST, DELETE';
  if (!allowed.split(', ').includes(request.method)) {
    return methodNotAllowed(allowed);
  }
  if (reading) {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return json({ error: 'forbidden' }, 403);
    }
  } else if (!isSameOriginBrowserRequest(request)) {
    return json({ error: 'forbidden' }, 403);
  }
  if (route.kind === 'shared_part') {
    const decision = await dependencies.rateLimit();
    if (!decision.allowed) return tooMany(decision);
    const part = await dependencies
      .account(route.accountId)
      .sharedReplayPart(route.id, route.secret, route.part);
    return part === 'missing'
      ? json({ error: 'missing' }, 404)
      : partResponse(part);
  }
  const token = readSessionToken(request);
  if (!token) return signedOut(request);
  const decision = await dependencies.rateLimit();
  if (!decision.allowed) return tooMany(decision);
  const secretHash = await sha256Hex(token.secret);
  const account = dependencies.account(token.accountId);
  const now = dependencies.now();
  switch (route.kind) {
    case 'list': {
      const replays = await account.listReplays(secretHash, now);
      return replays
        ? json(
            {
              replays: replays.map((replay) =>
                listingBody(token.accountId, replay)
              ),
            },
            200
          )
        : signedOut(request);
    }
    case 'part': {
      const part = await account.replayPart(secretHash, now, route.id, route.part);
      if (part === null) return signedOut(request);
      return part === 'missing'
        ? json({ error: 'missing' }, 404)
        : partResponse(part);
    }
    case 'replay': {
      if (request.method === 'DELETE') {
        const removed = await account.deleteReplay(secretHash, now, route.id);
        if (removed === null) return signedOut(request);
        return removed
          ? browserNoContentResponse()
          : json({ error: 'missing' }, 404);
      }
      const starred = await readStarred(request);
      if (starred === undefined) {
        return json({ error: 'invalid_request' }, 400);
      }
      const outcome = await account.starReplay(secretHash, now, route.id, starred);
      if (outcome === null) return signedOut(request);
      if (outcome === 'missing') return json({ error: 'missing' }, 404);
      if (outcome === 'star_limit') return json({ error: 'star_limit' }, 409);
      return json({ starred: outcome === 'starred' }, 200);
    }
    case 'share': {
      const shared = await account.shareReplay(
        secretHash,
        now,
        route.id,
        request.method === 'POST'
      );
      if (shared === null) return signedOut(request);
      if (!shared.found) return json({ error: 'missing' }, 404);
      return shared.secret
        ? json(
            {
              shareLink: replayShareLink(
                token.accountId,
                route.id,
                shared.secret
              ),
            },
            200
          )
        : browserNoContentResponse();
    }
  }
};
