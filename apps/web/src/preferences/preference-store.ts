/**
 * What the player chooses for themselves on this device: theme, motion,
 * table depth, keyboard shortcuts and the like. Every such choice is a
 * `Preference`, and one store per page holds them all, so they are read,
 * validated, saved and shared between tabs the same way.
 *
 * - Reads are lazy and happen once: a preference is parsed from storage the
 *   first time something asks for it, then served from memory.
 * - Writes apply at once in memory (subscribers re-render immediately) and
 *   reach storage shortly after, batched, so a slider dragged across a range
 *   writes once. Anything still pending is written when the page is hidden.
 * - Only what differs from the defaults is stored. A default that improves
 *   later reaches everyone who never chose otherwise, and a preference back
 *   at its defaults leaves nothing behind.
 * - Storage is best effort. Blocked, full or hand-edited storage never
 *   throws: the choice still applies for this visit, and a value that does
 *   not parse falls back field by field to the defaults.
 * - Another tab's change arrives through the `storage` event and is
 *   published here as if it had been made here.
 *
 * Nothing about a room or a game belongs here: preferences never leave the
 * browser and never enter commands.
 */

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Preference<T> {
  /** Its storage key. A new version suffix is for shapes `parse` cannot read. */
  readonly key: string;
  readonly defaults: T;
  /**
   * Turns whatever storage holds -- possibly from an older build, possibly
   * edited by hand, possibly only the fields that differ from the defaults
   * -- into a valid value. It must not throw.
   */
  readonly parse: (stored: unknown) => T;
  /**
   * What to store, or `undefined` to store nothing. By default, the
   * top-level fields that differ from the defaults.
   */
  readonly serialize?: (value: T) => unknown;
}

export const definePreference = <T>(preference: Preference<T>): Preference<T> =>
  Object.freeze({ ...preference });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Preferences are small plain data, so their JSON is their identity. */
export const samePreferenceValue = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

const changesFromDefaults = <T>(value: T, defaults: T): unknown => {
  if (isRecord(value) && isRecord(defaults)) {
    const changed = Object.entries(value).filter(
      ([field, fieldValue]) => !samePreferenceValue(fieldValue, defaults[field])
    );
    return changed.length === 0 ? undefined : Object.fromEntries(changed);
  }
  return samePreferenceValue(value, defaults) ? undefined : value;
};

interface EventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface PreferenceStoreOptions {
  readonly storage?: PreferenceStorage | null;
  /** How long a write waits for others to batch with. */
  readonly writeDelayMs?: number;
  /** Where `storage` (other tabs) and `pagehide` arrive. */
  readonly window?: EventSource | null;
  /** Where `visibilitychange` arrives. */
  readonly document?:
    (EventSource & { readonly visibilityState?: string }) | null;
}

const DEFAULT_WRITE_DELAY_MS = 250;

export class PreferenceStore {
  private readonly storage: PreferenceStorage | null;
  private readonly writeDelayMs: number;
  private readonly values = new Map<string, unknown>();
  private readonly definitions = new Map<string, Preference<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly detach: () => void;

  constructor(options: PreferenceStoreOptions = {}) {
    this.storage = options.storage ?? null;
    this.writeDelayMs = options.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
    const win = options.window ?? null;
    const doc = options.document ?? null;
    const onStorage = (event: Event): void =>
      this.receive(event as StorageEvent);
    const onPageHide = (): void => this.flush();
    const onVisibility = (): void => {
      if (doc?.visibilityState === 'hidden') this.flush();
    };
    win?.addEventListener('storage', onStorage);
    win?.addEventListener('pagehide', onPageHide);
    doc?.addEventListener('visibilitychange', onVisibility);
    this.detach = () => {
      win?.removeEventListener('storage', onStorage);
      win?.removeEventListener('pagehide', onPageHide);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }

  /** The current value: stored, or the defaults. Stable until it changes. */
  get<T>(preference: Preference<T>): T {
    if (!this.values.has(preference.key)) {
      this.definitions.set(preference.key, preference as Preference<unknown>);
      this.values.set(preference.key, this.read(preference));
    }
    return this.values.get(preference.key) as T;
  }

  /** Applies a value now and saves it shortly. An equal value does nothing. */
  set<T>(preference: Preference<T>, value: T): void {
    if (samePreferenceValue(this.get(preference), value)) return;
    this.values.set(preference.key, value);
    this.schedule(preference.key);
    this.notify(preference.key);
  }

  /** `set` for object preferences: changes only the given fields. */
  patch<T extends object>(
    preference: Preference<T>,
    changes: Partial<T>
  ): void {
    this.set(preference, { ...this.get(preference), ...changes });
  }

  reset<T>(preference: Preference<T>): void {
    this.set(preference, preference.defaults);
  }

  /** Listens to one preference; the listener runs after each change. */
  subscribe<T>(preference: Preference<T>, listener: () => void): () => void {
    let listeners = this.listeners.get(preference.key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(preference.key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Writes every pending change now. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const key of this.pending) this.write(key);
    this.pending.clear();
  }

  dispose(): void {
    this.flush();
    this.detach();
    this.listeners.clear();
  }

  private read<T>(preference: Preference<T>): T {
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(preference.key);
    } catch {
      // Site data is blocked: this visit uses the defaults.
      return preference.defaults;
    }
    return this.parse(preference, raw ?? null);
  }

  private parse<T>(preference: Preference<T>, raw: string | null): T {
    if (raw === null) return preference.defaults;
    try {
      return preference.parse(JSON.parse(raw));
    } catch {
      return preference.defaults;
    }
  }

  private schedule(key: string): void {
    this.pending.add(key);
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.writeDelayMs);
  }

  private write(key: string): void {
    const preference = this.definitions.get(key);
    if (!preference || !this.storage) return;
    const value = this.values.get(key);
    const stored = preference.serialize
      ? preference.serialize(value)
      : changesFromDefaults(value, preference.defaults);
    try {
      if (stored === undefined) this.storage.removeItem(key);
      else this.storage.setItem(key, JSON.stringify(stored));
    } catch {
      // Full or blocked: the choice still applies for this visit.
    }
  }

  /** Another tab changed storage. */
  private receive(event: StorageEvent): void {
    if (
      this.storage === null ||
      (event.storageArea !== undefined &&
        event.storageArea !== null &&
        event.storageArea !== (this.storage as unknown))
    ) {
      return;
    }
    // A cleared storage reaches every preference read so far.
    const keys = event.key === null ? [...this.values.keys()] : [event.key];
    for (const key of keys) {
      const preference = this.definitions.get(key);
      if (!preference) continue;
      // The other tab's write is the newer one.
      this.pending.delete(key);
      const next = this.parse(
        preference,
        event.key === null ? null : event.newValue
      );
      if (samePreferenceValue(next, this.values.get(key))) continue;
      this.values.set(key, next);
      this.notify(key);
    }
  }

  private notify(key: string): void {
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}

const browserStorage = (): PreferenceStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading localStorage throws where site data is blocked.
    return null;
  }
};

let pageStore: PreferenceStore | undefined;

/** The page's preferences, backed by this browser's local storage. */
export const preferences = (): PreferenceStore => {
  pageStore ??= new PreferenceStore({
    storage: browserStorage(),
    window: typeof window === 'undefined' ? null : window,
    document: typeof document === 'undefined' ? null : document,
  });
  return pageStore;
};
