import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import {
  decodeSavedDeck,
  deckLibrary,
  type DeckLibrary,
  type SavedDeck,
} from '../features/deck/deck-library.js';
import {
  preferences,
  syncedPreferences,
  type Preference,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { toast } from '../ui/toast.js';
import { AccountRequestError } from './account-api.js';
import {
  accountSnapshot,
  refreshAccount,
  subscribeAccount,
} from './account-state.js';

/**
 * A signed-in player's decks and settings, the same on every device
 * (ADR-052 step 2). The account keeps each record at a revision
 * (apps/server/src/accounts/account-sync.ts); this device remembers the
 * revision and contents it last agreed on for each, so it can tell what
 * changed here, what changed there, and both.
 *
 * - Changed only here: sent, made from the revision it agreed on. If the
 *   account moved on meanwhile, it says so, and the two are compared again.
 * - Changed only there: taken.
 * - Changed in both: the later change wins (a deck's own time; a setting
 *   from another device, which reached the account first).
 * - A device's first sync takes the account's settings, and asks before
 *   adding the decks it already had: a borrowed computer's decks aren't
 *   the player's.
 *
 * Tabs share one browser's storage, so they share this too: one tab syncs
 * at a time (a Web Lock), each reading storage afresh rather than what it
 * holds in memory, so a tab behind another's change can't send it back.
 * Saved games are not here: their capabilities never touch browser storage
 * (ADR-012); the account lists them (account-saves.ts).
 */

const STATE_KEY = 'ptcgsim.account-sync.v1';
const LOCK = 'ptcgsim-account-sync';
/** Changes made here wait this long for others to join them. */
const CHANGE_DELAY_MS = 3_000;
/** A page in view asks for others' changes this often. */
const PULL_EVERY_MS = 5 * 60 * 1000;
/** A page coming back into view asks again after this long. */
const PULL_AFTER_HIDDEN_MS = 60 * 1000;
/** After a refusal for too many requests. */
const BACK_OFF_MS = 60 * 1000;
const MAX_ROUNDS = 20;
const MAX_CHANGES_PER_REQUEST = 100;
const MAX_REQUEST_CODE_UNITS = 1_500_000;
/** As the account keeps them (SYNC_LIMITS). */
const MAX_DECK_CODE_UNITS = 256 * 1024;
const MAX_PREFERENCE_CODE_UNITS = 32 * 1024;
const DECK_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const PREFERENCE_KEY = /^ptcgsim\.[a-z0-9-]{1,48}\.v[0-9]{1,3}$/u;

type Kind = 'deck' | 'preference';

interface BaseEntry {
  readonly rev: number;
  /** The contents agreed on; null for none (deleted, or at defaults). */
  readonly hash: string | null;
  /** The account's record doesn't read here (a newer build's). */
  readonly unreadable?: true;
}

export interface SyncState {
  readonly accountId: string;
  /** Everything up to this revision has been read. */
  readonly cursor: number;
  /** The first full read is done: settings found only here may go up. */
  readonly pulled: boolean;
  readonly base: Readonly<Record<string, BaseEntry>>;
  /**
   * Decks this device had before it first synced with this account, kept
   * here only until the player adds them.
   */
  readonly deviceDecks: readonly string[];
  /** Records the account refused, by the contents it refused. */
  readonly refused: Readonly<Record<string, string>>;
}

interface Change {
  readonly kind: Kind;
  readonly id: string;
  readonly base: number;
  readonly changedAt: number;
  readonly body: string | null;
}

interface Answer {
  readonly rev: number;
  readonly reset: boolean;
  readonly more: boolean;
  readonly records: readonly {
    readonly kind: string;
    readonly id: string;
    readonly rev: number;
    readonly changedAt: number;
    readonly body: string | null;
  }[];
  readonly accepted: readonly {
    readonly kind: string;
    readonly id: string;
    readonly rev: number;
  }[];
  readonly conflicts: readonly { readonly kind: string; readonly id: string }[];
  readonly refused: readonly { readonly kind: string; readonly id: string }[];
}

export interface AccountSyncSnapshot {
  readonly syncing: boolean;
  readonly lastSyncedAt: number | undefined;
  /** This device's decks not in the account yet. */
  readonly deviceDecks: number;
}

/* ---- Contents, compared by a hash --------------------------------------- */

/** JSON with every object's keys in order: equal values, equal text. */
export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** A short hash of text (cyrb53): to tell contents apart, not to secure them. */
export const contentHash = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

/**
 * What tells one deck's contents from another's: everything but the cards'
 * rule facts, which each device works out from its own catalog.
 */
export const deckHash = (deck: SavedDeck): string => {
  const { factsFrom: _factsFrom, cards, ...rest } = deck;
  return contentHash(
    stableJson({
      ...rest,
      cards: cards.map(({ card: { facts: _facts, ...card }, count }) => ({
        card,
        count,
      })),
    })
  );
};

/* ---- What this device remembers ----------------------------------------- */

const freshState = (accountId: string): SyncState => ({
  accountId,
  cursor: 0,
  pulled: false,
  base: {},
  deviceDecks: [],
  refused: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readSyncState = (
  text: string | null,
  accountId: string
): SyncState | undefined => {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (
      !isRecord(value) ||
      value['accountId'] !== accountId ||
      typeof value['cursor'] !== 'number' ||
      !isRecord(value['base'])
    ) {
      return undefined;
    }
    const base: Record<string, BaseEntry> = {};
    for (const [key, entry] of Object.entries(value['base'])) {
      if (!isRecord(entry) || typeof entry['rev'] !== 'number') continue;
      const hash = entry['hash'];
      base[key] = {
        rev: entry['rev'],
        hash: typeof hash === 'string' ? hash : null,
        ...(entry['unreadable'] === true ? { unreadable: true as const } : {}),
      };
    }
    const deviceDecks = Array.isArray(value['deviceDecks'])
      ? value['deviceDecks'].filter(
          (id): id is string => typeof id === 'string'
        )
      : [];
    const refused: Record<string, string> = {};
    if (isRecord(value['refused'])) {
      for (const [key, hash] of Object.entries(value['refused'])) {
        if (typeof hash === 'string') refused[key] = hash;
      }
    }
    return {
      accountId,
      cursor: value['cursor'],
      pulled: value['pulled'] === true,
      base,
      deviceDecks,
      refused,
    };
  } catch {
    return undefined;
  }
};

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStorage = (): SyncStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/* ---- One sync ----------------------------------------------------------- */

export interface SyncEnvironment {
  /** Cancels a run whose account changed while it was waiting. */
  readonly isCurrent?: () => boolean;
  readonly library: Pick<DeckLibrary, 'readStored' | 'receive'>;
  readonly store: Pick<PreferenceStore, 'storedText' | 'applyStoredText'>;
  readonly synced: () => readonly Preference<unknown>[];
  readonly storage: SyncStorage;
  readonly send: (body: {
    readonly expectedAccountId: string;
    readonly since: number;
    readonly changes: readonly Change[];
  }) => Promise<Answer>;
  readonly now: () => number;
}

interface LocalRecord {
  readonly hash: string | null;
  readonly body: string | null;
  readonly changedAt: number;
}

export interface SyncOutcome {
  readonly state: SyncState;
  /** This device's first sync with the account. */
  readonly firstSync: boolean;
  /** Decks the account refused (too big, or the account is full). */
  readonly refusedDecks: number;
}

const keyOf = (kind: string, id: string): string => `${kind}:${id}`;

/**
 * Brings this device and the account into step, once, and returns what this
 * device now remembers. `push` false: only send if something changed here.
 */
export const syncOnce = async (
  accountId: string,
  environment: SyncEnvironment,
  options: { readonly pull: boolean } = { pull: true }
): Promise<SyncOutcome | undefined> => {
  const { library, store, storage } = environment;
  const current = () => environment.isCurrent?.() !== false;
  if (!current()) return undefined;
  let state =
    readSyncState(storage.getItem(STATE_KEY), accountId) ??
    freshState(accountId);
  const base: Record<string, BaseEntry> = { ...state.base };
  const refused: Record<string, string> = { ...state.refused };
  const firstSync =
    state.cursor === 0 && !state.pulled && Object.keys(base).length === 0;

  const storedDecks = await library.readStored();
  if (!current()) return undefined;
  const decks = new Map<string, SavedDeck>();
  for (const deck of storedDecks ?? []) {
    if (DECK_ID.test(deck.id)) decks.set(deck.id, deck);
  }
  // A first sync keeps the decks already here out of the account until the
  // player adds them; ones since deleted are let go.
  let deviceDecks =
    firstSync && storedDecks ? [...decks.keys()] : state.deviceDecks;
  deviceDecks = deviceDecks.filter((id) => decks.has(id));
  const heldBack = new Set(deviceDecks);

  const preferencesByKey = new Map(
    environment
      .synced()
      .filter((preference) => PREFERENCE_KEY.test(preference.key))
      .map((preference) => [preference.key, preference])
  );

  const localDeck = (id: string): LocalRecord => {
    const deck = decks.get(id);
    if (!deck) return { hash: null, body: null, changedAt: environment.now() };
    return {
      hash: deckHash(deck),
      body: JSON.stringify(deck),
      changedAt: deck.updatedAt,
    };
  };
  const localPreference = (key: string): LocalRecord => {
    const preference = preferencesByKey.get(key);
    const text = preference
      ? store.storedText(preference)
      : storage.getItem(key);
    return {
      hash: text === null ? null : contentHash(text),
      body: text,
      changedAt: environment.now(),
    };
  };
  const local = (kind: Kind, id: string): LocalRecord =>
    kind === 'deck' ? localDeck(id) : localPreference(id);

  const changes = (): Change[] => {
    const found: Change[] = [];
    const consider = (kind: Kind, id: string): void => {
      const key = keyOf(kind, id);
      const agreed = base[key];
      if (agreed?.unreadable) return;
      const here = local(kind, id);
      if ((agreed?.hash ?? null) === here.hash) return;
      // Nothing of it in the account and nothing of it here.
      if (!agreed && here.body === null) return;
      if (here.hash !== null && refused[key] === here.hash) return;
      const limit =
        kind === 'deck' ? MAX_DECK_CODE_UNITS : MAX_PREFERENCE_CODE_UNITS;
      if (here.body !== null && here.body.length > limit) return;
      found.push({
        kind,
        id,
        base: agreed?.rev ?? 0,
        changedAt: here.changedAt,
        body: here.body,
      });
    };
    if (storedDecks) {
      for (const id of decks.keys())
        if (!heldBack.has(id)) consider('deck', id);
      for (const key of Object.keys(base)) {
        if (key.startsWith('deck:') && !decks.has(key.slice(5)))
          consider('deck', key.slice(5));
      }
    }
    // Settings go up only once the account's have been read: a new device
    // takes the player's settings rather than offering its own.
    if (state.pulled) {
      for (const key of preferencesByKey.keys()) consider('preference', key);
    }
    return found;
  };

  let pending = changes();
  if (!options.pull && pending.length === 0) return undefined;

  let cursor = state.cursor;
  let pulled = state.pulled;
  let full = false;
  const seen = new Set<string>();
  let refusedDecks = 0;
  const receivedDecks = new Map<string, SavedDeck>();
  const removedDecks = new Set<string>();

  const takeRecord = (record: Answer['records'][number]): void => {
    const kind = record.kind;
    if (kind !== 'deck' && kind !== 'preference') return;
    const key = keyOf(kind, record.id);
    seen.add(key);
    const agreed = base[key];
    const here = local(kind, record.id);
    const changedHere =
      !agreed?.unreadable && (agreed?.hash ?? null) !== here.hash;
    // A first sync takes the account's settings over this device's.
    const settingFirstSeen = kind === 'preference' && !agreed;
    if (
      changedHere &&
      !settingFirstSeen &&
      here.changedAt > record.changedAt &&
      kind === 'deck'
    ) {
      // Both changed: this device's is later, and goes up from this revision.
      base[key] = { rev: record.rev, hash: agreed?.hash ?? null };
      return;
    }
    if (kind === 'deck') {
      if (!storedDecks) return;
      if (record.body === null) {
        if (decks.delete(record.id)) removedDecks.add(record.id);
        receivedDecks.delete(record.id);
        base[key] = { rev: record.rev, hash: null };
        return;
      }
      let deck: SavedDeck | undefined;
      try {
        deck = decodeSavedDeck(JSON.parse(record.body));
      } catch {
        deck = undefined;
      }
      if (!deck || deck.id !== record.id) {
        base[key] = { rev: record.rev, hash: null, unreadable: true };
        return;
      }
      decks.set(deck.id, deck);
      receivedDecks.set(deck.id, deck);
      removedDecks.delete(deck.id);
      heldBack.delete(deck.id);
      base[key] = { rev: record.rev, hash: deckHash(deck) };
      return;
    }
    if (record.body !== null && !isRecord(safeParse(record.body))) {
      base[key] = { rev: record.rev, hash: null, unreadable: true };
      return;
    }
    const preference = preferencesByKey.get(record.id);
    let now: string | null;
    if (preference) {
      now = store.applyStoredText(preference, record.body);
    } else {
      // Not defined on this page (yet): kept as stored, read when it is.
      try {
        if (record.body === null) storage.removeItem(record.id);
        else storage.setItem(record.id, record.body);
      } catch {
        return;
      }
      now = record.body;
    }
    base[key] = {
      rev: record.rev,
      hash: now === null ? null : contentHash(now),
    };
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const batch: Change[] = [];
    let size = 0;
    for (const change of pending) {
      const length = (change.body?.length ?? 0) + 200;
      if (
        batch.length >= MAX_CHANGES_PER_REQUEST ||
        (batch.length > 0 && size + length > MAX_REQUEST_CODE_UNITS)
      ) {
        break;
      }
      batch.push(change);
      size += length;
    }
    if (!current()) return undefined;
    const answer = await environment.send({
      expectedAccountId: accountId,
      since: cursor,
      changes: batch,
    });
    if (!current()) return undefined;
    const accepted = new Map(
      answer.accepted.map((entry) => [keyOf(entry.kind, entry.id), entry.rev])
    );
    const sent = new Map(
      batch.map((change) => [keyOf(change.kind, change.id), change])
    );
    for (const [key, rev] of accepted) {
      const change = sent.get(key);
      if (!change) continue;
      const hash =
        change.body === null
          ? null
          : change.kind === 'deck'
            ? localDeck(change.id).hash
            : contentHash(change.body);
      base[key] = { rev, hash };
      delete refused[key];
    }
    for (const entry of answer.refused) {
      const key = keyOf(entry.kind, entry.id);
      const change = sent.get(key);
      if (!change?.body) continue;
      refused[key] =
        change.kind === 'deck'
          ? (localDeck(change.id).hash ?? '')
          : contentHash(change.body);
      if (change.kind === 'deck') refusedDecks += 1;
    }
    if (answer.reset && !full) {
      // Away longer than the account keeps deletions: read it all again,
      // and whatever it no longer has was deleted there.
      full = true;
      cursor = 0;
      seen.clear();
    } else {
      for (const record of answer.records) {
        const key = keyOf(record.kind, record.id);
        if (accepted.get(key) === record.rev) {
          seen.add(key);
          continue;
        }
        takeRecord(record);
      }
      cursor = answer.rev;
      if (!answer.more) {
        if (full) {
          for (const key of Object.keys(base)) {
            if (seen.has(key)) continue;
            const id = key.slice(key.indexOf(':') + 1);
            if (
              key.startsWith('deck:') &&
              base[key]?.hash !== null &&
              localDeck(id).hash === base[key]?.hash
            ) {
              decks.delete(id);
              removedDecks.add(id);
            }
            delete base[key];
          }
          full = false;
        }
        pulled = true;
      }
    }
    state = {
      ...state,
      cursor,
      pulled,
      base,
      refused,
      deviceDecks: deviceDecks.filter((id) => heldBack.has(id)),
    };
    pending = changes();
    if (!answer.more && !full && pending.length === 0) break;
  }

  if (receivedDecks.size > 0 || removedDecks.size > 0) {
    library.receive([...receivedDecks.values()], [...removedDecks]);
  }
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage is full or blocked: the next sync compares again from the last.
  }
  return { state, refusedDecks, firstSync };
};

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/* ---- This page's sync --------------------------------------------------- */

const sendSync = async (body: {
  readonly expectedAccountId: string;
  readonly since: number;
  readonly changes: readonly Change[];
}): Promise<Answer> => {
  const text = JSON.stringify(body);
  const response = await fetch('/v2/account/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: text,
    // A small one outlives the page closing.
    keepalive: text.length < 60_000,
  });
  if (!response.ok) {
    let code = 'failed';
    try {
      const error: unknown = Reflect.get(
        Object(await response.json()),
        'error'
      );
      if (typeof error === 'string') code = error;
    } catch {
      // Only the status, then.
    }
    throw new AccountRequestError(response.status, code);
  }
  return (await response.json()) as Answer;
};

