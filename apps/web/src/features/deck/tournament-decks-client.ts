/**
 * Tournament decks (ADR-037): the server's index of Limitless online
 * tournaments, searchable by deck. Every answer is untrusted until decoded
 * here -- bounded strings, bounded lists, known shapes -- and a request
 * never follows a redirect off this origin or sends cookies.
 */

export const DECK_SEARCH_PATH = '/v2/decks/search';
export const ARCHETYPE_PATH = '/v2/decks/archetype';
export const TOURNAMENTS_PATH = '/v2/tournaments';

/** Where the data comes from, for the credit line. */
export const TOURNAMENT_DATA_SOURCE = Object.freeze({
  name: 'Limitless TCG',
  url: 'https://play.limitlesstcg.com/tournaments/completed?game=PTCG',
});

/** Official majors have no API yet (phase 2): their own site. */
export const MAJOR_TOURNAMENTS_URL = 'https://limitlesstcg.com/tournaments';

export type TournamentFormat = 'STANDARD' | 'EXPANDED';

export interface TournamentArchetype {
  readonly id: string;
  readonly name: string;
  readonly icons: readonly string[];
}

export interface TournamentRef {
  readonly id: string;
  readonly name: string;
  /** ISO 8601. */
  readonly date: string;
  readonly players: number;
  readonly format: string;
}

export interface TournamentPlayer {
  readonly id: string;
  readonly name: string;
  readonly country?: string;
}

export interface TournamentRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

export interface TournamentFinish {
  readonly tournament: TournamentRef;
  readonly player: TournamentPlayer;
  readonly placing: number | null;
  readonly record: TournamentRecord;
}

export interface DeckSearchResult {
  readonly archetype: TournamentArchetype;
  readonly lists: number;
  readonly top8s: number;
  readonly best: readonly TournamentFinish[];
}

export type DeckSearchResponse =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly updatedAt: string;
      readonly results: readonly DeckSearchResult[];
    };

export interface ArchetypeFinishesPage {
  readonly archetype: TournamentArchetype;
  readonly finishes: readonly TournamentFinish[];
  readonly nextCursor: string | null;
}

export interface TournamentSummary {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly format: string;
  readonly players: number;
  readonly organizer: string;
  /** Whether players' lists were published; null until its standings are read. */
  readonly hasLists: boolean | null;
}

export interface TournamentsPage {
  readonly tournaments: readonly TournamentSummary[];
  readonly nextCursor: string | null;
}

export interface TournamentStanding {
  readonly player: TournamentPlayer;
  readonly placing: number | null;
  readonly record: TournamentRecord;
  readonly dropped: boolean;
  readonly archetype: TournamentArchetype | null;
  readonly hasList: boolean;
}

export interface TournamentDetail {
  readonly tournament: TournamentSummary & { readonly url: string };
  readonly standings: readonly TournamentStanding[];
}

export interface TournamentList {
  readonly text: string;
  readonly archetype: TournamentArchetype | null;
  readonly player: TournamentPlayer;
  readonly tournament: TournamentRef;
  readonly url: string;
}

