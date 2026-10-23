/**
 * The tournament deck index over HTTP (ADR-037). Every route is a plain GET
 * whose parameters are checked strictly; an unknown parameter is refused.
 *
 *   GET /v2/decks/search?q=&format=&limit=        archetypes matching a name,
 *                                                 with their best recent lists
 *   GET /v2/decks/archetype/<id>?format=&since=&cursor=
 *                                                 an archetype's finishes
 *   GET /v2/tournaments?q=&format=&minPlayers=&cursor=
 *                                                 tournaments, newest first
 *   GET /v2/tournaments/<id>                      one tournament's standings
 *   GET /v2/tournaments/<id>/players/<player>/list
 *                                                 one player's list, as text
 */
import { browserJsonResponse as json } from '../browser-json-http.js';
import { hasControl, LIMITLESS_TOURNAMENT_ID } from '../limitless.js';
import type {
  PlayerListAnswer,
  SearchAnswer,
  TournamentAnswer,
  TournamentSummary,
  FinishSummary,
} from './deck-index.js';
import {
  ARCHETYPE_ID,
  PLAYER_ID,
  isIndexedFormat,
  type IndexedFormat,
} from './parse.js';
import type { FinishKey } from './store.js';

export type DeckIndexRoute =
  | { readonly kind: 'search' }
  | { readonly kind: 'archetype'; readonly id: string }
  | { readonly kind: 'tournaments' }
  | { readonly kind: 'tournament'; readonly id: string }
  | {
      readonly kind: 'player_list';
      readonly id: string;
      readonly playerId: string;
    };

const ARCHETYPE_PATH = /^\/v2\/decks\/archetype\/([^/]{1,80})$/u;
const TOURNAMENT_PATH = /^\/v2\/tournaments\/([a-f0-9]{24})$/u;
const PLAYER_LIST_PATH =
  /^\/v2\/tournaments\/([a-f0-9]{24})\/players\/([^/]{1,200})\/list$/u;

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * The deck-index route a path names, `invalid` for one of its paths with a
 * malformed id, or undefined for any other path.
 */
export const deckIndexRoute = (
  pathname: string
): DeckIndexRoute | 'invalid' | undefined => {
  if (pathname === '/v2/decks/search') return { kind: 'search' };
  if (pathname === '/v2/tournaments') return { kind: 'tournaments' };
  const archetype = ARCHETYPE_PATH.exec(pathname);
  if (archetype) {
    const id = decode(archetype[1]!);
    return id !== null && id.length <= 64 && ARCHETYPE_ID.test(id)
      ? { kind: 'archetype', id }
      : 'invalid';
  }
  if (pathname.startsWith('/v2/decks/archetype/')) return 'invalid';
  const tournament = TOURNAMENT_PATH.exec(pathname);
  if (tournament) return { kind: 'tournament', id: tournament[1]! };
  const list = PLAYER_LIST_PATH.exec(pathname);
  if (list) {
    const playerId = decode(list[2]!);
    return playerId !== null && PLAYER_ID.test(playerId)
      ? { kind: 'player_list', id: list[1]!, playerId }
      : 'invalid';
  }
  if (pathname.startsWith('/v2/tournaments/')) return 'invalid';
  return undefined;
};

/** What the routes ask of the index (the Durable Object's methods). */
export interface DeckIndexReader {
  search(
    query: string,
    format: IndexedFormat,
    limit: number
  ): Promise<SearchAnswer>;
  archetype(
    id: string,
    format: IndexedFormat,
    sinceDays: number,
    after: FinishKey | null
  ): Promise<
    | {
        readonly kind: 'ok';
        readonly archetype: {
          id: string;
          name: string;
          icons: readonly string[];
        };
        readonly finishes: readonly FinishSummary[];
        readonly next: FinishKey | null;
      }
    | { readonly kind: 'not_found' }
  >;
  tournaments(query: {
    readonly q: string;
    readonly format: IndexedFormat | null;
    readonly minimumPlayers: number;
    readonly before: { readonly date: number; readonly id: string } | null;
  }): Promise<{
    readonly tournaments: readonly TournamentSummary[];
    readonly next: { readonly date: number; readonly id: string } | null;
  }>;
  tournament(id: string): Promise<TournamentAnswer>;
  playerList(id: string, playerId: string): Promise<PlayerListAnswer>;
}

