import { t } from '@lingui/core/macro';
import {
  CARD_CATEGORIES,
  deckListOf,
  isDeckFormatId,
  MAX_ENTRY_COUNT,
  type CardRuleFacts,
  type DeckCard,
  type DeckFormatId,
  type DeckList,
} from '@ptcgsim/deck-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

/**
 * The player's saved decks, kept on this device.
 *
 * - Decks live in IndexedDB, one record each, so a library of hundreds of
 *   decks costs nothing until it is opened and an edit writes one deck, not
 *   all of them. Where IndexedDB is missing or blocked (private windows in
 *   some browsers), the library still works for the visit and says so.
 * - Edits apply in memory at once and reach storage shortly after, batched
 *   per deck, and whatever is pending is written when the page is hidden.
 * - Another tab's change arrives on a BroadcastChannel and is read back,
 *   unless this tab changed that deck meanwhile.
 * - A write or removal that fails (storage full or taken away) leaves the
 *   library `memory`, so the screen says changes last only for this visit,
 *   until the next write has tried it again and it went through.
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
/**
 * Bounds what one record can hold: as many cards as an import can bring
 * (a pasted list's 10,000 lines, deck-core's MAX_PASTED_DECKLIST_LINES), so
 * a deck the library saves always reads back. One too big for the table
 * says so when it is put on a seat.
 */
const MAX_DECK_ENTRIES = 10_000;
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
  /**
   * The card back it is played in, chosen on a seat it was on; unset, a
   * seat plays it in that seat's own.
   */
  readonly cardBack?: string;
  readonly notes?: string;
  readonly source?: DeckSource;
  /**
   * The catalog (when the server built it) the cards' facts were last
   * brought up to: a tab with an older one leaves them be. Gone once the
   * cards change any other way.
   */
  readonly factsFrom?: string;
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
  readonly cardBack?: string;
  readonly notes?: string;
  readonly source?: DeckSource;
}

export type DeckPatch = Partial<
  Pick<
    SavedDeck,
    'name' | 'format' | 'cards' | 'coverId' | 'cardBack' | 'notes' | 'factsFrom'
  >
>;

/** The part of IndexedDB the library uses, so tests can supply their own. */
export interface DeckLibraryBackend {
  readAll(): Promise<readonly unknown[]>;
  read(id: string): Promise<unknown>;
  /**
   * Automatic updates name the records they were made from. Compare those
   * records and write in one transaction; return the ids skipped because
   * storage has changed. Ordinary player edits have no such condition.
   */
  write(
    decks: readonly SavedDeck[],
    originals?: ReadonlyMap<string, SavedDeck>
  ): Promise<void | ReadonlySet<string>>;
  remove(id: string): Promise<void>;
}

type Listener = () => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, maximum: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;

/**
 * The rule facts a stored card kept, each one only if it has the shape the
 * rules read: a malformed one is dropped (the catalog gives it back), so
 * one bad record can't throw in the deck check.
 */
const decodeFacts = (value: unknown): CardRuleFacts | undefined => {
  if (!isRecord(value)) return undefined;
  const text = (key: keyof CardRuleFacts) => {
    const found = boundedString(value[key], MAX_TEXT_LENGTH);
    return found === undefined ? {} : { [key]: found };
  };
  const { tags, energyType, legal, pocket } = value;
  const legality = isRecord(legal)
    ? {
        ...(typeof legal.standard === 'boolean'
          ? { standard: legal.standard }
          : {}),
        ...(typeof legal.expanded === 'boolean'
          ? { expanded: legal.expanded }
          : {}),
      }
    : {};
  return Object.freeze({
    ...text('stage'),
    ...text('evolvesFrom'),
    ...text('line'),
    ...text('trainerType'),
    ...text('regulationMark'),
    ...(Array.isArray(tags) &&
    tags.every((tag) => boundedString(tag, MAX_TEXT_LENGTH) !== undefined)
      ? { tags: Object.freeze([...(tags as string[])]) }
      : {}),
    ...(energyType === 'Basic' || energyType === 'Special'
      ? { energyType }
      : {}),
    ...(Object.keys(legality).length > 0
      ? { legal: Object.freeze(legality) }
      : {}),
    ...(typeof pocket === 'boolean' ? { pocket } : {}),
  });
};

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
    ...(isRecord(value.facts) ? { facts: decodeFacts(value.facts) } : {}),
    // Presentation is plain data the table reads defensively; it is kept
    // as stored.
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
    // As long as the table takes, so a deck's back always reaches it.
    ...(boundedString(value.cardBack, MAX_IMAGE_URL_CODE_UNITS)
      ? { cardBack: value.cardBack as string }
      : {}),
    ...(boundedString(value.notes, MAX_DECK_NOTES_LENGTH)
      ? { notes: value.notes as string }
      : {}),
    ...(source ? { source } : {}),
    ...(boundedString(value.factsFrom, 64)
      ? { factsFrom: value.factsFrom as string }
      : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
};