let snapshot: AccountSyncSnapshot = Object.freeze({
  syncing: false,
  lastSyncedAt: undefined,
  deviceDecks: 0,
});
const listeners = new Set<() => void>();
const publish = (change: Partial<AccountSyncSnapshot>): void => {
  snapshot = Object.freeze({ ...snapshot, ...change });
  for (const listener of [...listeners]) listener();
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let again: boolean | undefined;
let pausedUntil = 0;
let lastPulledAt = 0;
let askedAboutDecks = false;

let accountEpoch = 0;

const environment = (): SyncEnvironment | undefined => {
  const epoch = accountEpoch;
  const accountId = accountSnapshot().account?.id;
  const storage = browserStorage();
  if (!storage) return undefined;
  return {
    isCurrent: () =>
      epoch === accountEpoch && accountSnapshot().account?.id === accountId,
    library: deckLibrary(),
    store: preferences(),
    synced: syncedPreferences,
    storage,
    send: sendSync,
    now: Date.now,
  };
};

const withLock = async (work: () => Promise<void>): Promise<void> => {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    await locks.request(LOCK, work);
    return;
  }
  await work();
};

/** Syncs now (or right after a sync already going); `pull` asks the account too. */
export const syncAccountNow = (pull = true): Promise<void> => {
  if (running) {
    again = (again ?? false) || pull;
    return running;
  }
  const accountId = accountSnapshot().account?.id;
  const env = environment();
  if (!accountId || !env || Date.now() < pausedUntil) return Promise.resolve();
  publish({ syncing: true });
  running = withLock(async () => {
    try {
      const outcome = await syncOnce(accountId, env, { pull });
      if (pull || outcome) lastPulledAt = Date.now();
      if (outcome) {
        publish({
          lastSyncedAt: Date.now(),
          deviceDecks: outcome.state.deviceDecks.length,
        });
        if (outcome.refusedDecks > 0) {
          toast({
            title: t`A deck didn't fit in your account`,
            tone: 'danger',
          });
        }
        if (outcome.firstSync)
          offerDeviceDecks(outcome.state.deviceDecks.length);
      }
    } catch (error) {
      if (error instanceof AccountRequestError) {
        if (error.status === 401) void refreshAccount();
        if (error.status === 429) pausedUntil = Date.now() + BACK_OFF_MS;
      }
      // Offline or refused: the next change or visit tries again.
    }
  }).finally(() => {
    running = undefined;
    publish({ syncing: false });
    const next = again;
    again = undefined;
    if (next !== undefined) void syncAccountNow(next);
  });
  return running;
};

