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

const defaultModuleLoader: PopularDecklistModuleLoader = async () =>
  await import('./popular-decklists-data.json');

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
 */
export const createPopularDecklistSource = (
  loadModule: PopularDecklistModuleLoader = defaultModuleLoader
): PopularDecklistSource => {
  let cached: PopularDecklistCollection | undefined;
  let pending: Promise<PopularDecklistCollection> | undefined;

  const load = async (options: LoadPopularDecklistsOptions = {}) => {
    throwIfAborted(options.signal);
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
    const collection = await pending;
    throwIfAborted(options.signal);
    return collection;
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
