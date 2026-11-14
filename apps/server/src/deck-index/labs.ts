/**
 * Official majors (Regionals, Special Events, Internationals, Worlds) for
 * the tournament deck index (ADR-037 §8), read from Limitless Labs' JSON
 * API with Limitless's permission. Labs covers majors since September 2024;
 * only the Masters division is ever asked for (the others are minors).
 *
 *   GET /labs/data/tcg/tournaments                       every major started
 *   GET /labs/data/tcg/tournament?id=0077&division=MA     one major's state
 *   GET /labs/data/tcg/standings?tournamentId=0077&division=MA
 *   GET /labs/data/tcg/decklist?tournamentId=0077&playerId=2115
 *
 * Every answer is `{ ok, message }`. Labs sends no ETag or rate-limit
 * header: a major's `updated_at` is its version, and the index paces
 * itself. Everything is untrusted, as Limitless's online API is: bounded
 * reads, known shapes, names as bounded single lines, lists kept only as
 * whole 60-card decks.
 */
import {
  LIMITLESS_USER_AGENT,
  LimitlessRequestError,
  boundedName,
  decklistText,
  isRecord,
  readBoundedJson,
} from '../limitless.js';
import {
  ARCHETYPE_ID,
  MAJOR_TOURNAMENT_ID,
  PARSE_LIMITS,
  type ArchetypeRef,
  type ListedTournament,
  type StandingEntry,
} from './parse.js';

export const LABS_API_ORIGIN = 'https://mew.limitlesstcg.com';
export const LABS_API_PATH = '/labs/data/tcg';
export const LABS_SITE_ORIGIN = 'https://labs.limitlesstcg.com';

export const MAJOR_KINDS = [
  'regional',
  'special',
  'international',
  'worlds',
] as const;
export type MajorKind = (typeof MAJOR_KINDS)[number];

export const isMajorKind = (value: unknown): value is MajorKind =>
  typeof value === 'string' &&
  (MAJOR_KINDS as readonly string[]).includes(value);

export const LABS_LIMITS = Object.freeze({
  city: 60,
  /** A major's Masters standings: Worlds and NAIC run to about 4,000. */
  standings: 8_192,
  /** Labs numbers its events and players from 1. */
  largestNumber: 999_999,
});

/** The index's id for Labs event `n`: `labs-0077`. */
export const majorId = (labsNumber: number): string =>
  `labs-${String(labsNumber).padStart(4, '0')}`;

/** Labs' own number for an index id (`labs-0077` -> `0077`), or null. */
export const labsNumber = (id: string): string | null =>
  MAJOR_TOURNAMENT_ID.test(id) ? id.slice('labs-'.length) : null;

export const isMajorId = (id: string): boolean => MAJOR_TOURNAMENT_ID.test(id);

/** A player at a major: their number in it (`tp_id`), four digits at least. */
export const majorPlayerId = (tpId: number): string =>
  String(tpId).padStart(4, '0');

const MAJOR_PLAYER_ID = /^\d{4,6}$/u;

export const isMajorPlayerId = (id: string): boolean =>
  MAJOR_PLAYER_ID.test(id);

export const majorStandingsUrl = (id: string): string =>
  `${LABS_SITE_ORIGIN}/${labsNumber(id) ?? ''}/standings`;

export const majorListUrl = (id: string, playerId: string): string =>
  `${LABS_SITE_ORIGIN}/${labsNumber(id) ?? ''}/player/${playerId}/decklist`;

export interface LabsFetchOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly maximumBytes: number;
  readonly timeoutMs: number;
}

/** `Retry-After` in seconds (the HTTP-date form is not worth parsing here). */
const retryAfterSeconds = (value: string | null): number | undefined => {
  if (!value || !/^\d{1,6}$/u.test(value.trim())) return undefined;
  return Number(value.trim());
};

/**
 * One GET against Labs' API, its `message` returned (null when Labs says
 * there is none). A 429 is `rate_limited`, a 400 or 404 `not_found`, any
 * other failure `request_failed`, and a body too big, not JSON or not
 * `{ ok: true }` `invalid_response`. The deadline covers the body too.
 */
