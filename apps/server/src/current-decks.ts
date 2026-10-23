/**
 * Current decks for the deck picker, from Limitless TCG's public API
 * (https://docs.limitlesstcg.com/developer/tournaments). Once a day the
 * server takes the largest finished online tournaments of the last two
 * weeks, keeps the best-placing top-8 list of every archetype, and orders
 * the archetypes by how often they made a top 8. The result has the same
 * shape as the picker's built-in corpus: group name -> deck name -> list.
 *
 * Everything read from Limitless is untrusted: responses are size-bounded,
 * and a list is kept only when every card line is well formed and the deck
 * has exactly 60 cards.
 */
import {
  LIMITLESS_TOURNAMENT_ID,
  LimitlessRequestError,
  decklistText,
  hasControl,
  isRecord,
  limitlessGet,
} from './limitless.js';

export { decklistText } from './limitless.js';

export const CURRENT_DECK_FEED_VERSION = 1;

export interface CurrentDeckFeed {
  readonly version: typeof CURRENT_DECK_FEED_VERSION;
  /** When the lists were fetched (ISO 8601). */
  readonly fetchedAt: string;
  /** Group name -> deck name -> decklist text, as the picker's corpus. */
  readonly groups: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

interface FormatPlan {
  readonly format: 'STANDARD';
  readonly groupName: string;
  readonly minimumPlayers: number;
  readonly windowDays: number;
  readonly maximumTournaments: number;
}

const FORMAT_PLANS: readonly FormatPlan[] = [
  {
    format: 'STANDARD',
    groupName: 'Current Standard',
    minimumPlayers: 64,
    windowDays: 14,
    maximumTournaments: 12,
  },
  // Expanded has had no sizeable online events on Limitless since early
  // 2025, so it is left to the built-in lists.
];

const LIMITS = Object.freeze({
  /** Tournaments listed per format, newest first (about two weeks). */
  listedTournaments: 300,
  responseBytes: 4_000_000,
  playersPerTournament: 2_048,
  topCut: 8,
  decksPerGroup: 40,
  archetypeCodeUnits: 64,
  requestTimeoutMs: 15_000,
});

/** A tournament that started this recently may still be running. */
const FINISHED_AFTER_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class CurrentDeckFeedError extends Error {
  constructor(
    readonly code: 'request_failed' | 'invalid_response' | 'no_decks',
    options: { readonly cause?: unknown } = {}
  ) {
    super(`Current deck feed failed: ${code}`, options);
    this.name = 'CurrentDeckFeedError';
  }
}

export interface CurrentDeckFeedOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  /** Raises Limitless's rate limit; optional (a secret binding). */
  readonly apiKey?: string;
}

const getJson = async (
  options: CurrentDeckFeedOptions,
  path: string
): Promise<unknown> => {
  try {
    const response = await limitlessGet(
      {
        fetch: options.fetch,
        maximumBytes: LIMITS.responseBytes,
        timeoutMs: LIMITS.requestTimeoutMs,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      },
      path
    );
    if (response.status !== 200) {
      throw new CurrentDeckFeedError('invalid_response');
    }
    return response.body;
  } catch (error) {
    if (error instanceof CurrentDeckFeedError) throw error;
    throw new CurrentDeckFeedError(
      error instanceof LimitlessRequestError &&
        error.code === 'invalid_response'
        ? 'invalid_response'
        : 'request_failed',
      { cause: error }
    );
  }
};

interface Tournament {
  readonly id: string;
  readonly players: number;
  readonly date: number;
}

const readTournaments = (value: unknown): Tournament[] => {
  if (!Array.isArray(value)) throw new CurrentDeckFeedError('invalid_response');
  const tournaments: Tournament[] = [];
  for (const entry of value.slice(0, LIMITS.listedTournaments)) {
    if (!isRecord(entry)) continue;
    const { id, players, date, game } = entry;
    const time = typeof date === 'string' ? Date.parse(date) : Number.NaN;
    if (
      game !== 'PTCG' ||
      typeof id !== 'string' ||
      !LIMITLESS_TOURNAMENT_ID.test(id) ||
      !Number.isSafeInteger(players) ||
      !Number.isFinite(time)
    ) {
      continue;
    }
    tournaments.push({ id, players: players as number, date: time });
  }
  return tournaments;
};

const ordinal = (placing: number): string => {
  const tens = placing % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][placing % 10] ?? 'th');
  return `${placing}${suffix}`;
};

