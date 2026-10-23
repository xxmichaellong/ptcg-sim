/**
 * The tournament deck index (ADR-037): every Limitless online tournament's
 * standings and lists, read a little at a time, searchable by deck.
 *
 * - Discovery reads the tournament list: the whole of it once (pages of
 *   1,000), then every half hour its newest pages until one holds only
 *   tournaments already known and over two days old.
 * - Each crawl step reads one tournament's standings: finished ones, recent
 *   big Standard events first, then newest and biggest; then the recent
 *   ones again weekly, conditionally, as Limitless re-categorises decks.
 * - A player opening a tournament not read yet has it read at once, from a
 *   share of the budget the crawl never uses (budget.ts); two asking at the
 *   same time share one read.
 *
 * Work is one step at a time: each step makes at most one request.
 */
import {
  LimitlessRequestError,
  limitlessGet,
  type LimitlessResponse,
} from '../limitless.js';
import {
  EMPTY_BUDGET,
  nextAllowedAt,
  observe,
  readBudget,
  spend,
  type BudgetState,
  type RequestKind,
} from './budget.js';
import { nameWords, searchTerms } from './normalize.js';
import {
  readStandings,
  readTournamentList,
  type IndexedFormat,
} from './parse.js';
import {
  DeckIndexStore,
  STORE_POLICY,
  finishKeyOf,
  type ArchetypeResult,
  type FinishKey,
  type FinishRow,
  type IndexStorage,
  type StandingRow,
  type TournamentRow,
} from './store.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const CRAWL_POLICY = Object.freeze({
  discoveryEveryMs: 30 * MINUTE_MS,
  backfillPageSize: 1_000,
  incrementalPageSize: 100,
  /** A page of known tournaments at least this old ends a discovery run. */
  knownAfterMs: 48 * HOUR_MS,
  /** Never more pages than this in one discovery run. */
  incrementalPages: 20,
  /**
   * Backfill pages in a row that repeat the one before, short of the
   * oldest event reached, before it takes the list for one ignoring its
   * page number.
   */
  backfillStalePages: 3,
  /** The gap between crawl requests while there is work. */
  stepGapMs: 15_000,
  responseBytes: 8_000_000,
  requestTimeoutMs: 15_000,
  /** A tournament under a day old is read again when asked after this. */
  liveRereadMs: 5 * MINUTE_MS,
  /** After Limitless fails, the crawl waits this long, doubling each time. */
  firstHoldMs: 30_000,
  maximumHoldMs: 30 * MINUTE_MS,
  /**
   * Events answered as unknown in a row before the rest are taken for
   * Limitless refusing (nothing more forgotten, the crawl held back).
   */
  unknownBeforeHold: 2,
});

const readStandingsDown = (
  value: string | null
): {
  readonly since: number;
  readonly first: string;
  readonly many: boolean;
} | null => {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'since' in parsed &&
      typeof parsed.since === 'number' &&
      'first' in parsed &&
      typeof parsed.first === 'string' &&
      'many' in parsed &&
      typeof parsed.many === 'boolean'
    ) {
      return { since: parsed.since, first: parsed.first, many: parsed.many };
    }
  } catch {
    // Unreadable: as if none were noted.
  }
  return null;
};

/**
 * How a standings read ended: read (or unchanged), failed (a try), waiting
 * on Limitless's rate limit (no fault of the event's), or the event gone.
 */
type ReadOutcome = 'read' | 'failed' | 'waiting' | 'gone';

const META = Object.freeze({
  budget: 'budget',
  /** The next page of the first, whole-list discovery, or `done`. */
  backfill: 'backfill',
  /** `{ page, dueAt }`: the incremental discovery run. */
  discovery: 'discovery',
  /** Failed requests in a row, and the crawl held back until when. */
  failures: 'failures',
  heldUntil: 'held-until',
  /**
   * Events answered as unknown in a row since a standings read last
   * answered: kept with the index, so neither a list page nor a restart
   * lets a storm of them forget more.
   */
  unknownRun: 'unknown-run',
  /**
   * `{ since, first, many }`: standings reads failing since `since`, none
   * answered since, `many` once two events have failed (Limitless's
   * standings down, not one event's). The list can keep answering through
   * it, and the events given up on meanwhile are tried afresh after.
   */
  standingsDown: 'standings-down',
});

