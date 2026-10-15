import {
  CARD_CATEGORIES,
  deckListOf,
  isDeckFormatId,
  MAX_ENTRY_COUNT,
  type DeckCard,
  type DeckFormatId,
  type DeckList,
} from '@ptcgsim/deck-core';

/**
 * The player's saved decks, kept on this device.
 *
 * - Decks live in IndexedDB, one record each, so a library of hundreds of
 *   decks costs nothing until it is opened and an edit writes one deck, not
 *   all of them. Where IndexedDB is missing or blocked (private windows in
 *   some browsers), the library still works for the visit and says so.
 * - Edits apply in memory at once and reach storage shortly after, batched
 *   per deck, and whatever is pending is written when the page is hidden.
 * - Another tab's change arrives on a BroadcastChannel and is read back.
 * - Everything read back is decoded defensively: a record from a future or
 *   hand-edited build that doesn't decode is skipped, never thrown.
 */

export const DECK_LIBRARY_DATABASE = 'ptcgsim-decks';
const STORE = 'decks';
const CHANNEL = 'ptcgsim-deck-library';
/** Edits in a burst (a few + presses) share one write. */
const WRITE_DELAY_MS = 120;

export const MAX_DECK_NAME_LENGTH = 80;
export const MAX_DECK_NOTES_LENGTH = 4_000;
/** A deck far past any format; bounds what one record can hold. */
const MAX_DECK_ENTRIES = 400;
const MAX_URL_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 256;

export interface DeckSource {
  readonly kind: 'new' | 'paste' | 'file' | 'meta' | 'classic' | 'copy';
  /** Where it came from, as the player would say it ("Dragapult ex — 1st of 285"). */
  readonly label?: string;
}