/** Stored objects may return their fields in another order. */
const sameStoredValue = (
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>()
): boolean => {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length !== right.length
  )
    return false;
  if (seen.get(left)?.has(right)) return true;
  const pairs = seen.get(left) ?? new WeakSet<object>();
  pairs.add(right);
  seen.set(left, pairs);
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = (value: Record<string, unknown>) =>
    Object.keys(value).filter((key) => value[key] !== undefined);
  const ours = keys(a);
  return (
    ours.length === keys(b).length &&
    ours.every(
      (key) => Object.hasOwn(b, key) && sameStoredValue(a[key], b[key], seen)
    )
  );
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
  /** Snapshots still waiting for their storage transaction's outcome. */
  readonly #writing = new Set<readonly SavedDeck[]>();
  /**
   * Pending decks whose only change here is one the player didn't make
   * (`touch: false`, facts brought up to the catalog): another tab's write
   * is newer, and it gives way. Keep the original record until written,
   * even through several automatic changes or a failed write: a channel
   * notification may arrive after the write's timer.
   */
  readonly #automatic = new Map<string, SavedDeck>();
  /** Decks removed here and not yet from storage. */
  readonly #removals = new Set<string>();
  /** Decks whose last write or removal failed. */
  readonly #unsaved = new Set<string>();
  /** Decks holding a player's change whose write failed. */
  readonly #held = new Set<string>();
  /** How many times each deck changed here, so a read-back can tell. */
  readonly #edits = new Map<string, number>();
  #loaded: 'loading' | 'ready' | 'failed';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #snapshot: DeckLibrarySnapshot;
  #detach: () => void = () => undefined;

  constructor(options: DeckLibraryOptions) {
    this.#backend = options.backend;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomId;
    this.#channel = options.channel ?? null;
    this.#writeDelayMs = options.writeDelayMs ?? WRITE_DELAY_MS;
    this.#loaded = this.#backend ? 'loading' : 'failed';
    this.#snapshot = Object.freeze({
      status: this.#status(),
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
      name: cleanDeckName(draft.name) || t`Untitled deck`,
      format: isDeckFormatId(draft.format) ? draft.format : 'standard',
      cards: draft.cards,
      ...(draft.coverId ? { coverId: draft.coverId } : {}),
      ...(draft.cardBack ? { cardBack: draft.cardBack } : {}),
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
   * list, and gives way to another tab's write before it is written.
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
    const {
      coverId: _cover,
      cardBack: _cardBack,
      notes: _notes,
      factsFrom: _factsFrom,
      ...rest
    } = current;
    const coverId = 'coverId' in patch ? patch.coverId : current.coverId;
    const cardBack = 'cardBack' in patch ? patch.cardBack : current.cardBack;
    const notes = 'notes' in patch ? patch.notes : current.notes;
    const factsFrom =
      'factsFrom' in patch
        ? patch.factsFrom
        : patch.cards
          ? undefined
          : current.factsFrom;
    const next: SavedDeck = Object.freeze({
      ...rest,
      name,
      format:
        patch.format !== undefined && isDeckFormatId(patch.format)
          ? patch.format
          : current.format,
      cards: patch.cards ?? current.cards,
      ...(coverId ? { coverId } : {}),
      ...(cardBack ? { cardBack } : {}),
      ...(notes ? { notes: notes.slice(0, MAX_DECK_NOTES_LENGTH) } : {}),
      ...(factsFrom ? { factsFrom } : {}),
      updatedAt: options.touch === false ? current.updatedAt : this.#now(),
    });
    const automatic =
      options.touch === false &&
      !this.#held.has(id) &&
      (!this.#pending.has(id) || this.#automatic.has(id));
    const original = this.#automatic.get(id) ?? current;
    this.#put(next);
    if (automatic) this.#automatic.set(id, original);
    return next;
  }

  duplicate(id: string): SavedDeck | undefined {
    const current = this.#decks.get(id);
    if (!current) return undefined;
    const name = current.name;
    return this.create({
      name: t({
        message: `${name} (copy)`,
        comment: 'The name of a duplicated deck',
      }),
      format: current.format,
      cards: current.cards,
      ...(current.coverId ? { coverId: current.coverId } : {}),
      ...(current.cardBack ? { cardBack: current.cardBack } : {}),
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
    this.#automatic.delete(id);
    this.#edited(id);
    this.#publish();
    if (this.#backend) {
      this.#removals.add(id);
      void this.flush();
    }
    return current;
  }

  /** Puts a removed deck back exactly as it was. */
  restore(deck: SavedDeck): void {
    this.#put(deck, true);
  }

  /** Writes every pending change, and removal, now. */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const decks = [...this.#pending].flatMap((id) => {
      const deck = this.#decks.get(id);
      return deck ? [deck] : [];
    });
    // A removal stays marked until storage has it, so a read-back meanwhile
    // can't bring the deck back.
    const removals = [...this.#removals];
    const automatic = new Map(this.#automatic);
    // How often each was changed here as written: changed since, by this
    // tab or only by another's write read back.
    const editsAt = new Map(
      decks.map((deck) => [deck.id, this.#edits.get(deck.id)])
    );
    this.#pending.clear();
    this.#automatic.clear();
    const backend = this.#backend;
    if (!backend) return;
    if (decks.length > 0) {
      this.#writing.add(decks);
      try {
        const skipped =
          automatic.size > 0
            ? await backend.write(decks, automatic)
            : await backend.write(decks);
        for (const deck of decks) {
          if (skipped?.has(deck.id)) {
            // Storage changed before this automatic write's transaction,
            // even if its channel message has not reached this tab. Read
            // that deck back so its facts can be refreshed from it instead.
            if (
              this.#decks.get(deck.id) === deck &&
              this.#edits.get(deck.id) === editsAt.get(deck.id)
            ) {
              if (this.#held.has(deck.id)) {
                // An earlier player's write failed while this update was
                // in flight. Its edit still needs an ordinary retry.
                this.#unsaved.add(deck.id);
                this.#pending.add(deck.id);
                this.#edited(deck.id);
              } else {
                await this.#reload(deck.id);
              }
            }
            continue;
          }
          // A previous write's failure may have queued this same snapshot
          // again while it was in flight. Its success settles that retry.
          if (this.#decks.get(deck.id) === deck) {
            this.#pending.delete(deck.id);
            this.#automatic.delete(deck.id);
          }
          this.#unsaved.delete(deck.id);
          this.#held.delete(deck.id);
          this.#announce(deck.id);
        }
      } catch {
        // Full or blocked: the decks stay in memory for this visit, and
        // are tried again with the next write.
        for (const deck of decks) {
          const current = this.#decks.get(deck.id);
          // Gone, or since read back as another tab wrote it: this tab
          // shows what storage has, nothing of its own left to keep.
          if (
            !current ||
            (current !== deck &&
              this.#edits.get(deck.id) === editsAt.get(deck.id))
          ) {
            continue;
          }
          // A player's change that didn't reach storage rides with any
          // change made on top of it since: none of it gives way.
          if (!automatic.has(deck.id)) {
            this.#automatic.delete(deck.id);
            this.#held.add(deck.id);
          }
          // An automatic-only failure gives way to a newer local change.
          // A failed player's edit stays pending even if an automatic
          // successor replaced its object and a channel read dropped that
          // successor's pending mark. Invalidate that read before it lands.
          if (current !== deck && automatic.has(deck.id)) continue;
          this.#unsaved.add(deck.id);
          this.#pending.add(deck.id);
          // Pending again: a read-back begun while it was being written
          // must not replace it.
          this.#edited(deck.id);
          if (automatic.has(deck.id) && !this.#held.has(deck.id)) {
            this.#automatic.set(deck.id, automatic.get(deck.id)!);
          }
        }
      } finally {
        this.#writing.delete(decks);
      }
    }
    for (const id of removals) {
      // Put back meanwhile: its write is the newer change.
      if (this.#decks.has(id)) continue;
      try {
        await backend.remove(id);
        this.#removals.delete(id);
        this.#unsaved.delete(id);
        this.#held.delete(id);
        this.#announce(id);
      } catch {
        // Unless an earlier try at it went through meanwhile.
        if (this.#removals.has(id)) this.#unsaved.add(id);
      }
    }
    if (this.#status() !== this.#snapshot.status) this.#publish();
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
    this.#removals.delete(deck.id);
    this.#automatic.delete(deck.id);
    this.#edited(deck.id);
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
      this.#loaded = 'failed';
      this.#publish();
      return;
    }
    for (const record of records) {
      const deck = decodeSavedDeck(record);
      // A deck made during the load is newer than what storage had.
      if (deck && !this.#decks.has(deck.id)) this.#decks.set(deck.id, deck);
    }
    this.#loaded = 'ready';
    this.#publish();
  }

  async #reload(id: string): Promise<void> {
    // Another tab wrote it: a change here the player didn't make, made
    // from what this tab had (a hidden tab's write waits a second or more),
    // would undo theirs. It is made again from what they wrote.
    const original = this.#automatic.get(id);
    if (original) {
      // These facts sit on a player's write still awaiting its outcome.
      // Dropping them and reading now could replace that player's edit
      // before its failed transaction has reached the failure handler.
      for (const batch of this.#writing) {
        if (batch.includes(original)) return;
      }
      this.#automatic.delete(id);
      this.#pending.delete(id);
      this.#unsaved.delete(id);
    }
    if (!this.#backend || this.#pending.has(id) || this.#removals.has(id)) {
      return;
    }
    const edits = this.#edits.get(id);
    let record: unknown;
    try {
      record = await this.#backend.read(id);
    } catch {
      return;
    }
    // Changed here while it was read: this tab's change is the newer one.
    if (
      this.#pending.has(id) ||
      this.#removals.has(id) ||
      this.#edits.get(id) !== edits
    ) {
      return;
    }
    const deck = decodeSavedDeck(record);
    if (deck) this.#decks.set(id, deck);
    else this.#decks.delete(id);
    // What this tab shows is what storage has.
    this.#unsaved.delete(id);
    this.#held.delete(id);
    this.#publish();
  }

  #announce(id: string): void {
    try {
      this.#channel?.postMessage({ id });
    } catch {
      // A closed channel: other tabs catch up on their next load.
    }
  }

  #edited(id: string): void {
    this.#edits.set(id, (this.#edits.get(id) ?? 0) + 1);
  }

  #status(): DeckLibraryStatus {
    if (this.#loaded === 'loading') return 'loading';
    return this.#loaded === 'failed' || this.#unsaved.size > 0
      ? 'memory'
      : 'ready';
  }

  #publish(): void {
    this.#snapshot = Object.freeze({
      status: this.#status(),
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
    async write(decks, originals) {
      const { transaction, objects } = store('readwrite');
      const done = transactionDone(transaction);
      const skipped = new Set<string>();
      try {
        for (const deck of decks) {
          const original = originals?.get(deck.id);
          if (!original) {
            objects.put(deck);
            continue;
          }
          const reading = objects.get(deck.id);
          // The compare and put stay in this transaction's request task,
          // so another tab cannot write between them.
          reading.addEventListener('success', () => {
            try {
              const expected = decodeSavedDeck(original);
              if (
                expected &&
                sameStoredValue(decodeSavedDeck(reading.result), expected)
              ) {
                objects.put(deck);
              } else {
                skipped.add(deck.id);
              }
            } catch {
              transaction.abort();
            }
          });
        }
      } catch {
        transaction.abort();
      }
      await done;
      return skipped;
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
    write: async (decks, originals) =>
      await (await backend()).write(decks, originals),
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