export interface DeckIndexDependencies {
  readonly storage: IndexStorage;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly apiKey?: string;
  /** False keeps the index from ever calling Limitless (browser specs). */
  readonly enabled: boolean;
  /**
   * Limitless failed the crawl -- down, refusing, or answering what can't
   * be read (`failed`) -- or refused a request, a player's too, for its
   * rate limit (`rate_limited`): told each time, for the operator (it is
   * caught here, and the crawl holds back and goes on).
   */
  readonly onFailure?: (reason: 'failed' | 'rate_limited') => void;
}

export interface TournamentSummary {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly format: IndexedFormat | null;
  readonly players: number;
  /** Not read from Limitless yet (it would cost a request per event). */
  readonly organizer: null;
  /** Null until the standings have been read. */
  readonly hasLists: boolean | null;
}

export interface FinishSummary {
  readonly tournament: {
    readonly id: string;
    readonly name: string;
    readonly date: string;
    readonly players: number;
    readonly format: string;
  };
  readonly player: FinishRow['player'];
  readonly placing: number;
  readonly record: FinishRow['record'];
}

export type SearchAnswer =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly updatedAt: string | null;
      readonly results: readonly {
        readonly archetype: ArchetypeResult['archetype'];
        readonly lists: number;
        readonly top8s: number;
        readonly best: readonly FinishSummary[];
      }[];
    };

export type TournamentAnswer =
  | {
      readonly kind: 'ok';
      readonly tournament: TournamentSummary;
      readonly standings: readonly StandingRow[];
      /** Over a day old: what was read will not change. */
      readonly settled: boolean;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'busy'; readonly retryAfterMs: number };

export type PlayerListAnswer =
  | {
      readonly kind: 'ok';
      readonly text: string;
      readonly archetype: ArchetypeResult['archetype'] | null;
      readonly player: StandingRow['player'];
      readonly tournament: TournamentSummary;
      readonly settled: boolean;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'busy'; readonly retryAfterMs: number };

const iso = (time: number): string => new Date(time).toISOString();

export const tournamentSummary = (row: TournamentRow): TournamentSummary => ({
  id: row.id,
  name: row.name,
  date: iso(row.date),
  format: row.format,
  players: row.players,
  organizer: null,
  hasLists: row.hasLists,
});

const finishSummary = (row: FinishRow): FinishSummary => ({
  tournament: { ...row.tournament, date: iso(row.tournament.date) },
  player: row.player,
  placing: row.placing,
  record: row.record,
});

const hashList = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

interface Discovery {
  /** The page a run in progress asks for next. */
  readonly page: number | null;
  readonly dueAt: number;
  /** The page the run in progress started at. */
  readonly from?: number;
  /**
   * Where the next run starts: a run that ended at its page cap among new
   * events (the crawl off for months) goes on from there, not from page 1,
   * or the events past its last page would never be listed.
   */
  readonly resume?: number;
  /**
   * The date of the oldest event that capped run reached. The list may have
   * moved on since (the crawl off again for days): until a page goes past
   * it, one of known events isn't the end.
   */
  readonly until?: number;
}

const pageOf = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 1
    ? (value as number)
    : null;

const readDiscovery = (value: string | null): Discovery => {
  try {
    const parsed = JSON.parse(value ?? '') as Partial<Discovery>;
    const from = pageOf(parsed.from);
    const resume = pageOf(parsed.resume);
    return {
      page: pageOf(parsed.page),
      dueAt: Number.isFinite(parsed.dueAt) ? (parsed.dueAt as number) : 0,
      ...(from !== null ? { from } : {}),
      ...(resume !== null ? { resume } : {}),
      ...(Number.isFinite(parsed.until)
        ? { until: parsed.until as number }
        : {}),
    };
  } catch {
    return { page: null, dueAt: 0 };
  }
};