export const DECK_INDEX_LIMITS = Object.freeze({
  queryCodeUnits: 60,
  searchResults: 20,
  defaultSearchResults: 8,
  /** An archetype's finishes from this many days back, unless asked. */
  defaultSinceDays: 90,
  maximumSinceDays: 3_650,
  maximumMinimumPlayers: 100_000,
});

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

const FIVE_MINUTES = 300;
const ONE_DAY = 86_400;
const ONE_WEEK = 604_800;

const cached = (body: unknown, maxAge: number): Response =>
  Response.json(body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Cache-Control': `public, max-age=${String(maxAge)}`,
    },
  });

const invalid = (): Response => json({ error: 'invalid_request' }, 400);
const notFound = (): Response => json({ error: 'not_found' }, 404);
const busy = (retryAfterMs: number): Response => {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return json({ error: 'busy', retryAfter: seconds }, 503, {
    'Retry-After': String(seconds),
  });
};

/** The query's parameters, or null if any is unknown or repeated. */
const readParameters = (
  url: URL,
  allowed: readonly string[]
): ReadonlyMap<string, string> | null => {
  const parameters = new Map<string, string>();
  let refused = false;
  url.searchParams.forEach((value, key) => {
    if (!allowed.includes(key) || parameters.has(key)) refused = true;
    else parameters.set(key, value);
  });
  return refused ? null : parameters;
};

const readFormat = (
  value: string | undefined,
  fallback: IndexedFormat | null
): IndexedFormat | null | 'invalid' => {
  if (value === undefined) return fallback;
  const upper = value.toUpperCase();
  return isIndexedFormat(upper) ? upper : 'invalid';
};

const readInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number | null => {
  if (value === undefined) return fallback;
  if (!/^\d{1,7}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
};

const readQuery = (value: string | undefined, required: boolean) => {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return required ? null : '';
  return trimmed.length <= DECK_INDEX_LIMITS.queryCodeUnits &&
    !hasControl(trimmed)
    ? trimmed
    : null;
};

const encodeCursor = (value: unknown): string =>
  btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

const decodeCursor = (value: string): unknown => {
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    return JSON.parse(
      atob(value.replaceAll('-', '+').replaceAll('_', '/'))
    ) as unknown;
  } catch {
    return undefined;
  }
};

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Where the last page of a deck's finishes ended (`FinishKey`). */
const readFinishCursor = (
  value: string | undefined
): FinishKey | null | 'invalid' => {
  if (value === undefined) return null;
  const decoded = decodeCursor(value) as
    | { p?: unknown; n?: unknown; d?: unknown; t?: unknown; u?: unknown }
    | undefined;
  const placing = decoded?.p;
  const players = decoded?.n;
  const date = decoded?.d;
  const tournamentId = decoded?.t;
  const playerId = decoded?.u;
  return isCount(placing) &&
    isCount(players) &&
    Number.isSafeInteger(date) &&
    typeof tournamentId === 'string' &&
    LIMITLESS_TOURNAMENT_ID.test(tournamentId) &&
    typeof playerId === 'string' &&
    PLAYER_ID.test(playerId)
    ? {
        placing,
        players,
        date: date as number,
        tournamentId,
        playerId,
      }
    : 'invalid';
};

const finishCursor = (key: FinishKey): string =>
  encodeCursor({
    p: key.placing,
    n: key.players,
    d: key.date,
    t: key.tournamentId,
    u: key.playerId,
  });

const readDateCursor = (
  value: string | undefined
): { readonly date: number; readonly id: string } | null | 'invalid' => {
  if (value === undefined) return null;
  const decoded = decodeCursor(value) as
    { d?: unknown; i?: unknown } | undefined;
  const date = decoded?.d;
  const id = decoded?.i;
  return Number.isSafeInteger(date) &&
    typeof id === 'string' &&
    LIMITLESS_TOURNAMENT_ID.test(id)
    ? { date: date as number, id }
    : 'invalid';
};

const tournamentUrl = (id: string): string =>
  `https://play.limitlesstcg.com/tournament/${id}/standings`;

