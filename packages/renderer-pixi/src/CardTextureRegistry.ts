export interface TextureAssetAdapter<Texture> {
  readonly placeholder: Texture;
  readonly load: (url: string) => Promise<Texture>;
  readonly unload: (url: string) => Promise<void>;
}

type TextureEntryPhase = 'pending' | 'ready' | 'failed' | 'unloading';

interface TextureEntry<Texture> {
  readonly url: string;
  readonly promise: Promise<Texture>;
  references: number;
  phase: TextureEntryPhase;
  unloadTask: Promise<void> | null;
  unloadErrorObservers: readonly ((error: unknown) => void)[];
}

interface ErrorListenerRegistration {
  readonly listener: (error: unknown) => void;
}

export interface TextureAssetLease<Texture> {
  readonly promise: Promise<Texture>;
  /** Idempotently releases only this acquisition from its owning broker. */
  readonly release: () => void;
}

export interface TextureAssetLeaseDiagnostics {
  readonly entries: number;
  readonly pendingEntries: number;
  readonly unloadingEntries: number;
  readonly references: number;
  /** Cumulative failures since this broker was constructed. */
  readonly loadFailures: number;
  /** Cumulative failures since this broker was constructed. */
  readonly unloadFailures: number;
}

/**
 * Coordinates active URL leases across renderer instances that share one
 * global asset cache. A replacement lease acquired during unload waits for the
 * old unload before starting its load, so one renderer cannot invalidate a
 * second renderer's live texture.
 */
export class TextureAssetLeaseBroker<Texture> {
  private readonly entries = new Map<string, TextureEntry<Texture>>();
  private readonly lifecycleEntries = new Set<TextureEntry<Texture>>();
  private readonly errorListeners = new Set<ErrorListenerRegistration>();
  private loadFailures = 0;
  private unloadFailures = 0;

  constructor(private readonly assets: TextureAssetAdapter<Texture>) {}

  get placeholder(): Texture {
    return this.assets.placeholder;
  }