export interface SavedDeck {
  readonly id: string;
  readonly name: string;
  readonly format: DeckFormatId;
  readonly cards: DeckList;
  /** The card that pictures the deck; its most-played Pokémon when unset. */
  readonly coverId?: string;
  readonly notes?: string;
  readonly source?: DeckSource;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type DeckLibraryStatus = 'loading' | 'ready' | 'memory';

export interface DeckLibrarySnapshot {
  readonly status: DeckLibraryStatus;
  /** Most recently changed first. */
  readonly decks: readonly SavedDeck[];
}

export interface DeckDraft {
  readonly name: string;
  readonly format: DeckFormatId;
  readonly cards: DeckList;
  readonly coverId?: string;
  readonly notes?: string;
  readonly source?: DeckSource;
}

export type DeckPatch = Partial<
  Pick<SavedDeck, 'name' | 'format' | 'cards' | 'coverId' | 'notes'>
>;

/** The part of IndexedDB the library uses, so tests can supply their own. */
export interface DeckLibraryBackend {
  readAll(): Promise<readonly unknown[]>;
  read(id: string): Promise<unknown>;
  write(decks: readonly SavedDeck[]): Promise<void>;
  remove(id: string): Promise<void>;
}

type Listener = () => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, maximum: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;

const decodeCard = (value: unknown): DeckCard | undefined => {
  if (!isRecord(value)) return undefined;
  const id = boundedString(value.id, MAX_TEXT_LENGTH);
  const name = boundedString(value.name, MAX_TEXT_LENGTH);
  const image = boundedString(value.image, MAX_URL_LENGTH);
  const category = value.category;
  if (
    !id ||
    !name ||
    !image ||
    !(CARD_CATEGORIES as readonly unknown[]).includes(category)
  ) {
    return undefined;
  }
  const optional = (key: string, maximum = MAX_TEXT_LENGTH) => {
    const text = boundedString(value[key], maximum);
    return text === undefined ? {} : { [key]: text };
  };
  return Object.freeze({
    id,
    name,
    category: category as DeckCard['category'],
    image,
    ...optional('imageSmall', MAX_URL_LENGTH),
    ...optional('set'),
    ...optional('number'),
    ...optional('setName'),
    ...optional('released'),
    // Facts and presentation are plain data the rules and the table read
    // defensively; they are kept as stored.
    ...(isRecord(value.facts) ? { facts: value.facts } : {}),
    ...(value.presentation !== undefined
      ? { presentation: value.presentation }
      : {}),
  });
};

/** Reads one stored record back into a deck, or undefined if it isn't one. */
export const decodeSavedDeck = (value: unknown): SavedDeck | undefined => {
  if (!isRecord(value)) return undefined;
  const id = boundedString(value.id, 64);
  const name = boundedString(value.name, MAX_DECK_NAME_LENGTH);
  if (
    !id ||
    name === undefined ||
    !isDeckFormatId(value.format) ||
    !Array.isArray(value.cards) ||
    value.cards.length > MAX_DECK_ENTRIES ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return undefined;
  }
  const entries: { card: DeckCard; count: number }[] = [];
  for (const entry of value.cards) {
    if (!isRecord(entry)) return undefined;
    const card = decodeCard(entry.card);
    const count = entry.count;
    if (
      !card ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > MAX_ENTRY_COUNT
    ) {
      return undefined;
    }
    entries.push({ card, count });
  }
  const source =
    isRecord(value.source) &&
    ['new', 'paste', 'file', 'meta', 'classic', 'copy'].includes(
      value.source.kind as string
    )
      ? Object.freeze({
          kind: value.source.kind as DeckSource['kind'],
          ...(boundedString(value.source.label, MAX_TEXT_LENGTH)
            ? { label: value.source.label as string }
            : {}),
        })
      : undefined;
  return Object.freeze({
    id,
    name,
    format: value.format,
    cards: deckListOf(entries),
    ...(boundedString(value.coverId, MAX_TEXT_LENGTH)
      ? { coverId: value.coverId as string }
      : {}),
    ...(boundedString(value.notes, MAX_DECK_NOTES_LENGTH)
      ? { notes: value.notes as string }
      : {}),
    ...(source ? { source } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
};

const newestFirst = (decks: Iterable<SavedDeck>): readonly SavedDeck[] =>
  Object.freeze(
    [...decks].sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
    )
  );

/** A name for a deck, cut to the length the library keeps. */
export const cleanDeckName = (name: string): string =>
  name.replaceAll(/\s+/gu, ' ').trim().slice(0, MAX_DECK_NAME_LENGTH);

/**
 * What the deck screen's views may do to saved decks. The screen hands
 * them this rather than the library, so a change a player makes here
 * reaches a seat holding that deck, and no other change does.
 */
export type DeckLibraryActions = Pick<
  DeckLibrary,
  'get' | 'update' | 'remove' | 'duplicate'
>;

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export interface DeckLibraryOptions {
  /** Null keeps decks in memory only (storage unavailable). */
  readonly backend: DeckLibraryBackend | null;
  readonly now?: () => number;
  readonly createId?: () => string;
  /** Another tab's changes; null for none. */
  readonly channel?: Pick<
    BroadcastChannel,
    'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'
  > | null;
  readonly writeDelayMs?: number;
  /** Where `pagehide` / `visibilitychange` arrive, to write before leaving. */
  readonly window?: Pick<
    Window,
    'addEventListener' | 'removeEventListener'
  > | null;
  readonly document?: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  > | null;
}

export class DeckLibrary {
  readonly #backend: DeckLibraryBackend | null;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #channel: DeckLibraryOptions['channel'];
  readonly #writeDelayMs: number;
  readonly #listeners = new Set<Listener>();
  readonly #decks = new Map<string, SavedDeck>();
  readonly #pending = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #snapshot: DeckLibrarySnapshot;
  #detach: () => void = () => undefined;

  constructor(options: DeckLibraryOptions) {
    this.#backend = options.backend;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomId;
    this.#channel = options.channel ?? null;
    this.#writeDelayMs = options.writeDelayMs ?? WRITE_DELAY_MS;
    this.#snapshot = Object.freeze({
      status: this.#backend ? 'loading' : 'memory',
      decks: Object.freeze([]),
    });
    const onMessage = (event: Event): void => {
      const data = (event as MessageEvent).data as unknown;
      if (isRecord(data) && typeof data.id === 'string') {
        void this.#reload(data.id);
      }
    };
    const onLeave = (): void => void this.flush();
    const onVisibility = (): void => {
      if (options.document?.visibilityState === 'hidden') void this.flush();
    };
    this.#channel?.addEventListener('message', onMessage);
    options.window?.addEventListener('pagehide', onLeave);
    options.document?.addEventListener('visibilitychange', onVisibility);
    this.#detach = () => {
      this.#channel?.removeEventListener('message', onMessage);
      options.window?.removeEventListener('pagehide', onLeave);
      options.document?.removeEventListener('visibilitychange', onVisibility);
    };
    if (this.#backend) void this.#load(this.#backend);
  }

  getSnapshot = (): DeckLibrarySnapshot => this.#snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get(id: string): SavedDeck | undefined {
    return this.#decks.get(id);
  }

