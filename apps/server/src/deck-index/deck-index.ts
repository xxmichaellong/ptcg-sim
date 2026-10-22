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
});

export interface DeckIndexDependencies {
  readonly storage: IndexStorage;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly apiKey?: string;
  /** False keeps the index from ever calling Limitless (browser specs). */
  readonly enabled: boolean;
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
  readonly page: number | null;
  readonly dueAt: number;
}

const readDiscovery = (value: string | null): Discovery => {
  try {
    const parsed = JSON.parse(value ?? '') as Partial<Discovery>;
    return {
      page:
        Number.isSafeInteger(parsed.page) && (parsed.page as number) >= 1
          ? (parsed.page as number)
          : null,
      dueAt: Number.isFinite(parsed.dueAt) ? (parsed.dueAt as number) : 0,
    };
  } catch {
    return { page: null, dueAt: 0 };
  }
};

type CrawlTask =
  | { readonly kind: 'backfill'; readonly page: number }
  | { readonly kind: 'discover'; readonly page: number }
  | { readonly kind: 'read'; readonly tournament: TournamentRow }
  | { readonly kind: 'resync'; readonly tournament: TournamentRow };

export class DeckIndex {
  private readonly store: DeckIndexStore;
  private readonly reading = new Map<string, Promise<void>>();

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
      JSON.stringify({ page: discovery.page, dueAt: 0 })
    );
  }

  private get budget(): BudgetState {
    return readBudget(this.store.getMeta(META.budget));
  }

  private set budget(state: BudgetState) {
    this.store.setMeta(META.budget, JSON.stringify(state));
  }

  private task(now: number): CrawlTask | { readonly idleUntil: number } {
    const backfill = this.store.getMeta(META.backfill);
    if (backfill !== 'done') {
      const page = Number(backfill ?? '1');
      return {
        kind: 'backfill',
        page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
      };
    }
    const discovery = readDiscovery(this.store.getMeta(META.discovery));
    if (discovery.page !== null || discovery.dueAt <= now) {
      return { kind: 'discover', page: discovery.page ?? 1 };
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
        } else if (error.code !== 'not_found') {
          this.holdBack();
        }
      } else {
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
    task: { readonly kind: 'backfill' | 'discover'; readonly page: number },
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
          JSON.stringify({ page: task.page, dueAt: 0 })
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
          JSON.stringify({ page: task.page, dueAt: 0 })
        );
      }
      return;
    }
    this.recovered();
    const raw = body.length;
    const rows = readTournamentList(body);
    const known = this.store.recordListed(rows, this.deps.now());
    if (task.kind === 'backfill') {
      this.store.setMeta(
        META.backfill,
        raw < size ? 'done' : String(task.page + 1)
      );
      if (raw < size) this.finishDiscovery(now);
      return;
    }
    const settled =
      rows.length > 0 &&
      rows.every(
        (row) =>
          known.has(row.id) && row.date <= now - CRAWL_POLICY.knownAfterMs
      );
    if (raw < size || settled || task.page >= CRAWL_POLICY.incrementalPages) {
      this.finishDiscovery(now);
      return;
    }
    this.store.setMeta(
      META.discovery,
      JSON.stringify({ page: task.page + 1, dueAt: 0 })
    );
  }

  private finishDiscovery(now: number): void {
    this.store.setMeta(
      META.discovery,
      JSON.stringify({
        page: null,
        dueAt: now + CRAWL_POLICY.discoveryEveryMs,
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
  ): Promise<void> {
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
  ): Promise<void> {
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
            this.holdBack();
            this.store.recordFailure(tournament.id, this.deps.now());
            return;
          }
          this.store.forget(tournament.id);
          return;
        }
        // Not the tournament's fault: it waits for the budget, not a retry.
        if (error.code === 'rate_limited') return;
      }
      this.store.recordFailure(tournament.id, this.deps.now());
      return;
    }
    const now = this.deps.now();
    const provisional = now - tournament.date < STORE_POLICY.finishedAfterMs;
    if (response.status === 304) {
      this.recovered();
      this.store.deleteMeta(META.unknownRun);
      this.store.recordUnchanged(tournament.id, now, provisional);
      return;
    }
    if (!Array.isArray(response.body)) {
      // Limitless answering nonsense: the crawl holds back, as for an
      // outage, and the tournament waits for a retry.
      this.holdBack();
      this.store.recordFailure(tournament.id, now);
      return;
    }
    const entries = readStandings(response.body);
    if (response.body.length > 0 && entries.length === 0) {
      // Rows, none of them readable (Limitless changed their shape): what
      // is stored keeps answering, the crawl holds back as for nonsense.
      this.holdBack();
      this.store.recordFailure(tournament.id, now);
      return;
    }
    this.recovered();
    this.store.deleteMeta(META.unknownRun);
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
    if (!tournament || tournament.state === 'skipped') {
      return { kind: 'not_found' };
    }
    const now = this.deps.now();
    const young = now - tournament.date < 24 * HOUR_MS;
    const read =
      tournament.state === 'indexed' ||
      tournament.state === 'provisional' ||
      tournament.fetchedAt !== null;
    const stale =
      !read ||
      (young && (tournament.fetchedAt ?? 0) <= now - CRAWL_POLICY.liveRereadMs);
    if (stale && this.deps.enabled) {
      const allowedAt = nextAllowedAt(this.budget, 'demand', now);
      if (allowedAt <= now || this.reading.has(id)) {
        await this.read(tournament, false, 'demand');
      } else if (!read) {
        return { kind: 'busy', retryAfterMs: allowedAt - now };
      }
    }
    const current = this.store.tournament(id);
    if (!current) return { kind: 'not_found' };
    if (current.fetchedAt === null) {
      // The read failed: nothing to show yet.
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