  acquire(url: string): TextureAssetLease<Texture> {
    let entry = this.entries.get(url);
    if (!entry || entry.phase === 'failed') {
      entry = this.createEntry(url);
    } else if (entry.phase === 'unloading') {
      entry = this.createEntry(url, entry.unloadTask ?? Promise.resolve());
    }
    entry.unloadErrorObservers = [];
    entry.references += 1;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        this.releaseEntry(entry);
      },
    };
  }

  subscribeErrors(listener: (error: unknown) => void): () => void {
    const registration = { listener };
    this.errorListeners.add(registration);
    return () => this.errorListeners.delete(registration);
  }

  private releaseEntry(entry: TextureEntry<Texture>): void {
    entry.references -= 1;
    if (entry.references !== 0) return;
    entry.unloadErrorObservers = Array.from(
      this.errorListeners,
      ({ listener }) => listener
    );
    void entry.promise.then(
      () => this.unloadIfUnused(entry),
      () => {
        if (entry.references === 0) {
          if (this.entries.get(entry.url) === entry) {
            this.entries.delete(entry.url);
          }
          this.lifecycleEntries.delete(entry);
        }
      }
    );
  }

  getDiagnostics(): TextureAssetLeaseDiagnostics {
    let pendingEntries = 0;
    let unloadingEntries = 0;
    let references = 0;
    for (const entry of this.lifecycleEntries) {
      if (entry.phase === 'pending') pendingEntries += 1;
      if (entry.phase === 'unloading') unloadingEntries += 1;
      references += entry.references;
    }
    return {
      entries: this.lifecycleEntries.size,
      pendingEntries,
      unloadingEntries,
      references,
      loadFailures: this.loadFailures,
      unloadFailures: this.unloadFailures,
    };
  }

  private createEntry(
    url: string,
    after?: Promise<void>
  ): TextureEntry<Texture> {
    const load = (): Promise<Texture> => {
      try {
        return Promise.resolve(this.assets.load(url));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const entry: TextureEntry<Texture> = {
      url,
      promise: after ? after.then(load) : load(),
      references: 0,
      phase: 'pending',
      unloadTask: null,
      unloadErrorObservers: [],
    };
    this.entries.set(url, entry);
    this.lifecycleEntries.add(entry);
    void entry.promise.then(
      () => {
        if (entry.phase === 'pending') entry.phase = 'ready';
      },
      () => {
        if (entry.phase === 'pending') {
          entry.phase = 'failed';
          this.loadFailures += 1;
        }
      }
    );
    return entry;
  }

  private unloadIfUnused(entry: TextureEntry<Texture>): void {
    if (
      entry.references !== 0 ||
      entry.phase !== 'ready' ||
      this.entries.get(entry.url) !== entry
    ) {
      return;
    }
    entry.phase = 'unloading';
    let unload: Promise<void>;
    try {
      unload = Promise.resolve(this.assets.unload(entry.url));
    } catch (error) {
      this.recordUnloadFailure(error, entry.unloadErrorObservers);
      unload = Promise.resolve();
    }
    entry.unloadTask = unload
      .catch((error: unknown) =>
        this.recordUnloadFailure(error, entry.unloadErrorObservers)
      )
      .then(() => {
        if (this.entries.get(entry.url) === entry) {
          this.entries.delete(entry.url);
        }
        entry.unloadErrorObservers = [];
        this.lifecycleEntries.delete(entry);
      });
  }

  private recordUnloadFailure(
    error: unknown,
    observers: readonly ((error: unknown) => void)[]
  ): void {
    this.unloadFailures += 1;
    for (const listener of observers) {
      try {
        listener(error);
      } catch {
        // A diagnostic observer cannot interrupt shared cache teardown.
      }
    }
  }
}

interface CardBinding<Texture> {
  readonly url: string;
  readonly lease: TextureAssetLease<Texture>;
  readonly token: number;
  readonly onReady: (texture: Texture) => void;
  readonly onError: (error: unknown) => void;
}

export interface CardTextureRegistryDiagnostics extends TextureAssetLeaseDiagnostics {
  readonly bindings: number;
}

/**
 * Binds recipient-safe card aliases to shared URL leases and ensures late
 * completions cannot bind to a recycled card view. This is an active-lease
 * cache, not the future byte-bounded warm LRU.
 */
export class CardTextureRegistry<Texture> {
  private readonly bindings = new Map<string, CardBinding<Texture>>();
  private nextToken = 0;
  private disposed = false;
  private readonly unsubscribeErrors: () => void;

  constructor(
    private readonly broker: TextureAssetLeaseBroker<Texture>,
    onAssetError: (error: unknown) => void = () => undefined
  ) {
    this.unsubscribeErrors = broker.subscribeErrors(onAssetError);
  }

  get placeholder(): Texture {
    return this.broker.placeholder;
  }

  bind(
    cardId: string,
    url: string,
    onReady: (texture: Texture) => void,
    onError: (error: unknown) => void
  ): void {
    if (this.disposed) throw new Error('Texture registry is disposed');
    const current = this.bindings.get(cardId);
    if (current?.url === url) return;
    this.release(cardId);

    const lease = this.broker.acquire(url);
    const binding: CardBinding<Texture> = {
      url,
      lease,
      token: ++this.nextToken,
      onReady,
      onError,
    };
    this.bindings.set(cardId, binding);
    void lease.promise.then(
      (texture) => {
        if (this.isCurrent(cardId, binding)) binding.onReady(texture);
      },
      (error: unknown) => {
        if (this.isCurrent(cardId, binding)) binding.onError(error);
      }
    );
  }

  release(cardId: string): void {
    const binding = this.bindings.get(cardId);
    if (!binding) return;
    this.bindings.delete(cardId);
    binding.lease.release();
  }

  getDiagnostics(): CardTextureRegistryDiagnostics {
    return { bindings: this.bindings.size, ...this.broker.getDiagnostics() };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cardId of [...this.bindings.keys()]) this.release(cardId);
    this.bindings.clear();
    this.unsubscribeErrors();
  }

  private isCurrent(cardId: string, binding: CardBinding<Texture>): boolean {
    const current = this.bindings.get(cardId);
    return (
      !this.disposed &&
      current?.token === binding.token &&
      current.lease === binding.lease
    );
  }
}