const schedule = (delayMs: number): void => {
  if (!accountSnapshot().account) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void syncAccountNow(Date.now() - lastPulledAt > PULL_AFTER_HIDDEN_MS);
  }, delayMs);
};

const offerDeviceDecks = (count: number): void => {
  if (count === 0 || askedAboutDecks) return;
  askedAboutDecks = true;
  toast({
    title:
      count === 1
        ? t`Add this device's deck to your account?`
        : t`Add this device's ${count} decks to your account?`,
    action: { label: t`Add`, onAction: () => void addDeviceDecks() },
  });
};

/** Puts the decks this device had before signing in into the account. */
export const addDeviceDecks = async (): Promise<void> => {
  const storage = browserStorage();
  const accountId = accountSnapshot().account?.id;
  if (!storage || !accountId) return;
  await withLock(async () => {
    const state = readSyncState(storage.getItem(STATE_KEY), accountId);
    if (!state) return;
    try {
      storage.setItem(STATE_KEY, JSON.stringify({ ...state, deviceDecks: [] }));
    } catch {
      // Nothing to add from, then.
    }
  });
  publish({ deviceDecks: 0 });
  await syncAccountNow(false);
};

/**
 * Removes what this device has from the account (its decks and settings),
 * for signing out of a device that isn't the player's. Decks this device
 * had before, never added, stay.
 */
