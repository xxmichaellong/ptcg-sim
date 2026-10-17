/**
 * Keeps the card catalog (ADR-032) built and fresh, one set at a time.
 *
 * - A refresh (the daily cron, or a request that finds no catalog or a
 *   stale one) asks TCGdex for its list of sets, one request, and queues
 *   the sets that are new or whose card count changed, plus the few that
 *   were fetched longest ago, so every set is fetched again within two
 *   weeks (errata, regulation marks, late images).
 * - Each alarm step fetches one queued set (one request, two for a set
 *   whose code isn't known yet), normalizes it and stores its JSON as one
 *   value, under its content's hash. No step ever parses more than one set.
 * - When the queue is empty the catalog is published: a version hashed
 *   from every set's content, so the body only changes when a card does.
 *   A version names the stored value of each of its sets, and those are
 *   only removed once no published version names them: a set refetched
 *   mid-refresh never changes the body of the version being served.
 *   A first build publishes as it goes, every few sets, newest first, so
 *   search works before the build is done.
 * - A failed request holds the next one back for ten minutes and keeps
 *   what is stored; a set that fails three times waits for the next
 *   refresh.
 *
 * Work is serialized: refresh, steps and publishing never interleave.
 */
import { EXPANDED_BANS, STANDARD_BANS } from './bans.js';
import {
  SEEDED_SET_CODES,
  TCGDEX_GRAPHQL_URL,
  TCGDEX_REST_URL,
  TCGDEX_SETS_QUERY,
  normalizeTcgdexSets,
  setCodeFromDetails,
  tcgdexCardsOf,
  tcgdexSetCardsQuery,
  wireSetJson,
  type TcgdexSetSummary,
} from './normalize.js';

export const CARD_CATALOG_WIRE_VERSION = 1;

/**
 * What normalize.ts keeps of a card. A set stored with less is fetched
 * again at the next refresh, so a field added here reaches every set in
 * one refresh, published at once, not over the two-week rotation. 2: the
 * Weakness and Resistance modifiers. 3: a LEGEND half's stage.
 */
export const CARD_CATALOG_NORMALIZATION = 3;

export const CARD_CATALOG_LIMITS = Object.freeze({
  responseBytes: 8_000_000,
  requestTimeoutMs: 20_000,
  retryAfterMs: 10 * 60 * 1000,
  /** A list of sets older than this is fetched again on the next request. */
  staleAfterMs: 30 * 60 * 60 * 1000,
  /** Every set is fetched again within this many daily refreshes. */
  rotationDays: 14,
  /** A first build publishes after every this many sets. */
  publishEvery: 20,
  setAttempts: 3,
  stepDelayMs: 1_500,
  /** Keys per storage read. */
  readBatch: 100,
});

const KEYS = Object.freeze({
  list: 'catalog:list',
  codes: 'catalog:codes',
  queue: 'catalog:queue',
  index: 'catalog:index',
  meta: 'catalog:meta',
  retryAfter: 'catalog:retry-after',
  /** A set's cards, under their hash (without one: as stored before). */
  set: (id: string, hash?: string) =>
    hash === undefined ? `catalog:set:${id}` : `catalog:set:${id}@${hash}`,
});

/** The storage the builder needs: a Durable Object's, or a test's. */
export interface CatalogStore {
  get<T>(key: string): Promise<T | undefined>;
  getMany<T>(keys: readonly string[]): Promise<ReadonlyMap<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}

export interface CatalogManifest {
  readonly version: string;
  readonly builtAt: string;
  /** Set ids, newest first: the body's order. */
  readonly sets: readonly string[];
  readonly cards: number;
  /** False while a first build is still fetching sets. */
  readonly complete: boolean;
}

/** As stored: with where each set's cards are kept. */
interface StoredManifest extends CatalogManifest {
  readonly keys?: Readonly<Record<string, string>>;
}

interface StoredList {
  readonly listedAt: number;
  readonly sets: readonly TcgdexSetSummary[];
}

