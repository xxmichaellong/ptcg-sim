export const LEGACY_POPULAR_DECKLIST_SOURCE_SHA256 =
  '88cfc37dc8d9251f31dedc2217376c46dca53a4978753e8c7328f1f2144fb526';

const POPULAR_DECKLIST_LIMITS = Object.freeze({
  groups: 64,
  decks: 512,
  groupNameCodeUnits: 128,
  deckNameCodeUnits: 256,
  decklistCodeUnits: 8_192,
  totalDecklistCodeUnits: 1_000_000,
});

export interface PopularDecklist {
  readonly name: string;
  readonly decklist: string;
}

export interface PopularDecklistGroup {
  readonly name: string;
  readonly decks: readonly PopularDecklist[];
  /** Set on groups fetched from outside the app, for a credit line. */
  readonly source?: {
    readonly name: string;
    readonly url: string;
    /** When the lists were fetched (ISO 8601). */
    readonly fetchedAt: string;
  };
}

export interface PopularDecklistCollection {
  readonly groups: readonly PopularDecklistGroup[];
  readonly deckCount: number;
  readonly totalDecklistCodeUnits: number;
}

export type PopularDecklistErrorCode =
  | 'aborted'
  | 'load_failed'
  | 'invalid_corpus'
  | 'corpus_too_large'
  | 'invalid_random_source';

export class PopularDecklistError extends Error {
  constructor(
    readonly code: PopularDecklistErrorCode,
    options: { readonly cause?: unknown } = {}
  ) {
    super(`Popular deck-list operation failed: ${code}`, options);
    this.name = 'PopularDecklistError';
  }
}

export interface LoadPopularDecklistsOptions {
  readonly signal?: AbortSignal;
}

export interface SelectRandomPopularDecklistOptions extends LoadPopularDecklistsOptions {
  readonly random?: () => number;
}

export interface PopularDecklistSource {
  load(
    options?: LoadPopularDecklistsOptions
  ): Promise<PopularDecklistCollection>;
  selectRandom(
    options?: SelectRandomPopularDecklistOptions
  ): Promise<PopularDecklist>;
}

export type PopularDecklistModuleLoader = () => Promise<unknown>;

/** Recent groups to show ahead of the built-in ones; may reject. */
export type CurrentDecklistLoader = () => Promise<
  readonly PopularDecklistGroup[]
>;

const defaultModuleLoader: PopularDecklistModuleLoader = async () =>
  await import('./popular-decklists-data.json');

/** Loaded on first use, so the picker's fetch stays out of the page. */
const defaultCurrentLoader: CurrentDecklistLoader = async () => {
  const { fetchCurrentDecklists, CURRENT_DECKLISTS_SOURCE } =
    await import('./current-decklists.js');
  const current = await fetchCurrentDecklists();
  return decodePopularDecklists(current.groups).groups.map((group) =>
    Object.freeze({
      ...group,
      source: Object.freeze({
        ...CURRENT_DECKLISTS_SOURCE,
        fetchedAt: current.fetchedAt,
      }),
    })
  );
};

/** After a failed fetch of the current lists, wait before trying again. */
const CURRENT_RETRY_AFTER_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (
  code: Extract<PopularDecklistErrorCode, 'invalid_corpus' | 'corpus_too_large'>
): never => {
  throw new PopularDecklistError(code);
};

const boundedLabel = (value: unknown, maximumCodeUnits: number): string => {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_corpus');
  }
  if (value.length > maximumCodeUnits) return fail('corpus_too_large');
  return value;
};

const unwrapModule = (value: unknown): unknown =>
  isRecord(value) && Object.hasOwn(value, 'default') ? value.default : value;

export const decodePopularDecklists = (
  value: unknown
): PopularDecklistCollection => {
  const corpus = unwrapModule(value);
  if (!isRecord(corpus)) return fail('invalid_corpus');
  const rawGroups = Object.entries(corpus);
  if (
    rawGroups.length === 0 ||
    rawGroups.length > POPULAR_DECKLIST_LIMITS.groups
  ) {
    return fail(
      rawGroups.length > POPULAR_DECKLIST_LIMITS.groups
        ? 'corpus_too_large'
        : 'invalid_corpus'
    );
  }

  let deckCount = 0;
  let totalDecklistCodeUnits = 0;
  const groups = rawGroups.map(([rawGroupName, rawDecks]) => {
    const name = boundedLabel(
      rawGroupName,
      POPULAR_DECKLIST_LIMITS.groupNameCodeUnits
    );
    if (!isRecord(rawDecks)) return fail('invalid_corpus');
    const entries = Object.entries(rawDecks);
    if (entries.length === 0) return fail('invalid_corpus');

    const decks = entries.map(([rawDeckName, rawDecklist]) => {
      const deckName = boundedLabel(
        rawDeckName,
        POPULAR_DECKLIST_LIMITS.deckNameCodeUnits
      );
      if (typeof rawDecklist !== 'string' || rawDecklist.length === 0) {
        return fail('invalid_corpus');
      }
      if (rawDecklist.length > POPULAR_DECKLIST_LIMITS.decklistCodeUnits) {
        return fail('corpus_too_large');
      }
      deckCount += 1;
      totalDecklistCodeUnits += rawDecklist.length;
      if (
        deckCount > POPULAR_DECKLIST_LIMITS.decks ||
        totalDecklistCodeUnits > POPULAR_DECKLIST_LIMITS.totalDecklistCodeUnits
      ) {
        return fail('corpus_too_large');
      }
      return Object.freeze({ name: deckName, decklist: rawDecklist });
    });
    return Object.freeze({ name, decks: Object.freeze(decks) });
  });

  return Object.freeze({
    groups: Object.freeze(groups),
    deckCount,
    totalDecklistCodeUnits,
  });
};