/** The server refused the request (a cursor from before an update, say). */
export class TournamentDataRefusedError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}`);
    this.name = 'TournamentDataRefusedError';
  }
}

/** The server has no such tournament, player or list (any more). */
export class TournamentDataNotFoundError extends Error {
  constructor() {
    super('HTTP 404');
    this.name = 'TournamentDataNotFoundError';
  }
}

/** The server is busy fetching (its Limitless budget is spent for now). */
export class TournamentDataBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Tournament data is busy');
    this.name = 'TournamentDataBusyError';
  }
}

const MAXIMUM_RESPONSE_CODE_UNITS = 4_000_000;
// Longer than the server's own wait for Limitless (15 s) on a first read,
// so a slow answer that arrives isn't given up on here first.
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_NAME = 200;
const MAX_LIST_TEXT = 20_000;
const MAX_RESULTS = 50;
const MAX_FINISHES = 200;
const MAX_TOURNAMENTS = 200;
const MAX_STANDINGS = 5_000;
const MAX_ICONS = 4;

/** Archetype ids and icon names: Limitless slugs. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/u;
/**
 * Tournament ids and player ids: no path or query characters, and a letter
 * or digit (`..` would be a path of its own).
 */
const TOKEN = /^(?=[^A-Za-z0-9]*[A-Za-z0-9])[A-Za-z0-9_.~-]{1,128}$/u;
/**
 * A page's cursor: base64url, as long as the server's own limit (a deck's
 * lists carry the last finish shown, its player id among it).
 */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/u;
// The decoder rejects text a list can never need; built from code points so
// the source holds no control characters.
const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'u'
);

class DecodeError extends Error {
  constructor(what: string) {
    super(`Unexpected tournament data: ${what}`);
    this.name = 'DecodeError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number, what: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    CONTROL.test(value)
  ) {
    throw new DecodeError(what);
  }
  return value;
};

const optionalText = (
  value: unknown,
  max: number,
  what: string
): string | undefined =>
  value === undefined || value === null || value === ''
    ? undefined
    : text(value, max, what);

const matching = (value: unknown, pattern: RegExp, what: string): string => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new DecodeError(what);
  }
  return value;
};

const count = (value: unknown, what: string): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw new DecodeError(what);
  }
  return value;
};

const isoDate = (value: unknown, what: string): string => {
  const date = text(value, 40, what);
  if (!Number.isFinite(Date.parse(date))) throw new DecodeError(what);
  return date;
};

const list = <T>(
  value: unknown,
  max: number,
  what: string,
  decode: (item: unknown) => T
): readonly T[] => {
  if (!Array.isArray(value) || value.length > max) throw new DecodeError(what);
  return value.map(decode);
};

const cursor = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : matching(value, CURSOR, 'cursor');

const decodeArchetype = (value: unknown): TournamentArchetype => {
  if (!isRecord(value)) throw new DecodeError('archetype');
  return {
    id: matching(value.id, SLUG, 'archetype id'),
    name: text(value.name, MAX_NAME, 'archetype name'),
    icons: list(value.icons ?? [], MAX_ICONS, 'icons', (icon) =>
      matching(icon, SLUG, 'icon')
    ),
  };
};

const decodeTournamentRef = (value: unknown): TournamentRef => {
  if (!isRecord(value)) throw new DecodeError('tournament');
  return {
    id: matching(value.id, TOKEN, 'tournament id'),
    name: text(value.name, MAX_NAME, 'tournament name'),
    date: isoDate(value.date, 'tournament date'),
    players: count(value.players, 'players'),
    format: text(value.format, 40, 'format'),
  };
};

const decodePlayer = (value: unknown): TournamentPlayer => {
  if (!isRecord(value)) throw new DecodeError('player');
  const country = optionalText(value.country, 8, 'country');
  return {
    id: matching(value.id, TOKEN, 'player id'),
    name: text(value.name, MAX_NAME, 'player name'),
    ...(country ? { country } : {}),
  };
};

const decodeRecord = (value: unknown): TournamentRecord => {
  if (!isRecord(value)) throw new DecodeError('record');
  return {
    wins: count(value.wins, 'wins'),
    losses: count(value.losses, 'losses'),
    ties: count(value.ties, 'ties'),
  };
};

const decodePlacing = (value: unknown): number | null =>
  value === null || value === undefined ? null : count(value, 'placing');

const decodeFinish = (value: unknown): TournamentFinish => {
  if (!isRecord(value)) throw new DecodeError('finish');
  return {
    tournament: decodeTournamentRef(value.tournament),
    player: decodePlayer(value.player),
    placing: decodePlacing(value.placing),
    record: decodeRecord(value.record),
  };
};

export const decodeDeckSearch = (body: unknown): DeckSearchResponse => {
  if (!isRecord(body)) throw new DecodeError('search');
  if (body.available === false) return { available: false };
  return {
    available: true,
    updatedAt: isoDate(body.updatedAt, 'updatedAt'),
    results: list(body.results, MAX_RESULTS, 'results', (item) => {
      if (!isRecord(item)) throw new DecodeError('result');
      return {
        archetype: decodeArchetype(item.archetype),
        lists: count(item.lists, 'lists'),
        top8s: count(item.top8s, 'top8s'),
        best: list(item.best, 10, 'best', decodeFinish),
      };
    }),
  };
};

export const decodeArchetypeFinishes = (
  body: unknown
): ArchetypeFinishesPage => {
  if (!isRecord(body)) throw new DecodeError('archetype page');
  return {
    archetype: decodeArchetype(body.archetype),
    finishes: list(body.finishes, MAX_FINISHES, 'finishes', decodeFinish),
    nextCursor: cursor(body.nextCursor),
  };
};

const decodeTournamentSummary = (value: unknown): TournamentSummary => {
  if (!isRecord(value)) throw new DecodeError('tournament');
  return {
    ...decodeTournamentRef(value),
    organizer: optionalText(value.organizer, MAX_NAME, 'organizer') ?? '',
    hasLists:
      value.hasLists === true ? true : value.hasLists === false ? false : null,
  };
};

export const decodeTournaments = (body: unknown): TournamentsPage => {
  if (!isRecord(body)) throw new DecodeError('tournaments');
  return {
    tournaments: list(
      body.tournaments,
      MAX_TOURNAMENTS,
      'tournaments',
      decodeTournamentSummary
    ),
    nextCursor: cursor(body.nextCursor),
  };
};

const decodeSourceUrl = (value: unknown): string => {
  const url = text(value, 400, 'url');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DecodeError('url');
  }
  if (
    parsed.protocol !== 'https:' ||
    !/(?:^|\.)limitlesstcg\.com$/u.test(parsed.hostname)
  ) {
    throw new DecodeError('url');
  }
  return parsed.href;
};

export const decodeTournament = (body: unknown): TournamentDetail => {
  if (!isRecord(body) || !isRecord(body.tournament)) {
    throw new DecodeError('tournament detail');
  }
  return {
    tournament: {
      ...decodeTournamentSummary(body.tournament),
      url: decodeSourceUrl(body.tournament.url),
    },
    standings: list(body.standings, MAX_STANDINGS, 'standings', (item) => {
      if (!isRecord(item)) throw new DecodeError('standing');
      return {
        player: decodePlayer(item.player),
        placing: decodePlacing(item.placing),
        record: decodeRecord(item.record),
        dropped: item.dropped === true,
        archetype:
          item.archetype === null || item.archetype === undefined
            ? null
            : decodeArchetype(item.archetype),
        hasList: item.hasList === true,
      };
    }),
  };
};

export const decodeTournamentList = (body: unknown): TournamentList => {
  if (!isRecord(body)) throw new DecodeError('list');
  return {
    text: text(body.text, MAX_LIST_TEXT, 'list text'),
    archetype:
      body.archetype === null || body.archetype === undefined
        ? null
        : decodeArchetype(body.archetype),
    player: decodePlayer(body.player),
    tournament: decodeTournamentRef(body.tournament),
    url: decodeSourceUrl(body.url),
  };
};

/** A Limitless deck icon, or nothing for a name that isn't one. */
export const archetypeIconUrl = (icon: string): string | undefined =>
  SLUG.test(icon)
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${icon}.png`
    : undefined;