interface Backfill {
  readonly page: number;
  /** The date of the oldest event it has reached. */
  readonly until?: number;
  /** Pages in a row that repeated the one before, short of its reach. */
  readonly stale?: number;
  /** The date of the oldest event on the page before. */
  readonly last?: number;
}

/**
 * Where the backfill is: a page number alone from an older build, or the
 * page with the oldest event reached and the pages in a row with nothing
 * new; null once it is done.
 */
const readBackfill = (value: string | null): Backfill | null => {
  if (value === 'done') return null;
  try {
    const parsed: unknown = JSON.parse(value ?? '1');
    if (typeof parsed === 'number') return { page: pageOf(parsed) ?? 1 };
    if (typeof parsed === 'object' && parsed !== null) {
      const state = parsed as Partial<Backfill>;
      return {
        page: pageOf(state.page) ?? 1,
        ...(Number.isFinite(state.until)
          ? { until: state.until as number }
          : {}),
        ...(pageOf(state.stale) !== null
          ? { stale: state.stale as number }
          : {}),
        ...(Number.isFinite(state.last) ? { last: state.last as number } : {}),
      };
    }
  } catch {
    // Unreadable: from the start, as a first read.
  }
  return { page: 1 };
};

type CrawlTask =
  | ({ readonly kind: 'backfill' } & Backfill)
  | {
      readonly kind: 'discover';
      readonly page: number;
      /** The page this run started at. */
      readonly from: number;
      /** Resumed: the date it must reach before a page can end it. */
      readonly until?: number;
    }
  | { readonly kind: 'read'; readonly tournament: TournamentRow }
  | { readonly kind: 'resync'; readonly tournament: TournamentRow };

export class DeckIndex {
  private readonly store: DeckIndexStore;
  private readonly reading = new Map<string, Promise<ReadOutcome>>();
  /**
   * When a player's read of an event with nothing read yet last failed:
   * players don't ask Limitless for it again for a few minutes. Kept in
   * memory (an eviction forgets it, which costs one read), no rows written.
   */
  private readonly playerFailedAt = new Map<string, number>();

  constructor(private readonly deps: DeckIndexDependencies) {
    this.store = new DeckIndexStore(deps.storage);
  }

  migrate(): void {
    this.store.migrate();
  }

  get enabled(): boolean {
    return this.deps.enabled;
  }

  /** The cron: discover again now rather than at the next half hour. */
  discoverSoon(): void {
    const discovery = readDiscovery(this.store.getMeta(META.discovery));
    this.store.setMeta(
      META.discovery,
      JSON.stringify({ ...discovery, dueAt: 0 })
    );
  }

  private get budget(): BudgetState {
    return readBudget(this.store.getMeta(META.budget));
  }

  private set budget(state: BudgetState) {
    const value = JSON.stringify(state);
    // Unchanged (most rate-limit headers change nothing): no row written.
    if (value !== this.store.getMeta(META.budget)) {
      this.store.setMeta(META.budget, value);
    }
  }

  private task(now: number): CrawlTask | { readonly idleUntil: number } {
    const backfill = readBackfill(this.store.getMeta(META.backfill));
    if (backfill) {
      // An older build kept the page alone: the oldest event listed is
      // where it had reached (nothing else lists events before it ends).
      const oldest =
        backfill.until === undefined && backfill.page > 1
          ? this.store.oldestListed()
          : null;
      return {
        kind: 'backfill',
        ...backfill,
        ...(oldest !== null ? { until: oldest } : {}),
      };
    }
    const discovery = readDiscovery(this.store.getMeta(META.discovery));
    if (discovery.page !== null) {
      return {
        kind: 'discover',
        page: discovery.page,
        from: discovery.from ?? 1,
        ...(discovery.until !== undefined ? { until: discovery.until } : {}),
      };
    }
    if (discovery.dueAt <= now) {
      const page = discovery.resume ?? 1;
      return {
        kind: 'discover',
        page,
        from: page,
        ...(discovery.resume !== undefined && discovery.until !== undefined
          ? { until: discovery.until }
          : {}),
      };
    }
    // A run of "unknown" answers: one read elsewhere tells removed events
    // (it answers, the run ends and the next of them are forgotten) from
    // Limitless refusing (it fails too, and the crawl holds back).
    if (
      Number(this.store.getMeta(META.unknownRun) ?? '0') >
      CRAWL_POLICY.unknownBeforeHold
    ) {
      const probe = this.store.probe(now);
      if (probe) {
        return {
          kind: probe.state === 'indexed' ? 'resync' : 'read',
          tournament: probe,
        };
      }
    }
    const next = this.store.nextToRead(now);
    if (next) return { kind: 'read', tournament: next };
    const resync = this.store.nextToResync(now);
    if (resync) return { kind: 'resync', tournament: resync };
    const due = this.store.nextDueAt(now);
    return {
      idleUntil: Math.min(discovery.dueAt, due ?? Number.POSITIVE_INFINITY),
    };
  }