const abortFailure = (): PopularDecklistError =>
  new PopularDecklistError('aborted');

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw abortFailure();
};

const randomIndex = (length: number, random: () => number): number => {
  let value: number;
  try {
    value = random();
  } catch (error) {
    throw new PopularDecklistError('invalid_random_source', { cause: error });
  }
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new PopularDecklistError('invalid_random_source');
  }
  return Math.floor(value * length);
};

/**
 * Owns the lazy popular-deck corpus boundary. Concurrent callers share one
 * decode, failures remain retryable, and an aborted caller cannot cancel or
 * poison the local module cache for another caller.
 *
 * Current groups (recent tournament lists) come first when they load; when
 * they cannot, the built-in corpus stands alone and the fetch is retried a
 * minute later.
 */
export const createPopularDecklistSource = (
  loadModule: PopularDecklistModuleLoader = defaultModuleLoader,
  loadCurrent: CurrentDecklistLoader | null = defaultCurrentLoader
): PopularDecklistSource => {
  let cached: PopularDecklistCollection | undefined;
  let pending: Promise<PopularDecklistCollection> | undefined;
  let current: readonly PopularDecklistGroup[] | undefined;
  let currentPending: Promise<readonly PopularDecklistGroup[]> | undefined;
  let currentFailedAt = Number.NEGATIVE_INFINITY;
  let merged:
    | {
        readonly builtIn: PopularDecklistCollection;
        readonly current: readonly PopularDecklistGroup[];
        readonly collection: PopularDecklistCollection;
      }
    | undefined;

  const loadCurrentGroups = (): Promise<readonly PopularDecklistGroup[]> => {
    if (!loadCurrent) return Promise.resolve([]);
    if (current) return Promise.resolve(current);
    if (Date.now() - currentFailedAt < CURRENT_RETRY_AFTER_MS) {
      return Promise.resolve([]);
    }
    currentPending ??= Promise.resolve()
      .then(loadCurrent)
      .then((groups) => {
        current = groups;
        return groups;
      })
      .catch(() => {
        currentFailedAt = Date.now();
        return [];
      })
      .finally(() => {
        currentPending = undefined;
      });
    return currentPending;
  };

  const withCurrent = (
    builtIn: PopularDecklistCollection,
    groups: readonly PopularDecklistGroup[]
  ): PopularDecklistCollection => {
    if (groups.length === 0) return builtIn;
    if (merged?.builtIn === builtIn && merged.current === groups) {
      return merged.collection;
    }
    const names = new Set(builtIn.groups.map((group) => group.name));
    const fresh = groups.filter((group) => !names.has(group.name));
    const collection = Object.freeze({
      groups: Object.freeze([...fresh, ...builtIn.groups]),
      deckCount:
        builtIn.deckCount +
        fresh.reduce((total, group) => total + group.decks.length, 0),
      totalDecklistCodeUnits:
        builtIn.totalDecklistCodeUnits +
        fresh.reduce(
          (total, group) =>
            total +
            group.decks.reduce((sum, deck) => sum + deck.decklist.length, 0),
          0
        ),
    });
    merged = { builtIn, current: groups, collection };
    return collection;
  };

  const load = async (options: LoadPopularDecklistsOptions = {}) => {
    throwIfAborted(options.signal);
    const currentGroups = loadCurrentGroups();
    const builtIn = await loadBuiltIn();
    const collection = withCurrent(builtIn, await currentGroups);
    throwIfAborted(options.signal);
    return collection;
  };

  const loadBuiltIn = async (): Promise<PopularDecklistCollection> => {
    if (cached) return cached;
    pending ??= Promise.resolve()
      .then(loadModule)
      .then(decodePopularDecklists)
      .then((collection) => {
        cached = collection;
        return collection;
      })
      .catch((error: unknown) => {
        if (error instanceof PopularDecklistError) throw error;
        throw new PopularDecklistError('load_failed', { cause: error });
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return Object.freeze({
    load,
    async selectRandom(options: SelectRandomPopularDecklistOptions = {}) {
      const collection = await load({
        ...(options.signal ? { signal: options.signal } : {}),
      });
      throwIfAborted(options.signal);
      const random = options.random ?? Math.random;
      const group =
        collection.groups[randomIndex(collection.groups.length, random)];
      if (!group) throw new PopularDecklistError('invalid_corpus');
      const deck = group.decks[randomIndex(group.decks.length, random)];
      if (!deck) throw new PopularDecklistError('invalid_corpus');
      return deck;
    },
  });
};

export const popularDecklistSource = createPopularDecklistSource();
