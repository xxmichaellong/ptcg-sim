import type { LoadedCatalog } from '@ptcgsim/deck-core';
import { useEffect, useSyncExternalStore } from 'react';

import type {
  CardCatalogSource,
  CardCatalogState,
} from './card-catalog-contract.js';

/** The catalog's state; asks it to load the first time a screen needs it. */
export const useCardCatalog = (
  source: CardCatalogSource,
  wanted = true
): CardCatalogState => {
  const state = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
  useEffect(() => {
    if (wanted) source.load();
  }, [source, wanted]);
  return state;
};

/**
 * The catalog once it is ready, or undefined if it fails or takes longer
 * than `timeoutMs` -- for an import, which can go ahead without it.
 */
export const catalogWhenReady = (
  source: CardCatalogSource,
  timeoutMs = 12_000,
  signal?: AbortSignal
): Promise<LoadedCatalog | undefined> =>
  new Promise((resolve) => {
    const cleanups: (() => void)[] = [];
    let settled = false;
    const done = (catalog: LoadedCatalog | undefined): void => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      resolve(catalog);
    };
    const check = (): void => {
      const state = source.getSnapshot();
      if (state.status === 'ready') done(state.catalog);
      else if (state.status === 'failed') done(undefined);
    };
    check();
    if (settled) return;
    source.load();
    check();
    if (settled) return;
    cleanups.push(source.subscribe(check));
    const timer = setTimeout(() => done(undefined), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
    const onAbort = (): void => done(undefined);
    signal?.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal?.removeEventListener('abort', onAbort));
  });