interface IndexEntry {
  readonly hash: string;
  /** Where its cards are stored (without one: `KEYS.set(id)`). */
  readonly key?: string;
  readonly cards: number;
  readonly total: number;
  readonly fetchedAt: number;
  /** `CARD_CATALOG_NORMALIZATION` when fetched (without one: 1). */
  readonly normalized?: number;
}

type CatalogIndex = Readonly<Record<string, IndexEntry>>;

interface QueueEntry {
  readonly id: string;
  readonly attempts: number;
}

export type CatalogFailureStage = 'sets' | 'set_code' | 'set_cards';

export interface CardCatalogBuilderOptions {
  readonly store: CatalogStore;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  /** Hex SHA-256 of a string. */
  readonly sha256: (value: string) => Promise<string>;
  readonly stepDelayMs?: number;
  readonly onFailure?: (stage: CatalogFailureStage) => void;
}

export class CardCatalogSourceError extends Error {
  constructor(
    readonly code: 'request_failed' | 'invalid_response',
    options: { readonly cause?: unknown } = {}
  ) {
    super(`Card catalog source failed: ${code}`, options);
    this.name = 'CardCatalogSourceError';
  }
}

const readBounded = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > CARD_CATALOG_LIMITS.responseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CardCatalogSourceError('invalid_response');
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keyOf = (id: string, entry: IndexEntry): string =>
  entry.key ?? KEYS.set(id);

/** The stored values a published version is read from. */
const publishedKeys = (meta: StoredManifest | undefined): Set<string> =>
  new Set(meta?.sets.map((id) => meta.keys?.[id] ?? KEYS.set(id)) ?? []);

const sameKeys = (
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>>
): boolean =>
  left !== undefined &&
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(right).every(([id, key]) => left[id] === key);

export class CardCatalogBuilder {
  readonly #store: CatalogStore;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #sha256: (value: string) => Promise<string>;
  readonly #stepDelayMs: number;
  readonly #onFailure: (stage: CatalogFailureStage) => void;
  #work: Promise<unknown> = Promise.resolve();

  constructor(options: CardCatalogBuilderOptions) {
    this.#store = options.store;
    this.#fetch = options.fetch;
    this.#now = options.now;
    this.#sha256 = options.sha256;
    this.#stepDelayMs = options.stepDelayMs ?? CARD_CATALOG_LIMITS.stepDelayMs;
    this.#onFailure = options.onFailure ?? (() => undefined);
  }

  /** The published catalog, if any. */
  async manifest(): Promise<CatalogManifest | null> {
    const stored = await this.#store.get<StoredManifest>(KEYS.meta);
    if (!stored) return null;
    const { keys: _keys, ...manifest } = stored;
    return manifest;
  }

  /**
   * Whether a request should start a refresh: nothing published and
   * nothing queued, or the list of sets is over a day old.
   */
  async needsRefresh(): Promise<boolean> {
    const list = await this.#store.get<StoredList>(KEYS.list);
    if (!list) return true;
    if (this.#now() - list.listedAt > CARD_CATALOG_LIMITS.staleAfterMs) {
      return true;
    }
    const meta = await this.#store.get<CatalogManifest>(KEYS.meta);
    const queue = (await this.#store.get<QueueEntry[]>(KEYS.queue)) ?? [];
    return !meta && queue.length === 0;
  }

  /** Lists the sets and queues the ones to fetch; returns how many. */
  refresh(): Promise<number> {
    return this.#exclusive(() => this.#refresh());
  }

  /**
   * A refresh if one is still due when its turn comes: requests that all
   * found the catalog stale start one refresh between them, not one each.
   */
  refreshIfDue(): Promise<number> {
    return this.#exclusive(async () =>
      (await this.needsRefresh()) ? await this.#refresh() : 0
    );
  }