export interface TournamentRequestOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  /** `'no-cache'`: ask the server again, never the browser's copy. */
  readonly cache?: RequestCache;
}

const getJson = async (
  path: string,
  options: TournamentRequestOptions
): Promise<unknown> => {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  try {
    const response = await fetchRequest(path, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal,
      ...(options.cache ? { cache: options.cache } : {}),
    });
    if (response.status === 503) {
      let retryAfter = 30;
      try {
        const body: unknown = await response.json();
        if (isRecord(body) && typeof body.retryAfter === 'number') {
          retryAfter = Math.max(1, Math.min(600, Math.round(body.retryAfter)));
        }
      } catch {
        // A busy answer without a body still says busy.
      }
      throw new TournamentDataBusyError(retryAfter);
    }
    if (response.status === 400) {
      throw new TournamentDataRefusedError(response.status);
    }
    if (response.status === 404) throw new TournamentDataNotFoundError();
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const body = await response.text();
    if (body.length > MAXIMUM_RESPONSE_CODE_UNITS) {
      throw new Error('Tournament data is too large');
    }
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timer);
  }
};

const query = (
  parameters: Readonly<Record<string, string | number | undefined>>
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

/** The search's own limits: a word or two, as the server takes it. */
export const MAX_DECK_SEARCH_LENGTH = 60;

/**
 * What is typed or pasted, as the server takes a search: a tab or line
 * break (a cell pasted from a table) is a space, never a refused request.
 * What a search checks, sends and shows is this.
 */
export const searchText = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex -- control characters are the point
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_DECK_SEARCH_LENGTH)
    // Cut through an emoji, its first half alone is no character.
    .replace(/[\uD800-\uDBFF]$/u, '')
    .trimEnd();