export const labsGet = async (
  options: LabsFetchOptions,
  path: string
): Promise<unknown> => {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetch(
        `${LABS_API_ORIGIN}${LABS_API_PATH}${path}`,
        {
          headers: {
            accept: 'application/json',
            'accept-encoding': 'gzip',
            'user-agent': LIMITLESS_USER_AGENT,
          },
          signal: deadline.signal,
        }
      );
    } catch (error) {
      throw new LimitlessRequestError('request_failed', { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) {
        const wait = retryAfterSeconds(response.headers.get('retry-after'));
        throw new LimitlessRequestError(
          'rate_limited',
          wait === undefined ? {} : { retryAfterMs: wait * 1000 }
        );
      }
      throw new LimitlessRequestError(
        response.status === 400 || response.status === 404
          ? 'not_found'
          : 'request_failed'
      );
    }
    let body: unknown;
    try {
      body = await readBoundedJson(response, options.maximumBytes);
    } catch (error) {
      if (error instanceof LimitlessRequestError) throw error;
      throw new LimitlessRequestError(
        deadline.signal.aborted ? 'request_failed' : 'invalid_response',
        { cause: error }
      );
    }
    if (!isRecord(body) || body.ok !== true) {
      throw new LimitlessRequestError('invalid_response');
    }
    return body.message ?? null;
  } finally {
    clearTimeout(timer);
  }
};

const labsInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= LABS_LIMITS.largestNumber
    ? (value as number)
    : null;

/** Labs' times: `2024-09-14 12:30:00`, in UTC. */
const LABS_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/u;

export const readLabsTime = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = LABS_TIME.exec(value);
  if (!match) return null;
  const time = Date.parse(`${match[1]!}T${match[2]!}Z`);
  return Number.isFinite(time) ? time : null;
};

/** The acronym limitlesstcg.com names an International by, by its country. */
const INTERNATIONALS: Readonly<Record<string, string>> = {
  US: 'NAIC',
  GB: 'EUIC',
  UK: 'EUIC',
  BR: 'LAIC',
  AU: 'OCIC',
};

/**
 * A major's name as limitlesstcg.com gives it: "Regional Nice", "Special
 * Event Lima", "NAIC 2026, New Orleans", "LAIC 2025–26, São Paulo" (a
 * season's events before the new year carry both years), "World
 * Championships 2026".
 */
export const majorName = (major: {
  readonly kind: MajorKind;
  readonly city: string;
  readonly country: string | null;
  readonly season: number;
  readonly date: number;
}): string => {
  const year = new Date(major.date).getUTCFullYear();
  switch (major.kind) {
    case 'regional':
      return `Regional ${major.city}`;
    case 'special':
      return `Special Event ${major.city}`;
    case 'worlds':
      return `World Championships ${String(year)}`;
    case 'international': {
      const acronym =
        (major.country ? INTERNATIONALS[major.country] : undefined) ??
        'International Championship';
      const season =
        year < major.season
          ? `${String(major.season - 1)}–${String(major.season).slice(-2)}`
          : String(major.season);
      return `${acronym} ${season}, ${major.city}`;
    }
  }
};

/** Words a major is also found by, besides its name. */
export const majorSearchWords = (kind: MajorKind): string =>
  ({
    regional: 'regional championship regionals major',
    special: 'special event major',
    international: 'international championship major',
    worlds: 'worlds world championship major',
  })[kind];

/** A major as Labs lists it. */
export interface ListedMajor extends ListedTournament {
  readonly kind: MajorKind;
  /** Over: its standings are final, and worth reading. */
  readonly completed: boolean;
}

const COUNTRY = /^[A-Z]{2}$/u;

/**
 * The rows of Labs' `tournaments`: majors that have started. A row whose
 * number, kind, city, season or start isn't well formed is dropped.
 */