  /**
   * One crawl step: at most one request. Returns when the next step is due,
   * or null when the index is off.
   */
  async step(): Promise<number | null> {
    if (!this.deps.enabled) return null;
    const now = this.deps.now();
    const task = this.task(now);
    if ('idleUntil' in task) return Math.max(now + 1_000, task.idleUntil);
    const allowedAt = Math.max(
      nextAllowedAt(this.budget, 'crawl', now),
      this.heldUntil()
    );
    if (allowedAt > now) return allowedAt;
    switch (task.kind) {
      case 'backfill':
      case 'discover':
        await this.discover(task, now);
        break;
      case 'read':
      case 'resync':
        await this.read(task.tournament, task.kind === 'resync', 'crawl');
        break;
    }
    const after = this.deps.now();
    return Math.max(
      after + CRAWL_POLICY.stepGapMs,
      nextAllowedAt(this.budget, 'crawl', after),
      this.heldUntil()
    );
  }

  private heldUntil(): number {
    const heldUntil = Number(this.store.getMeta(META.heldUntil) ?? '0');
    return Number.isFinite(heldUntil) ? heldUntil : 0;
  }

  /**
   * One request to Limitless, counted against the budget. What Limitless
   * says of its limit is kept; a failure of Limitless itself (down, or
   * answering nonsense) holds the crawl back, longer each time in a row.
   */
  private async request(
    path: string,
    kind: RequestKind,
    etag?: string
  ): Promise<LimitlessResponse> {
    this.budget = spend(this.budget, this.deps.now(), kind);
    try {
      const response = await limitlessGet(
        {
          fetch: this.deps.fetch,
          maximumBytes: CRAWL_POLICY.responseBytes,
          timeoutMs: CRAWL_POLICY.requestTimeoutMs,
          ...(this.deps.apiKey ? { apiKey: this.deps.apiKey } : {}),
        },
        path,
        etag ? { etag } : {}
      );
      if (response.rateLimit) {
        this.budget = observe(this.budget, this.deps.now(), {
          rateLimit: response.rateLimit,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof LimitlessRequestError) {
        if (error.code === 'rate_limited') {
          this.budget = observe(this.budget, this.deps.now(), {
            rateLimited: true,
            ...(error.retryAfterMs === undefined
              ? {}
              : { retryAfterMs: error.retryAfterMs }),
          });
          this.deps.onFailure?.('rate_limited');
        } else if (error.code !== 'not_found' && kind === 'crawl') {
          this.holdBack();
        }
      } else if (kind === 'crawl') {
        // Only the crawl's own failures hold it back: players opening an
        // event broken for good would otherwise keep it held for as long
        // as they keep at it.
        this.holdBack();
      }
      throw error;
    }
  }

  /** Limitless answered as it should: the next failure holds back afresh. */
  private recovered(): void {
    this.store.deleteMeta(META.failures);
  }

  private holdBack(): void {
    this.deps.onFailure?.('failed');
    const failures = Number(this.store.getMeta(META.failures) ?? '0') + 1;
    this.store.setMeta(META.failures, String(failures));
    this.store.setMeta(
      META.heldUntil,
      String(
        this.deps.now() +
          Math.min(
            CRAWL_POLICY.maximumHoldMs,
            CRAWL_POLICY.firstHoldMs * 2 ** Math.min(failures - 1, 10)
          )
      )
    );
  }

  private async discover(
    task:
      | ({ readonly kind: 'backfill' } & Backfill)
      | {
          readonly kind: 'discover';
          readonly page: number;
          readonly from: number;
          readonly until?: number;
        },
    now: number
  ): Promise<void> {
    const size =
      task.kind === 'backfill'
        ? CRAWL_POLICY.backfillPageSize
        : CRAWL_POLICY.incrementalPageSize;
    let response: LimitlessResponse;
    try {
      response = await this.request(
        `/api/tournaments?game=PTCG&limit=${String(size)}&page=${String(task.page)}`,
        'crawl'
      );
    } catch (error) {
      // A page of the list refused (400, 404) is no event gone: the crawl
      // holds back as for an outage, rather than asking every step.
      if (
        error instanceof LimitlessRequestError &&
        error.code === 'not_found'
      ) {
        this.holdBack();
      }
      // Tried again at the next step; the page is not lost.
      if (task.kind === 'discover') {
        this.store.setMeta(
          META.discovery,
          JSON.stringify({
            page: task.page,
            dueAt: 0,
            from: task.from,
            until: task.until,
          })
        );
      }
      return;
    }
    const body = response.status === 200 ? response.body : undefined;
    if (!Array.isArray(body)) {
      // Not a page of events (Limitless answering nonsense): never the end
      // of the list. The crawl holds back and asks for the same page again.
      this.holdBack();
      if (task.kind === 'discover') {
        this.store.setMeta(
          META.discovery,
          JSON.stringify({
            page: task.page,
            dueAt: 0,
            from: task.from,
            until: task.until,
          })
        );
      }
      return;
    }
    this.recovered();
    const raw = body.length;
    const rows = readTournamentList(body);
    const known = this.store.recordListed(rows, this.deps.now());
    const oldest = rows.reduce(
      (date, row) => Math.min(date, row.date),
      Number.POSITIVE_INFINITY
    );
    // The oldest event this run has reached, kept with every page: the
    // crawl may stop at any one (turned off by a deploy) and go on after
    // the list has moved, when the page it stopped at holds events it knew.
    const reach = Math.min(oldest, task.until ?? Number.POSITIVE_INFINITY);
    const pastReach = task.until === undefined || oldest < task.until;
    if (task.kind === 'backfill') {
      // The end of the list is a page with nothing on it, not a short one
      // (Limitless may send fewer than asked for). A page past the first
      // with nothing new is the end past the oldest event reached; short of
      // it, the list moved on meanwhile, unless the page is the one before
      // again, three times in a row (a page number Limitless ignores).
      const nothingNew =
        task.page > 1 &&
        rows.length > 0 &&
        rows.every((row) => known.has(row.id));
      const repeated =
        nothingNew && task.last !== undefined && oldest === task.last;
      const stale = repeated && !pastReach ? (task.stale ?? 0) + 1 : 0;
      const end =
        raw === 0 ||
        (nothingNew && pastReach) ||
        stale >= CRAWL_POLICY.backfillStalePages;
      this.store.setMeta(
        META.backfill,
        end
          ? 'done'
          : JSON.stringify({
              page: task.page + 1,
              ...(Number.isFinite(reach) ? { until: reach } : {}),
              ...(Number.isFinite(oldest) ? { last: oldest } : {}),
              ...(stale > 0 ? { stale } : {}),
            })
      );
      if (end) this.finishDiscovery(now);
      return;
    }
    const settled =
      rows.length > 0 &&
      pastReach &&
      rows.every(
        (row) =>
          known.has(row.id) && row.date <= now - CRAWL_POLICY.knownAfterMs
      );
    if (raw < size || settled) {
      this.finishDiscovery(now);
      return;
    }
    const until = Number.isFinite(reach) ? reach : undefined;
    if (task.page - task.from + 1 >= CRAWL_POLICY.incrementalPages) {
      this.finishDiscovery(now, { page: task.page + 1, until });
      return;
    }
    this.store.setMeta(
      META.discovery,
      JSON.stringify({ page: task.page + 1, dueAt: 0, from: task.from, until })
    );
  }

  /** Ends a run; the next one starts at `resume` if given, else page 1. */
  private finishDiscovery(
    now: number,
    resume?: { readonly page: number; readonly until: number | undefined }
  ): void {
    this.store.setMeta(
      META.discovery,
      JSON.stringify({
        page: null,
        dueAt: now + CRAWL_POLICY.discoveryEveryMs,
        ...(resume !== undefined
          ? { resume: resume.page, until: resume.until }
          : {}),
      })
    );
  }

  /**
   * Reads one tournament's standings and records them. Two reads of the
   * same tournament at once share the first.
   */
  private read(
    tournament: TournamentRow,
    conditional: boolean,
    kind: RequestKind
  ): Promise<ReadOutcome> {
    const pending = this.reading.get(tournament.id);
    if (pending) return pending;
    const reading = this.readOnce(tournament, conditional, kind).finally(() =>
      this.reading.delete(tournament.id)
    );
    this.reading.set(tournament.id, reading);
    return reading;
  }

  private async readOnce(
    tournament: TournamentRow,
    conditional: boolean,
    kind: RequestKind
  ): Promise<ReadOutcome> {
    let response: LimitlessResponse;
    try {
      response = await this.request(
        `/api/tournaments/${tournament.id}/standings`,
        kind,
        conditional && tournament.etag ? tournament.etag : undefined
      );
    } catch (error) {
      if (error instanceof LimitlessRequestError) {
        if (error.code === 'not_found') {
          // An event Limitless no longer knows is forgotten -- but a run of
          // them is Limitless refusing, not events gone: nothing more is
          // forgotten until a standings read answers again. The crawl holds
          // back and moves on (a failure for this one), so an event truly
          // gone is forgotten on its retry once the run has ended.
          const run = Number(this.store.getMeta(META.unknownRun) ?? '0') + 1;
          this.store.setMeta(META.unknownRun, String(run));
          if (run > CRAWL_POLICY.unknownBeforeHold) {
            if (kind === 'crawl') this.holdBack();
            // Revived with the rest once standings answer: one really gone
            // answers unknown again and is forgotten then.
            this.standingsFailed(tournament.id, this.deps.now(), kind);
            return 'failed';
          }
          this.store.forget(tournament.id);
          return 'gone';
        }
        // Not the tournament's fault: it waits for the budget, not a retry.
        if (error.code === 'rate_limited') return 'waiting';
      }
      this.standingsFailed(tournament.id, this.deps.now(), kind);
      return 'failed';
    }
    const now = this.deps.now();
    const provisional = now - tournament.date < STORE_POLICY.finishedAfterMs;
    if (response.status === 304) {
      this.recovered();
      this.store.deleteMeta(META.unknownRun);
      this.standingsAnswered();
      this.store.recordUnchanged(tournament.id, now, provisional);
      return 'read';
    }
    if (!Array.isArray(response.body)) {
      // Limitless answering nonsense: the crawl holds back, as for an
      // outage, and the tournament waits for a retry.
      if (kind === 'crawl') this.holdBack();
      this.standingsFailed(tournament.id, now, kind);
      return 'failed';
    }
    const entries = readStandings(response.body);
    if (response.body.length > 0 && entries.length === 0) {
      // Rows, none of them readable (Limitless changed their shape): what
      // is stored keeps answering, the crawl holds back as for nonsense.
      if (kind === 'crawl') this.holdBack();
      this.standingsFailed(tournament.id, now, kind);
      return 'failed';
    }
    this.recovered();
    this.store.deleteMeta(META.unknownRun);
    this.standingsAnswered();
    const hashes = new Map<string, string>();
    for (const entry of entries) {
      if (entry.list && !hashes.has(entry.list)) {
        hashes.set(entry.list, await hashList(entry.list));
      }
    }
    this.store.recordStandings(tournament.id, entries, hashes, {
      now: this.deps.now(),
      etag: response.etag ?? null,
      provisional,
    });
    return 'read';
  }

  /** A standings read failed: one of the event's tries, and noted. */
  private standingsFailed(
    tournamentId: string,
    now: number,
    kind: RequestKind
  ): void {
    this.store.recordFailure(tournamentId, now, kind === 'demand');
    const down = readStandingsDown(this.store.getMeta(META.standingsDown));
    if (!down) {
      this.store.setMeta(
        META.standingsDown,
        JSON.stringify({ since: now, first: tournamentId, many: false })
      );
    } else if (!down.many && down.first !== tournamentId) {
      this.store.setMeta(
        META.standingsDown,
        JSON.stringify({ ...down, many: true })
      );
    }
  }

  /**
   * A standings read answered: after an outage (two events or more failed),
   * the events given up on during it are tried again. One event failing
   * alone is that event's, and stays given up on.
   */
  private standingsAnswered(): void {
    const down = readStandingsDown(this.store.getMeta(META.standingsDown));
    if (!down) return;
    if (down.many) this.store.reviveFailed(down.since);
    this.store.deleteMeta(META.standingsDown);
  }

  /**
   * Makes sure a tournament a player opened has been read: now, if it never
   * was (or, under a day old, not in the last few minutes) and the budget
   * kept for players allows it.
   */
  private async ensureRead(
    id: string
  ): Promise<
    | { readonly kind: 'ok'; readonly tournament: TournamentRow }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'busy'; readonly retryAfterMs: number }
  > {
    const tournament = this.store.tournament(id);
    const now = this.deps.now();
    // Skipped (its format's lists aren't kept), or not started yet: no
    // standings to read, and none worth a request.
    if (
      !tournament ||
      tournament.state === 'skipped' ||
      tournament.date > now
    ) {
      return { kind: 'not_found' };
    }
    const young = now - tournament.date < 24 * HOUR_MS;
    const read =
      tournament.state === 'indexed' ||
      tournament.state === 'provisional' ||
      tournament.fetchedAt !== null;
    const stale =
      !read ||
      (young && (tournament.fetchedAt ?? 0) <= now - CRAWL_POLICY.liveRereadMs);
    // Failed for a player a moment ago: busy until players ask again, the
    // first answer and every one after it alike.
    const failedAnswer = (
      at: number
    ): { readonly kind: 'busy'; readonly retryAfterMs: number } => ({
      kind: 'busy',
      retryAfterMs: Math.max(
        at + CRAWL_POLICY.liveRereadMs - this.deps.now(),
        nextAllowedAt(this.budget, 'demand', this.deps.now()) - this.deps.now(),
        MINUTE_MS
      ),
    });
    const failedAt = read ? undefined : this.playerFailedAt.get(id);
    if (
      failedAt !== undefined &&
      now - failedAt < CRAWL_POLICY.liveRereadMs &&
      !this.reading.has(id)
    ) {
      return failedAnswer(failedAt);
    }
    if (stale && this.deps.enabled) {
      const allowedAt = nextAllowedAt(this.budget, 'demand', now);
      if (allowedAt <= now || this.reading.has(id)) {
        // Asked as the crawl asks: unchanged since the last read, it costs
        // Limitless no body and the index no writes.
        const outcome = await this.read(tournament, true, 'demand');
        if (outcome === 'failed') {
          for (const [key, at] of this.playerFailedAt) {
            if (now - at >= CRAWL_POLICY.liveRereadMs) {
              this.playerFailedAt.delete(key);
            }
          }
          this.playerFailedAt.set(id, now);
        } else if (outcome === 'read') {
          this.playerFailedAt.delete(id);
        }
      } else if (!read) {
        return { kind: 'busy', retryAfterMs: allowedAt - now };
      }
    }
    const current = this.store.tournament(id);
    // Gone, or skipped while it was read: its format's lists aren't kept.
    if (!current || current.state === 'skipped') return { kind: 'not_found' };
    if (current.fetchedAt === null) {
      // The read failed: nothing to show yet, said as it will be said until
      // players ask again.
      const failed = this.playerFailedAt.get(id);
      if (failed !== undefined && this.deps.enabled) {
        return failedAnswer(failed);
      }
      return this.deps.enabled
        ? {
            kind: 'busy',
            retryAfterMs: Math.max(
              MINUTE_MS,
              nextAllowedAt(this.budget, 'demand', this.deps.now()) -
                this.deps.now()
            ),
          }
        : { kind: 'not_found' };
    }
    return { kind: 'ok', tournament: current };
  }

  search(query: string, format: IndexedFormat, limit: number): SearchAnswer {
    if (!this.store.hasLists()) return { available: false };
    const now = this.deps.now();
    const updatedAt = this.store.updatedAt();
    return {
      available: true,
      updatedAt: updatedAt === null ? null : iso(updatedAt),
      results: this.store
        .searchArchetypes(searchTerms(query), query, format, limit, now)
        .map((result) => ({
          archetype: result.archetype,
          lists: result.lists,
          top8s: result.top8s,
          best: result.best.map(finishSummary),
        })),
    };
  }

  archetype(
    id: string,
    format: IndexedFormat,
    sinceDays: number,
    after: FinishKey | null,
    pageSize: number
  ):
    | {
        readonly kind: 'ok';
        readonly archetype: ArchetypeResult['archetype'];
        readonly finishes: readonly FinishSummary[];
        /** The last finish shown, when there are more after it. */
        readonly next: FinishKey | null;
      }
    | { readonly kind: 'not_found' } {
    const archetype = this.store.archetype(id);
    if (!archetype) return { kind: 'not_found' };
    const rows = this.store.archetypeFinishes(
      id,
      format,
      this.deps.now() - sinceDays * 24 * HOUR_MS,
      after,
      pageSize + 1
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      kind: 'ok',
      archetype,
      finishes: page.map(finishSummary),
      next: rows.length > pageSize && last ? finishKeyOf(last) : null,
    };
  }

  tournaments(query: {
    readonly q: string;
    readonly format: IndexedFormat | null;
    readonly minimumPlayers: number;
    readonly before: { readonly date: number; readonly id: string } | null;
    readonly pageSize: number;
  }): {
    readonly tournaments: readonly TournamentSummary[];
    readonly next: { readonly date: number; readonly id: string } | null;
  } {
    const terms = nameWords(query.q);
    // Something typed with no word in it to look for matches nothing, as
    // a deck search does, rather than every event.
    if (query.q.trim() !== '' && terms.length === 0) {
      return { tournaments: [], next: null };
    }
    const rows = this.store.listTournaments({
      terms,
      format: query.format,
      minimumPlayers: query.minimumPlayers,
      before: query.before,
      limit: query.pageSize + 1,
      now: this.deps.now(),
      // Off, an event never read answers "not found" when opened.
      readOnly: !this.deps.enabled,
    });
    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);
    return {
      tournaments: page.map(tournamentSummary),
      next:
        rows.length > query.pageSize && last
          ? { date: last.date, id: last.id }
          : null,
    };
  }