export const fetchDeckSearch = async (
  text: string,
  options: TournamentRequestOptions & {
    readonly format?: TournamentFormat;
    readonly limit?: number;
  } = {}
): Promise<DeckSearchResponse> =>
  decodeDeckSearch(
    await getJson(
      `${DECK_SEARCH_PATH}${query({
        q: searchText(text),
        format: options.format,
        limit: options.limit,
      })}`,
      options
    )
  );

export const fetchArchetypeFinishes = async (
  archetypeId: string,
  options: TournamentRequestOptions & {
    readonly format?: TournamentFormat;
    readonly cursor?: string;
    /** How many days back; the server's default is 90. */
    readonly since?: number;
  } = {}
): Promise<ArchetypeFinishesPage> => {
  if (!SLUG.test(archetypeId)) throw new DecodeError('archetype id');
  return decodeArchetypeFinishes(
    await getJson(
      `${ARCHETYPE_PATH}/${archetypeId}${query({
        format: options.format,
        since: options.since,
        cursor: options.cursor,
      })}`,
      options
    )
  );
};

export const fetchTournaments = async (
  options: TournamentRequestOptions & {
    readonly q?: string;
    readonly format?: TournamentFormat;
    readonly minPlayers?: number;
    readonly cursor?: string;
  } = {}
): Promise<TournamentsPage> =>
  decodeTournaments(
    await getJson(
      `${TOURNAMENTS_PATH}${query({
        q: options.q === undefined ? undefined : searchText(options.q),
        format: options.format,
        minPlayers: options.minPlayers,
        cursor: options.cursor,
      })}`,
      options
    )
  );

export const fetchTournament = async (
  tournamentId: string,
  options: TournamentRequestOptions = {}
): Promise<TournamentDetail> => {
  if (!TOKEN.test(tournamentId)) throw new DecodeError('tournament id');
  return decodeTournament(
    await getJson(`${TOURNAMENTS_PATH}/${tournamentId}`, options)
  );
};

export const fetchTournamentList = async (
  tournamentId: string,
  playerId: string,
  options: TournamentRequestOptions = {}
): Promise<TournamentList> => {
  if (!TOKEN.test(tournamentId)) throw new DecodeError('tournament id');
  if (!TOKEN.test(playerId)) throw new DecodeError('player id');
  return decodeTournamentList(
    await getJson(
      `${TOURNAMENTS_PATH}/${tournamentId}/players/${encodeURIComponent(playerId)}/list`,
      options
    )
  );
};