const playerListUrl = (id: string, playerId: string): string =>
  `https://play.limitlesstcg.com/tournament/${id}/player/${encodeURIComponent(
    playerId
  )}/decklist`;

export const handleDeckIndexRequest = async (
  request: Request,
  route: DeckIndexRoute | 'invalid',
  index: DeckIndexReader
): Promise<Response> => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (route === 'invalid') return invalid();
  const url = new URL(request.url);
  switch (route.kind) {
    case 'search': {
      const parameters = readParameters(url, ['q', 'format', 'limit']);
      if (!parameters) return invalid();
      const query = readQuery(parameters.get('q'), true);
      const format = readFormat(parameters.get('format'), 'STANDARD');
      const limit = readInteger(
        parameters.get('limit'),
        DECK_INDEX_LIMITS.defaultSearchResults,
        1,
        DECK_INDEX_LIMITS.searchResults
      );
      if (query === null || format === 'invalid' || !format || limit === null) {
        return invalid();
      }
      const answer = await index.search(query, format, limit);
      // None read yet is the index's state, not a failure of the server.
      if (!answer.available) return json({ available: false }, 200);
      return cached(answer, FIVE_MINUTES);
    }
    case 'archetype': {
      const parameters = readParameters(url, ['format', 'since', 'cursor']);
      if (!parameters) return invalid();
      const format = readFormat(parameters.get('format'), 'STANDARD');
      const since = readInteger(
        parameters.get('since'),
        DECK_INDEX_LIMITS.defaultSinceDays,
        1,
        DECK_INDEX_LIMITS.maximumSinceDays
      );
      const after = readFinishCursor(parameters.get('cursor'));
      if (
        format === 'invalid' ||
        !format ||
        since === null ||
        after === 'invalid'
      ) {
        return invalid();
      }
      const answer = await index.archetype(route.id, format, since, after);
      if (answer.kind === 'not_found') return notFound();
      return cached(
        {
          archetype: answer.archetype,
          finishes: answer.finishes,
          nextCursor: answer.next === null ? null : finishCursor(answer.next),
        },
        FIVE_MINUTES
      );
    }
    case 'tournaments': {
      const parameters = readParameters(url, [
        'q',
        'format',
        'minPlayers',
        'cursor',
      ]);
      if (!parameters) return invalid();
      const query = readQuery(parameters.get('q'), false);
      const format = readFormat(parameters.get('format'), null);
      const minimumPlayers = readInteger(
        parameters.get('minPlayers'),
        0,
        0,
        DECK_INDEX_LIMITS.maximumMinimumPlayers
      );
      const before = readDateCursor(parameters.get('cursor'));
      if (
        query === null ||
        format === 'invalid' ||
        minimumPlayers === null ||
        before === 'invalid'
      ) {
        return invalid();
      }
      const answer = await index.tournaments({
        q: query,
        format,
        minimumPlayers,
        before,
      });
      return cached(
        {
          tournaments: answer.tournaments,
          nextCursor: answer.next
            ? encodeCursor({ d: answer.next.date, i: answer.next.id })
            : null,
        },
        FIVE_MINUTES
      );
    }
    case 'tournament': {
      if (!readParameters(url, [])) return invalid();
      const answer = await index.tournament(route.id);
      if (answer.kind === 'not_found') return notFound();
      if (answer.kind === 'busy') return busy(answer.retryAfterMs);
      return cached(
        {
          tournament: { ...answer.tournament, url: tournamentUrl(route.id) },
          standings: answer.standings,
        },
        answer.settled ? ONE_DAY : FIVE_MINUTES
      );
    }
    case 'player_list': {
      if (!readParameters(url, [])) return invalid();
      const answer = await index.playerList(route.id, route.playerId);
      if (answer.kind === 'not_found') return notFound();
      if (answer.kind === 'busy') return busy(answer.retryAfterMs);
      return cached(
        {
          text: answer.text,
          archetype: answer.archetype,
          player: answer.player,
          tournament: answer.tournament,
          url: playerListUrl(route.id, route.playerId),
        },
        answer.settled ? ONE_WEEK : FIVE_MINUTES
      );
    }
  }
};