  async #refresh(): Promise<number> {
    const now = this.#now();
    if (await this.#waiting(now)) return 0;
    let sets: readonly TcgdexSetSummary[];
    try {
      sets = normalizeTcgdexSets(await this.#graphql(TCGDEX_SETS_QUERY));
      if (sets.length === 0)
        throw new CardCatalogSourceError('invalid_response');
    } catch {
      await this.#fail('sets', now);
      return 0;
    }
    await this.#store.delete(KEYS.retryAfter);
    await this.#store.put(KEYS.list, {
      listedAt: now,
      sets,
    } satisfies StoredList);
    const index = (await this.#store.get<CatalogIndex>(KEYS.index)) ?? {};
    const listed = new Set(sets.map((set) => set.id));
    const newestFirst = [...sets].sort(
      (left, right) =>
        right.released.localeCompare(left.released) ||
        left.id.localeCompare(right.id)
    );
    const due = newestFirst.filter(
      (set) =>
        index[set.id]?.total !== set.total ||
        (index[set.id]?.normalized ?? 1) < CARD_CATALOG_NORMALIZATION
    );
    const rotation = Math.ceil(sets.length / CARD_CATALOG_LIMITS.rotationDays);
    const stale = sets
      .filter((set) => index[set.id]?.total === set.total)
      .sort(
        (left, right) => index[left.id]!.fetchedAt - index[right.id]!.fetchedAt
      )
      .slice(0, rotation);
    const queued = (
      (await this.#store.get<QueueEntry[]>(KEYS.queue)) ?? []
    ).filter((entry) => listed.has(entry.id));
    const ids = new Set(queued.map((entry) => entry.id));
    const queue = [...queued];
    for (const set of [...due, ...stale]) {
      if (ids.has(set.id)) continue;
      ids.add(set.id);
      queue.push({ id: set.id, attempts: 0 });
    }
    await this.#store.put(KEYS.queue, queue);
    if (queue.length > 0) await this.#schedule(now);
    else await this.#publish(now, true);
    return queue.length;
  }

  /** One alarm's work: fetches the next queued set. */
  step(): Promise<void> {
    return this.#exclusive(async () => {
      const now = this.#now();
      if (await this.#waiting(now)) return;
      const queue = (await this.#store.get<QueueEntry[]>(KEYS.queue)) ?? [];
      const [entry, ...rest] = queue;
      if (!entry) {
        await this.#publish(now, true);
        return;
      }
      const list = await this.#store.get<StoredList>(KEYS.list);
      const set = list?.sets.find((candidate) => candidate.id === entry.id);
      if (!set) {
        await this.#store.put(KEYS.queue, rest);
        await this.#continue(now, rest);
        return;
      }
      let stage: CatalogFailureStage = 'set_code';
      try {
        const code = await this.#codeFor(set);
        stage = 'set_cards';
        const cards = tcgdexCardsOf(
          await this.#graphql(tcgdexSetCardsQuery(set.id))
        );
        const index = (await this.#store.get<CatalogIndex>(KEYS.index)) ?? {};
        // TCGdex lists a few sets it has no cards for. An empty answer for
        // a set that had cards is a glitch, and what is stored stays.
        if (!cards || (cards.length === 0 && (index[set.id]?.cards ?? 0) > 0)) {
          throw new CardCatalogSourceError('invalid_response');
        }
        const built = wireSetJson(set, code, cards);
        const hash = (await this.#sha256(built.json)).slice(0, 16);
        const key = KEYS.set(set.id, hash);
        await this.#store.put(key, built.json);
        await this.#store.put(KEYS.index, {
          ...index,
          [set.id]: {
            hash,
            key,
            cards: built.cards,
            total: set.total,
            fetchedAt: now,
            normalized: CARD_CATALOG_NORMALIZATION,
          },
        } satisfies CatalogIndex);
        await this.#store.put(KEYS.queue, rest);
        await this.#store.delete(KEYS.retryAfter);
        // Cards fetched earlier this round that no version was given.
        const earlier = index[set.id];
        const before = earlier ? keyOf(set.id, earlier) : undefined;
        if (before !== undefined && before !== key) {
          const published = await this.#store.get<StoredManifest>(KEYS.meta);
          if (!publishedKeys(published).has(before)) {
            await this.#store.delete(before);
          }
        }
      } catch {
        // Tried again at the back of the queue, unless it has failed too
        // often this round; what is stored for it stays.
        const retry =
          entry.attempts + 1 < CARD_CATALOG_LIMITS.setAttempts
            ? [{ id: entry.id, attempts: entry.attempts + 1 }]
            : [];
        const queueAfter = [...rest, ...retry];
        await this.#store.put(KEYS.queue, queueAfter);
        await this.#fail(stage, now);
        if (queueAfter.length === 0) await this.#publish(now, true);
        return;
      }
      await this.#continue(now, rest);
    });
  }

  /**
   * The catalog body for a version, as parts to join, or null when that
   * version isn't the published one (or stopped being it while read).
   */
  async body(version: string): Promise<readonly string[] | null> {
    const meta = await this.#store.get<StoredManifest>(KEYS.meta);
    if (!meta || meta.version !== version) return null;
    const parts: string[] = [
      `{"v":${String(CARD_CATALOG_WIRE_VERSION)},"builtAt":${JSON.stringify(meta.builtAt)},"source":"TCGdex","bans":${JSON.stringify({ standard: STANDARD_BANS, expanded: EXPANDED_BANS })},"sets":[`,
    ];
    let first = true;
    for (
      let start = 0;
      start < meta.sets.length;
      start += CARD_CATALOG_LIMITS.readBatch
    ) {
      const keys = meta.sets
        .slice(start, start + CARD_CATALOG_LIMITS.readBatch)
        .map((id) => meta.keys?.[id] ?? KEYS.set(id));
      const stored = await this.#store.getMany<string>(keys);
      for (const key of keys) {
        const json = stored.get(key);
        // Removed: a newer version was published while this one was read.
        if (typeof json !== 'string') return null;
        parts.push(first ? json : `,${json}`);
        first = false;
      }
    }
    parts.push(']}');
    return parts;
  }

  async #continue(now: number, rest: readonly QueueEntry[]): Promise<void> {
    if (rest.length === 0) {
      await this.#publish(now, true);
      return;
    }
    const meta = await this.#store.get<StoredManifest>(KEYS.meta);
    if (!meta?.complete) {
      const index = (await this.#store.get<CatalogIndex>(KEYS.index)) ?? {};
      const stored = Object.keys(index).length;
      const published = meta?.sets.length ?? 0;
      if (stored - published >= CARD_CATALOG_LIMITS.publishEvery) {
        await this.#publish(now, false);
      }
    }
    await this.#schedule(now + this.#stepDelayMs);
  }

  async #publish(now: number, queueEmpty: boolean): Promise<void> {
    const list = await this.#store.get<StoredList>(KEYS.list);
    if (!list) return;
    const index = (await this.#store.get<CatalogIndex>(KEYS.index)) ?? {};
    const listed = new Set(list.sets.map((set) => set.id));
    const order = [...list.sets]
      .sort(
        (left, right) =>
          right.released.localeCompare(left.released) ||
          left.id.localeCompare(right.id)
      )
      .map((set) => set.id)
      .filter((id) => index[id] !== undefined);
    if (order.length === 0) return;
    const previous = await this.#store.get<StoredManifest>(KEYS.meta);
    // Sets TCGdex no longer lists leave the catalog; their cards go once
    // no published version names them.
    const removed = Object.keys(index).filter((id) => !listed.has(id));
    const unused = new Set(removed.map((id) => keyOf(id, index[id]!)));
    if (removed.length > 0) {
      const kept = Object.fromEntries(
        Object.entries(index).filter(([id]) => listed.has(id))
      );
      await this.#store.put(KEYS.index, kept);
    }
    const keys = Object.fromEntries(
      order.map((id) => [id, keyOf(id, index[id]!)])
    );
    const version = (
      await this.#sha256(
        [
          `v${String(CARD_CATALOG_WIRE_VERSION)}`,
          JSON.stringify({ STANDARD_BANS, EXPANDED_BANS }),
          ...order.map((id) => `${id}:${index[id]!.hash}`),
        ].join('\n')
      )
    ).slice(0, 20);
    // Complete once every listed set has had its turn this round; a set
    // that failed keeps its last stored cards, or has none yet.
    const complete = queueEmpty;
    if (
      previous?.version === version &&
      previous.complete === complete &&
      sameKeys(previous.keys, keys)
    ) {
      await this.#removeUnused(unused, publishedKeys(previous));
      return;
    }
    await this.#store.put(KEYS.meta, {
      version,
      builtAt:
        previous?.version === version
          ? previous.builtAt
          : new Date(now).toISOString(),
      sets: order,
      cards: order.reduce((total, id) => total + index[id]!.cards, 0),
      complete,
      keys,
    } satisfies StoredManifest);
    // What the last version named and this one doesn't.
    for (const key of publishedKeys(previous)) unused.add(key);
    await this.#removeUnused(unused, new Set(Object.values(keys)));
  }

  async #removeUnused(
    keys: ReadonlySet<string>,
    named: ReadonlySet<string>
  ): Promise<void> {
    for (const key of keys) {
      if (!named.has(key)) await this.#store.delete(key);
    }
  }

  async #codeFor(set: TcgdexSetSummary): Promise<string | undefined> {
    const seeded = SEEDED_SET_CODES[set.id];
    if (seeded) return seeded;
    const learned =
      (await this.#store.get<Record<string, string>>(KEYS.codes)) ?? {};
    if (set.id in learned) return learned[set.id] || undefined;
    const details = await this.#getJson(
      `${TCGDEX_REST_URL}/sets/${encodeURIComponent(set.id)}`
    );
    const code = setCodeFromDetails(set.id, details) ?? '';
    await this.#store.put(KEYS.codes, { ...learned, [set.id]: code });
    return code || undefined;
  }

  async #waiting(now: number): Promise<boolean> {
    const retryAfter = await this.#store.get<number>(KEYS.retryAfter);
    if (typeof retryAfter === 'number' && now < retryAfter) {
      await this.#schedule(retryAfter);
      return true;
    }
    return false;
  }

  async #fail(stage: CatalogFailureStage, now: number): Promise<void> {
    this.#onFailure(stage);
    const retryAfter = now + CARD_CATALOG_LIMITS.retryAfterMs;
    await this.#store.put(KEYS.retryAfter, retryAfter);
    await this.#schedule(retryAfter);
  }

  /** Sets the alarm, unless one is already due sooner. */
  async #schedule(at: number): Promise<void> {
    const current = await this.#store.getAlarm();
    if (current !== null && current <= at && current > this.#now()) return;
    await this.#store.setAlarm(at);
  }

  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#work.then(work, work);
    this.#work = next.catch(() => undefined);
    return next;
  }

  #graphql(query: string): Promise<unknown> {
    return this.#getJson(TCGDEX_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  }

  async #getJson(url: string, init: RequestInit = {}): Promise<unknown> {
    // The deadline covers the body too and is cleared once it is read.
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(),
      CARD_CATALOG_LIMITS.requestTimeoutMs
    );
    try {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          headers: { accept: 'application/json', ...(init.headers ?? {}) },
          signal: deadline.signal,
        });
      } catch (cause) {
        throw new CardCatalogSourceError('request_failed', { cause });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new CardCatalogSourceError('request_failed');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBounded(response)) as unknown;
      } catch (cause) {
        if (cause instanceof CardCatalogSourceError) throw cause;
        throw new CardCatalogSourceError('invalid_response', { cause });
      }
      if (!isRecord(parsed))
        throw new CardCatalogSourceError('invalid_response');
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Where the builder keeps things, for tests and operators. */
export const CARD_CATALOG_STORAGE_KEYS = KEYS;
