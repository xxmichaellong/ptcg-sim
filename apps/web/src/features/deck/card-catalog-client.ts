import { decodeCatalog, type LoadedCatalog } from '@ptcgsim/deck-core';

import type {
  CardCatalogSource,
  CardCatalogState,
} from './card-catalog-contract.js';

/**
 * Loads the server's card catalog (ADR-032) once per page.
 *
 * The small manifest names the current version's body; the body's URL is
 * immutable, so the browser's HTTP cache keeps it and a later visit reads
 * it from disk. The last body that loaded is remembered here too, so a
 * visit whose manifest request fails (offline, the server mid-deploy) still
 * gets cards. While the server is still building its first catalog it
 * says so (`building`), and the loader waits and asks again.
 */

export const CARD_CATALOG_PATH = '/v2/cards/catalog';

/** Where the last body that loaded is remembered. */
export const LAST_CATALOG_BODY_KEY = 'ptcgsim:card-catalog-body';

/** Waits between asks while the server builds its first catalog. */
export const CATALOG_BUILDING_RETRY_MS: readonly number[] = Object.freeze([
  2_000, 5_000, 10_000, 20_000, 30_000,
]);

/** A catalog the server is still filling is asked about again this often. */
export const CATALOG_INCOMPLETE_RECHECK_MS = 60_000;

const MANIFEST_TIMEOUT_MS = 8_000;
const BODY_TIMEOUT_MS = 60_000;
/** The body is ~8 MB of JSON today; this is room to grow, not a target. */
const MAXIMUM_BODY_CODE_UNITS = 48_000_000;
const BODY_URL = /^\/v2\/cards\/catalog\/[a-f0-9]{20}\.json$/u;

interface Manifest {
  readonly version: string;
  readonly url: string;
  readonly complete: boolean;
}

type ManifestAnswer =
  | { readonly kind: 'ready'; readonly manifest: Manifest }
  | { readonly kind: 'building' }
  | { readonly kind: 'unavailable' };

export interface CardCatalogClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly setTimeout?: (callback: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly decode?: (value: unknown) => LoadedCatalog;
}

export interface CardCatalogClient extends CardCatalogSource {
  /** Stops timers and requests (tests, page teardown). */
  dispose(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const browserStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const IDLE: CardCatalogState = Object.freeze({ status: 'idle' });
const LOADING: CardCatalogState = Object.freeze({ status: 'loading' });
const FAILED: CardCatalogState = Object.freeze({ status: 'failed' });

export const createCardCatalogClient = (
  options: CardCatalogClientOptions = {}
): CardCatalogClient => {
  const fetchRequest =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const schedule =
    options.setTimeout ??
    ((callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay));
  const cancel =
    options.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const decode = options.decode ?? decodeCatalog;

  let state: CardCatalogState = IDLE;
  let version: string | undefined;
  let timer: unknown;
  let generation = 0;
  let attempts = 0;
  const requests = new Set<AbortController>();
  const listeners = new Set<() => void>();

  const publish = (next: CardCatalogState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const clearTimer = (): void => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };

  const later = (delay: number, work: () => void): void => {
    clearTimer();
    timer = schedule(() => {
      timer = undefined;
      work();
    }, delay);
  };

  /**
   * Fetches and reads a response. The deadline and `dispose()` cover the
   * body too: headers can arrive and the body then stall.
   */
  const request = async <T>(
    url: string,
    timeoutMs: number,
    cache: RequestCache,
    read: (response: Response) => Promise<T>
  ): Promise<T> => {
    const controller = new AbortController();
    requests.add(controller);
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchRequest(url, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        cache,
        signal: controller.signal,
      });
      return await read(response);
    } finally {
      clearTimeout(deadline);
      requests.delete(controller);
    }
  };