  create(draft: DeckDraft): SavedDeck {
    const now = this.#now();
    const deck = Object.freeze({
      id: this.#createId(),
      name: cleanDeckName(draft.name) || 'Untitled deck',
      format: isDeckFormatId(draft.format) ? draft.format : 'standard',
      cards: draft.cards,
      ...(draft.coverId ? { coverId: draft.coverId } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(draft.source ? { source: draft.source } : {}),
      createdAt: now,
      updatedAt: now,
    });
    this.#put(deck, true);
    return deck;
  }

  /**
   * Changes a deck; returns it as changed, or undefined if it is gone. A
   * change the player didn't make (`touch: false`) keeps its place in the
   * list.
   */
  update(
    id: string,
    patch: DeckPatch,
    options: { readonly touch?: boolean } = {}
  ): SavedDeck | undefined {
    const current = this.#decks.get(id);
    if (!current) return undefined;
    const name =
      patch.name === undefined
        ? current.name
        : cleanDeckName(patch.name) || current.name;
    const { coverId: _cover, notes: _notes, ...rest } = current;
    const coverId = 'coverId' in patch ? patch.coverId : current.coverId;
    const notes = 'notes' in patch ? patch.notes : current.notes;
    const next: SavedDeck = Object.freeze({
      ...rest,
      name,
      format:
        patch.format !== undefined && isDeckFormatId(patch.format)
          ? patch.format
          : current.format,
      cards: patch.cards ?? current.cards,
      ...(coverId ? { coverId } : {}),
      ...(notes ? { notes: notes.slice(0, MAX_DECK_NOTES_LENGTH) } : {}),
      updatedAt: options.touch === false ? current.updatedAt : this.#now(),
    });
    this.#put(next);
    return next;
  }

  duplicate(id: string): SavedDeck | undefined {
    const current = this.#decks.get(id);
    if (!current) return undefined;
    return this.create({
      name: `${current.name} (copy)`,
      format: current.format,
      cards: current.cards,
      ...(current.coverId ? { coverId: current.coverId } : {}),
      ...(current.notes ? { notes: current.notes } : {}),
      source: { kind: 'copy', label: current.name },
    });
  }

  /** Removes a deck; returns it, so the removal can be undone. */
  remove(id: string): SavedDeck | undefined {
    const current = this.#decks.get(id);
    if (!current) return undefined;
    this.#decks.delete(id);
    this.#pending.delete(id);
    this.#publish();
    void this.#backend
      ?.remove(id)
      .then(() => this.#announce(id))
      .catch(() => undefined);
    return current;
  }

  /** Puts a removed deck back exactly as it was. */
  restore(deck: SavedDeck): void {
    this.#put(deck, true);
  }

  /** Writes every pending change now. */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const decks = [...this.#pending].flatMap((id) => {
      const deck = this.#decks.get(id);
      return deck ? [deck] : [];
    });
    this.#pending.clear();
    if (!this.#backend || decks.length === 0) return;
    try {
      await this.#backend.write(decks);
      for (const deck of decks) this.#announce(deck.id);
    } catch {
      // Full or blocked: the decks stay in memory for this visit.
    }
  }

  dispose(): void {
    void this.flush();
    this.#detach();
    this.#channel?.close();
    this.#listeners.clear();
  }

  /**
   * Keeps a deck and schedules its write. A new deck (or one put back) is
   * written at once: a page closed right after an import keeps it.
   */
  #put(deck: SavedDeck, now = false): void {
    this.#decks.set(deck.id, deck);
    this.#publish();
    if (!this.#backend) return;
    this.#pending.add(deck.id);
    if (now) {
      void this.flush();
      return;
    }
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#writeDelayMs);
  }

  async #load(backend: DeckLibraryBackend): Promise<void> {
    let records: readonly unknown[];
    try {
      records = await backend.readAll();
    } catch {
      this.#snapshot = Object.freeze({ ...this.#snapshot, status: 'memory' });
      this.#notify();
      return;
    }
    for (const record of records) {
      const deck = decodeSavedDeck(record);
      // A deck made during the load is newer than what storage had.
      if (deck && !this.#decks.has(deck.id)) this.#decks.set(deck.id, deck);
    }
    this.#snapshot = Object.freeze({
      status: 'ready',
      decks: newestFirst(this.#decks.values()),
    });
    this.#notify();
  }