export const clearAccountFromDevice = async (
  accountId: string
): Promise<void> => {
  const storage = browserStorage();
  if (!storage) return;
  await withLock(async () => {
    const state = readSyncState(storage.getItem(STATE_KEY), accountId);
    const ids = Object.entries(state?.base ?? {})
      .filter(([key, entry]) => key.startsWith('deck:') && entry.hash !== null)
      .map(([key]) => key.slice(5));
    const library = deckLibrary();
    // Loaded first: a deck not yet read back can't be taken off.
    await library.readStored();
    library.receive([], ids);
    await library.flush();
    const store = preferences();
    for (const preference of syncedPreferences()) {
      store.reset(preference);
    }
    store.flush();
    // Settings from the account this page never defined are stored as is.
    for (const key of Object.keys(state?.base ?? {})) {
      if (!key.startsWith('preference:')) continue;
      try {
        storage.removeItem(key.slice('preference:'.length));
      } catch {
        // Blocked: nothing of it was kept.
      }
    }
    try {
      storage.removeItem(STATE_KEY);
    } catch {
      // Blocked storage held nothing of it.
    }
  });
  publish({ deviceDecks: 0, lastSyncedAt: undefined });
};

let started = false;

/** Starts syncing whenever someone is signed in, for the life of the page. */
export const startAccountSync = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  let signedIn = accountSnapshot().account?.id;
  subscribeAccount(() => {
    const now = accountSnapshot().account?.id;
    if (now === signedIn) return;
    signedIn = now;
    accountEpoch += 1;
    askedAboutDecks = false;
    publish({ deviceDecks: 0, lastSyncedAt: undefined });
    if (now) void syncAccountNow(true);
  });
  preferences().onChange((key) => {
    if (syncedPreferences().some((preference) => preference.key === key)) {
      schedule(CHANGE_DELAY_MS);
    }
  });
  deckLibrary().subscribe(() => schedule(CHANGE_DELAY_MS));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastPulledAt > PULL_AFTER_HIDDEN_MS)
        void syncAccountNow(true);
    } else if (timer !== undefined) {
      // Leaving: what changed goes now rather than never.
      clearTimeout(timer);
      timer = undefined;
      void syncAccountNow(false);
    }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncAccountNow(true);
  }, PULL_EVERY_MS);
  if (signedIn) void syncAccountNow(true);
};

export const useAccountSync = (): AccountSyncSnapshot =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot
  );