  const readManifest = async (): Promise<ManifestAnswer> => {
    let ok: boolean;
    let body: unknown;
    try {
      ({ ok, body } = await request(
        CARD_CATALOG_PATH,
        MANIFEST_TIMEOUT_MS,
        'no-cache',
        async (response) => ({
          ok: response.ok,
          body: (await response.json()) as unknown,
        })
      ));
    } catch {
      return { kind: 'unavailable' };
    }
    // Still building: wait and ask again.
    if (isRecord(body) && body.building === true) return { kind: 'building' };
    if (
      !ok ||
      !isRecord(body) ||
      typeof body.version !== 'string' ||
      typeof body.url !== 'string' ||
      !BODY_URL.test(body.url)
    ) {
      return { kind: 'unavailable' };
    }
    return {
      kind: 'ready',
      manifest: {
        version: body.version,
        url: body.url,
        complete: body.complete !== false,
      },
    };
  };

  const readBody = async (url: string): Promise<LoadedCatalog> => {
    const text = await request(
      url,
      BODY_TIMEOUT_MS,
      'default',
      async (response) => {
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${String(response.status)}`);
        }
        return await response.text();
      }
    );
    if (text.length > MAXIMUM_BODY_CODE_UNITS) {
      throw new Error('The card catalog is too large.');
    }
    // Let a loading indicator paint before the parse takes the thread.
    await new Promise<void>((resolve) => {
      schedule(resolve, 0);
    });
    return decode(JSON.parse(text) as unknown);
  };

  const remembered = (): string | undefined => {
    try {
      const url = storage?.getItem(LAST_CATALOG_BODY_KEY) ?? undefined;
      return url && BODY_URL.test(url) ? url : undefined;
    } catch {
      return undefined;
    }
  };

  const remember = (url: string): void => {
    try {
      storage?.setItem(LAST_CATALOG_BODY_KEY, url);
    } catch {
      // Blocked or full storage: the HTTP cache still has the body.
    }
  };

  const loadBody = async (url: string, run: number): Promise<boolean> => {
    try {
      const catalog = await readBody(url);
      if (run !== generation) return true;
      remember(url);
      publish(Object.freeze({ status: 'ready', catalog }));
      return true;
    } catch {
      return false;
    }
  };

  const recheck = (run: number): void => {
    later(CATALOG_INCOMPLETE_RECHECK_MS, () => {
      void (async () => {
        if (run !== generation) return;
        const answer = await readManifest();
        if (run !== generation) return;
        if (answer.kind !== 'ready') {
          recheck(run);
          return;
        }
        if (answer.manifest.version !== version) {
          if (await loadBody(answer.manifest.url, run)) {
            version = answer.manifest.version;
          }
        }
        if (!answer.manifest.complete) recheck(run);
      })();
    });
  };

  const run = async (current: number): Promise<void> => {
    const answer = await readManifest();
    if (current !== generation) return;
    if (answer.kind === 'ready') {
      if (await loadBody(answer.manifest.url, current)) {
        if (current !== generation) return;
        version = answer.manifest.version;
        attempts = 0;
        if (!answer.manifest.complete) recheck(current);
        return;
      }
    }
    if (current !== generation) return;
    // No manifest (or its body failed): the last body that loaded will do.
    const fallback = remembered();
    if (
      fallback &&
      state.status !== 'ready' &&
      (await loadBody(fallback, current))
    ) {
      if (current !== generation) return;
      if (answer.kind === 'building') recheck(current);
      return;
    }
    if (current !== generation) return;
    if (answer.kind === 'building') {
      const delay =
        CATALOG_BUILDING_RETRY_MS[
          Math.min(attempts, CATALOG_BUILDING_RETRY_MS.length - 1)
        ]!;
      attempts += 1;
      later(delay, () => void run(current));
      return;
    }
    publish(FAILED);
  };

  const start = (): void => {
    generation += 1;
    attempts = 0;
    publish(LOADING);
    void run(generation);
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      if (state.status === 'idle') start();
    },
    retry() {
      if (state.status === 'failed') start();
    },
    dispose() {
      generation += 1;
      clearTimer();
      for (const controller of requests) controller.abort();
      requests.clear();
      listeners.clear();
    },
  };
};

let pageCatalog: CardCatalogClient | undefined;

/** The page's card catalog, loaded the first time something asks. */
export const cardCatalog = (): CardCatalogSource => {
  pageCatalog ??= createCardCatalogClient();
  return pageCatalog;
};
