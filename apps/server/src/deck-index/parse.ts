/**
 * Reads Limitless's tournament list and standings into the deck index's
 * rows. Everything is untrusted: a row that isn't well formed is dropped,
 * names are bounded single lines, ids match their known shapes, and a
 * list is kept only as a whole 60-card deck (decklistText).
 */
import {
  LIMITLESS_TOURNAMENT_ID,
  boundedName,
  decklistText,
  isRecord,
} from '../limitless.js';

/** The formats whose lists are kept: 60-card decks. */
export const INDEXED_FORMATS = ['STANDARD', 'EXPANDED'] as const;
export type IndexedFormat = (typeof INDEXED_FORMATS)[number];

export const isIndexedFormat = (value: unknown): value is IndexedFormat =>
  value === 'STANDARD' || value === 'EXPANDED';

export const PARSE_LIMITS = Object.freeze({
  tournamentName: 200,
  playerName: 64,
  archetypeName: 64,
  /** Entries read from one tournament's standings. */
  standings: 4_096,
  icons: 4,
  /** The fewest players an indexed tournament has. */
  minimumPlayers: 8,
  /** The earliest tournament worth reading: Limitless lists junk from 1970. */
  earliestDate: Date.parse('2015-01-01T00:00:00.000Z'),
});

/** A tournament as the list shows it. */
export interface ListedTournament {
  readonly id: string;
  readonly name: string;
  readonly date: number;
  /** Null for a format whose lists aren't kept (or a row with none). */
  readonly format: IndexedFormat | null;
  /** Listed in a format whose lists aren't kept, not merely none yet. */
  readonly otherFormat?: boolean;
  readonly players: number;
  readonly organizerId: number | null;
  /** Worth indexing: a kept format, a real date, enough players. */
  readonly indexable: boolean;
}

/**
 * The rows of `/tournaments`. Rows that aren't Pokémon TCG tournaments or
 * whose id, name or date are malformed are dropped; the rest are kept,
 * marked indexable or not, so a later page of known rows can be told
 * apart from a page of new ones.
 */
export const readTournamentList = (value: unknown): ListedTournament[] => {
  if (!Array.isArray(value)) return [];
  const rows: ListedTournament[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || entry.game !== 'PTCG') continue;
    const { id, date, players, organizerId } = entry;
    const name = boundedName(entry.name, PARSE_LIMITS.tournamentName);
    const time = typeof date === 'string' ? Date.parse(date) : Number.NaN;
    if (
      typeof id !== 'string' ||
      !LIMITLESS_TOURNAMENT_ID.test(id) ||
      name === null ||
      !Number.isFinite(time) ||
      // No event is this big: a bad value, which the app would refuse.
      (typeof players === 'number' && players > MAX_TOURNAMENT_PLAYERS)
    ) {
      continue;
    }
    const count =
      Number.isSafeInteger(players) && (players as number) >= 0
        ? (players as number)
        : 0;
    const format = isIndexedFormat(entry.format) ? entry.format : null;
    const otherFormat =
      format === null &&
      typeof entry.format === 'string' &&
      entry.format.trim() !== '';
    rows.push({
      id,
      name,
      date: time,
      format,
      players: count,
      organizerId:
        Number.isSafeInteger(organizerId) && (organizerId as number) >= 0
          ? (organizerId as number)
          : null,
      indexable:
        format !== null &&
        time >= PARSE_LIMITS.earliestDate &&
        count >= PARSE_LIMITS.minimumPlayers,
      ...(otherFormat ? { otherFormat: true } : {}),
    });
  }
  return rows;
};

export interface ArchetypeRef {
  readonly id: string;
  readonly name: string;
  readonly icons: readonly string[];
}

export interface StandingEntry {
  readonly playerId: string;
  readonly name: string;
  readonly country: string | null;
  /** Null for a player who dropped without a final placing. */
  readonly placing: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly dropped: boolean;
  readonly archetype: ArchetypeRef | null;
  /** The list as importable text, or null when none was published. */
  readonly list: string | null;
}

/**
 * A Limitless username: it is used in a URL path, so kept plain, and with a
 * letter or digit in it (`..` would be a path of its own).
 */
export const PLAYER_ID = /^(?=[^A-Za-z0-9]*[A-Za-z0-9])[A-Za-z0-9_.-]{1,64}$/u;
/** The most players an event can list (the app's own bound). */
export const MAX_TOURNAMENT_PLAYERS = 1_000_000;
/** A major from Limitless Labs (labs.ts): `labs-0077`. */
export const MAJOR_TOURNAMENT_ID = /^labs-\d{4,6}$/u;
/** Any tournament the index holds: an online event's id or a major's. */
export const isIndexTournamentId = (id: string): boolean =>
  LIMITLESS_TOURNAMENT_ID.test(id) || MAJOR_TOURNAMENT_ID.test(id);
/** An archetype id: a slug like `dragapult-dusknoir` or `basic-box-m`. */
export const ARCHETYPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,9}$/u;
const ICON = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/u;
const COUNTRY = /^[A-Z]{2}$/u;

const count = (value: unknown): number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < 1_000
    ? (value as number)
    : 0;

const readArchetype = (value: unknown): ArchetypeRef | null => {
  if (!isRecord(value)) return null;
  const { id, icons } = value;
  const name = boundedName(value.name, PARSE_LIMITS.archetypeName);
  if (
    typeof id !== 'string' ||
    id === 'other' ||
    id.length > 64 ||
    !ARCHETYPE_ID.test(id) ||
    name === null
  ) {
    return null;
  }
  return {
    id,
    name,
    icons: Array.isArray(icons)
      ? icons
          .filter(
            (icon): icon is string =>
              typeof icon === 'string' && icon.length <= 40 && ICON.test(icon)
          )
          .slice(0, PARSE_LIMITS.icons)
      : [],
  };
};

/**
 * One tournament's standings, sorted by placing with the players who
 * dropped (no placing) last. A player listed twice keeps their first row.
 */
export const readStandings = (value: unknown): StandingEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: StandingEntry[] = [];
  for (const row of value.slice(0, PARSE_LIMITS.standings)) {
    if (!isRecord(row)) continue;
    const { player, placing, record, drop, country } = row;
    if (typeof player !== 'string' || !PLAYER_ID.test(player)) continue;
    if (seen.has(player)) continue;
    const name = boundedName(row.name, PARSE_LIMITS.playerName) ?? player;
    const place =
      Number.isSafeInteger(placing) &&
      (placing as number) >= 1 &&
      (placing as number) <= 100_000
        ? (placing as number)
        : null;
    seen.add(player);
    entries.push({
      playerId: player,
      name,
      country:
        typeof country === 'string' && COUNTRY.test(country) ? country : null,
      placing: place,
      wins: isRecord(record) ? count(record.wins) : 0,
      losses: isRecord(record) ? count(record.losses) : 0,
      ties: isRecord(record) ? count(record.ties) : 0,
      dropped: drop !== null && drop !== undefined && drop !== -1,
      archetype: readArchetype(row.deck),
      list: decklistText(row.decklist),
    });
  }
  return entries.sort(
    (left, right) =>
      (left.placing ?? Number.MAX_SAFE_INTEGER) -
        (right.placing ?? Number.MAX_SAFE_INTEGER) ||
      left.playerId.localeCompare(right.playerId)
  );
};