export const readLabsTournaments = (value: unknown): ListedMajor[] => {
  if (!Array.isArray(value)) return [];
  const rows: ListedMajor[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 10_000)) {
    if (!isRecord(entry)) continue;
    const number = labsInteger(entry.id);
    const city = boundedName(entry.city, LABS_LIMITS.city);
    const date = readLabsTime(entry.utc_start);
    const season = entry.season;
    if (
      number === null ||
      !isMajorKind(entry.type) ||
      city === null ||
      date === null ||
      !Number.isSafeInteger(season) ||
      (season as number) < 2000 ||
      (season as number) > 2100 ||
      entry.started !== 1
    ) {
      continue;
    }
    const id = majorId(number);
    if (seen.has(id)) continue;
    seen.add(id);
    const country =
      typeof entry.country === 'string' && COUNTRY.test(entry.country)
        ? entry.country
        : null;
    rows.push({
      id,
      name: majorName({
        kind: entry.type,
        city,
        country,
        season: season as number,
        date,
      }),
      date,
      // Every major Labs has (since September 2024) is Standard.
      format: 'STANDARD',
      // Known once the event is read (the list doesn't say).
      players: 0,
      organizerId: null,
      indexable: date >= PARSE_LIMITS.earliestDate,
      kind: entry.type,
      completed: entry.completed === 1,
    });
  }
  return rows;
};

/** A major's state: its Masters players, version, and whether it is over. */
export interface LabsTournament {
  readonly players: number | null;
  /** Labs' `updated_at`: the version of its standings and lists. */
  readonly version: string;
  readonly completed: boolean;
}

export const readLabsTournament = (value: unknown): LabsTournament | null => {
  if (!isRecord(value)) return null;
  const { players, updated_at: updatedAt } = value;
  if (typeof updatedAt !== 'string' || readLabsTime(updatedAt) === null) {
    return null;
  }
  return {
    players:
      Number.isSafeInteger(players) &&
      (players as number) >= 1 &&
      (players as number) <= LABS_LIMITS.largestNumber
        ? (players as number)
        : null,
    version: updatedAt,
    completed: value.completed === 1,
  };
};

/** A standing at a major, with whether Labs has the player's list. */
export interface MajorStanding extends StandingEntry {
  /** Labs has a list for the player, read on its own. */
  readonly listPublished: boolean;
}

const ICON = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/u;

const count = (value: unknown): number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < 1_000
    ? (value as number)
    : 0;

const readMajorArchetype = (
  row: Record<string, unknown>
): ArchetypeRef | null => {
  const id = row.deck_id;
  const name = boundedName(row.deck_name, PARSE_LIMITS.archetypeName);
  if (
    typeof id !== 'string' ||
    id === 'other' ||
    id.length > 64 ||
    !ARCHETYPE_ID.test(id) ||
    name === null
  ) {
    return null;
  }
  // Labs' icons are one string, space-separated.
  const icons =
    typeof row.icons === 'string' && row.icons.length <= 200
      ? row.icons
          .split(' ')
          .filter((icon) => icon.length <= 40 && ICON.test(icon))
          .slice(0, PARSE_LIMITS.icons)
      : [];
  return { id, name, icons };
};

/**
 * A major's Masters standings, sorted by placing with those without one
 * (disqualified) last. Lists are read one player at a time, so none is
 * here: `listPublished` says which players have one.
 */
export const readLabsStandings = (value: unknown): MajorStanding[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: MajorStanding[] = [];
  for (const row of value.slice(0, LABS_LIMITS.standings)) {
    if (!isRecord(row)) continue;
    const tpId = labsInteger(row.tp_id);
    if (tpId === null) continue;
    const playerId = majorPlayerId(tpId);
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    const placement = row.placement;
    entries.push({
      playerId,
      name: boundedName(row.name, PARSE_LIMITS.playerName) ?? playerId,
      country:
        typeof row.country === 'string' && COUNTRY.test(row.country)
          ? row.country
          : null,
      placing:
        Number.isSafeInteger(placement) &&
        (placement as number) >= 1 &&
        (placement as number) <= 100_000
          ? (placement as number)
          : null,
      wins: count(row.wins),
      losses: count(row.losses),
      ties: count(row.ties),
      dropped:
        (Number.isSafeInteger(row.drop_round) &&
          (row.drop_round as number) > 0) ||
        row.dqed === 1,
      archetype: readMajorArchetype(row),
      list: null,
      listPublished: row.decklist === 1,
    });
  }
  return entries.sort(
    (left, right) =>
      (left.placing ?? Number.MAX_SAFE_INTEGER) -
        (right.placing ?? Number.MAX_SAFE_INTEGER) ||
      left.playerId.localeCompare(right.playerId)
  );
};

/** One player's list at a major, as importable text; null if not a deck. */
export const readLabsDecklist = (value: unknown): string | null =>
  decklistText(value);
