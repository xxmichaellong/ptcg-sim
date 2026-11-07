import type { LoadedCatalog } from '@ptcgsim/deck-core';

/**
 * The card catalog as the deck screen sees it: loaded once per page, the
 * first time something asks, and kept for the visit.
 */
export type CardCatalogState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly catalog: LoadedCatalog }
  | { readonly status: 'failed' };

export interface CardCatalogSource {
  getSnapshot(): CardCatalogState;
  subscribe(listener: () => void): () => void;
  /** Starts loading if nothing has; a no-op once loading or loaded. */
  load(): void;
  /**
   * Starts loading ahead of a screen that will want it. A load that fails
   * goes back to idle rather than failed, so the screen's own `load` tries
   * again -- unless the screen asked meanwhile.
   */
  prefetch?(): void;
  /** After a failure: tries again now. */
  retry(): void;
}