  async #reload(id: string): Promise<void> {
    if (!this.#backend || this.#pending.has(id)) return;
    let record: unknown;
    try {
      record = await this.#backend.read(id);
    } catch {
      return;
    }
    const deck = decodeSavedDeck(record);
    if (deck) this.#decks.set(id, deck);
    else this.#decks.delete(id);
    this.#publish();
  }

  #announce(id: string): void {
    try {
      this.#channel?.postMessage({ id });
    } catch {
      // A closed channel: other tabs catch up on their next load.
    }
  }

  #publish(): void {
    this.#snapshot = Object.freeze({
      status: this.#snapshot.status,
      decks: newestFirst(this.#decks.values()),
    });
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

const request = <T>(operation: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    operation.addEventListener('success', () => resolve(operation.result));
    operation.addEventListener('error', () => reject(operation.error));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });

/** The library's IndexedDB store, or null where IndexedDB can't be opened. */
export const openIndexedDbDeckBackend = async (
  factory: IDBFactory | undefined = globalThis.indexedDB
): Promise<DeckLibraryBackend | null> => {
  if (!factory) return null;
  let database: IDBDatabase;
  try {
    const opening = factory.open(DECK_LIBRARY_DATABASE, 1);
    opening.addEventListener('upgradeneeded', () => {
      if (!opening.result.objectStoreNames.contains(STORE)) {
        opening.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    });
    database = await request(opening);
  } catch {
    return null;
  }
  // Another tab upgrading the database asks this one to let go.
  database.addEventListener('versionchange', () => database.close());
  const store = (mode: IDBTransactionMode) => {
    const transaction = database.transaction(STORE, mode);
    return { transaction, objects: transaction.objectStore(STORE) };
  };
  return {
    async readAll() {
      return await request(store('readonly').objects.getAll());
    },
    async read(id) {
      return await request(store('readonly').objects.get(id));
    },
    async write(decks) {
      const { transaction, objects } = store('readwrite');
      for (const deck of decks) objects.put(deck);
      await transactionDone(transaction);
    },
    async remove(id) {
      const { transaction, objects } = store('readwrite');
      objects.delete(id);
      await transactionDone(transaction);
    },
  };
};

/** A backend that opens IndexedDB on first use and falls back to memory. */
const lazyIndexedDbBackend = (): DeckLibraryBackend => {
  let opened: Promise<DeckLibraryBackend | null> | undefined;
  const backend = async (): Promise<DeckLibraryBackend> => {
    opened ??= openIndexedDbDeckBackend().catch(() => null);
    const resolved = await opened;
    if (!resolved) throw new Error('IndexedDB is unavailable.');
    return resolved;
  };
  return {
    readAll: async () => await (await backend()).readAll(),
    read: async (id) => await (await backend()).read(id),
    write: async (decks) => await (await backend()).write(decks),
    remove: async (id) => await (await backend()).remove(id),
  };
};

let pageLibrary: DeckLibrary | undefined;

/** The page's deck library, backed by this browser's IndexedDB. */
export const deckLibrary = (): DeckLibrary => {
  pageLibrary ??= new DeckLibrary({
    backend: typeof indexedDB === 'undefined' ? null : lazyIndexedDbBackend(),
    channel:
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(CHANNEL),
    window: typeof window === 'undefined' ? null : window,
    document: typeof document === 'undefined' ? null : document,
  });
  return pageLibrary;
};