interface Finish {
  readonly archetype: string;
  readonly placing: number;
  readonly players: number;
  readonly date: number;
  readonly decklist: string;
}

const readTopCut = (value: unknown, tournament: Tournament): Finish[] => {
  if (!Array.isArray(value)) throw new CurrentDeckFeedError('invalid_response');
  const finishes: Finish[] = [];
  for (const entry of value.slice(0, LIMITS.playersPerTournament)) {
    if (!isRecord(entry)) continue;
    const { placing, deck, decklist } = entry;
    if (
      !Number.isSafeInteger(placing) ||
      (placing as number) < 1 ||
      (placing as number) > LIMITS.topCut ||
      !isRecord(deck)
    ) {
      continue;
    }
    const { id, name } = deck;
    if (
      typeof id !== 'string' ||
      id === 'other' ||
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      name.length > LIMITS.archetypeCodeUnits ||
      hasControl(name)
    ) {
      continue;
    }
    const text = decklistText(decklist);
    if (!text) continue;
    finishes.push({
      archetype: name.trim(),
      placing: placing as number,
      players: tournament.players,
      date: tournament.date,
      decklist: text,
    });
  }
  return finishes;
};

/** Best first: a higher finish, then a bigger event, then a newer one. */
const better = (left: Finish, right: Finish): number =>
  left.placing - right.placing ||
  right.players - left.players ||
  right.date - left.date;

const groupFor = (
  finishes: readonly Finish[]
): Record<string, string> | null => {
  const byArchetype = new Map<string, Finish[]>();
  for (const finish of finishes) {
    const list = byArchetype.get(finish.archetype) ?? [];
    list.push(finish);
    byArchetype.set(finish.archetype, list);
  }
  const ranked = [...byArchetype.values()]
    .map((list) => list.sort(better))
    .sort(
      (left, right) =>
        right.length - left.length ||
        better(left[0]!, right[0]!) ||
        left[0]!.archetype.localeCompare(right[0]!.archetype)
    )
    .slice(0, LIMITS.decksPerGroup);
  if (ranked.length === 0) return null;
  const group: Record<string, string> = {};
  for (const list of ranked) {
    const best = list[0]!;
    group[
      `${best.archetype} — ${ordinal(best.placing)} of ${String(best.players)}`
    ] = best.decklist;
  }
  return group;
};

/** Fetches and builds the feed; fails if no format produced a single deck. */
export const fetchCurrentDeckFeed = async (
  options: CurrentDeckFeedOptions
): Promise<CurrentDeckFeed> => {
  const now = options.now();
  const groups: Record<string, Record<string, string>> = {};
  for (const plan of FORMAT_PLANS) {
    const listed = readTournaments(
      await getJson(
        options,
        `/api/tournaments?game=PTCG&format=${plan.format}&limit=${String(
          LIMITS.listedTournaments
        )}`
      )
    );
    const chosen = listed
      .filter(
        (tournament) =>
          tournament.players >= plan.minimumPlayers &&
          tournament.date <= now - FINISHED_AFTER_MS &&
          tournament.date >= now - plan.windowDays * DAY_MS
      )
      .sort((left, right) => right.players - left.players)
      .slice(0, plan.maximumTournaments);
    const finishes: Finish[] = [];
    for (const tournament of chosen) {
      finishes.push(
        ...readTopCut(
          await getJson(options, `/api/tournaments/${tournament.id}/standings`),
          tournament
        )
      );
    }
    const group = groupFor(finishes);
    if (group) groups[plan.groupName] = group;
  }
  if (Object.keys(groups).length === 0) {
    throw new CurrentDeckFeedError('no_decks');
  }
  return {
    version: CURRENT_DECK_FEED_VERSION,
    fetchedAt: new Date(now).toISOString(),
    groups,
  };
};

/** Reads a stored feed back, or null if it is not one this version wrote. */
export const readStoredCurrentDeckFeed = (
  value: unknown
): CurrentDeckFeed | null => {
  if (!isRecord(value) || value.version !== CURRENT_DECK_FEED_VERSION) {
    return null;
  }
  const { fetchedAt, groups } = value;
  if (
    typeof fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    !isRecord(groups)
  ) {
    return null;
  }
  for (const decks of Object.values(groups)) {
    if (!isRecord(decks)) return null;
    for (const list of Object.values(decks)) {
      if (typeof list !== 'string') return null;
    }
  }
  return value as unknown as CurrentDeckFeed;
};