  async tournament(id: string): Promise<TournamentAnswer> {
    const ensured = await this.ensureRead(id);
    if (ensured.kind !== 'ok') return ensured;
    return {
      kind: 'ok',
      tournament: tournamentSummary(ensured.tournament),
      standings: this.store.standings(id),
      settled: this.settled(ensured.tournament),
    };
  }

  async playerList(
    tournamentId: string,
    playerId: string
  ): Promise<PlayerListAnswer> {
    const ensured = await this.ensureRead(tournamentId);
    if (ensured.kind !== 'ok') return ensured;
    const list = this.store.playerList(tournamentId, playerId);
    if (!list) return { kind: 'not_found' };
    return {
      kind: 'ok',
      text: list.text,
      archetype: list.archetype,
      player: list.player,
      tournament: tournamentSummary(ensured.tournament),
      settled: this.settled(ensured.tournament),
    };
  }

  private settled(tournament: TournamentRow): boolean {
    return (
      tournament.state === 'indexed' &&
      this.deps.now() - tournament.date >= 24 * HOUR_MS
    );
  }

  /** For tests and diagnostics: the budget as it stands. */
  budgetState(): BudgetState {
    return this.store.getMeta(META.budget) === null
      ? EMPTY_BUDGET
      : this.budget;
  }
}
