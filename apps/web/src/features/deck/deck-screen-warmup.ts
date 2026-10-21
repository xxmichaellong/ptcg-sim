import type { LoadedCatalog } from '@ptcgsim/deck-core';

import { preferences } from '../../preferences/preference-store.js';
import { cardCatalog } from './card-catalog-client.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { openingSearchResults, resultImageOf } from './CardSearchPanel.js';
import { homeCoverImages } from './deck-home-covers.js';
import { deckLibrary, type DeckLibrary } from './deck-library.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import {
  popularDecklistSource,
  type PopularDecklistCollection,
  type PopularDecklistSource,
} from './popular-decklists.js';
import { warmCardImages, type WarmCardImage } from './warm-card-images.js';

/** How long the warm-up waits for the catalog before warming without it. */
const CATALOG_WAIT_MS = 20_000;
/**
 * How many of a new deck's search results load ahead: the first screenful
 * or two of the editor's grid.
 */
const SEARCH_RESULTS_AHEAD = 30;

/** The catalog once it loads, or undefined if it fails or is slow. */
const catalogLoaded = (
  catalog: CardCatalogSource,
  timeoutMs: number
): Promise<LoadedCatalog | undefined> =>
  new Promise((resolve) => {
    let stop = (): void => undefined;
    const timer = setTimeout(() => {
      stop();
      resolve(undefined);
    }, timeoutMs);
    const check = (): boolean => {
      const state = catalog.getSnapshot();
      if (state.status === 'loading') return false;
      clearTimeout(timer);
      stop();
      resolve(state.status === 'ready' ? state.catalog : undefined);
      return true;
    };
    if (check()) return;
    stop = catalog.subscribe(() => void check());
  });

/** The saved decks once storage has given them. */
const libraryLoaded = (
  library: Pick<DeckLibrary, 'getSnapshot' | 'subscribe'>
): Promise<void> =>
  new Promise((resolve) => {
    if (library.getSnapshot().status !== 'loading') {
      resolve();
      return;
    }
    const stop = library.subscribe(() => {
      if (library.getSnapshot().status === 'loading') return;
      stop();
      resolve();
    });
  });

export interface DeckScreenWarmupOptions {
  readonly catalog?: CardCatalogSource;
  readonly samples?: PopularDecklistSource;
  readonly library?: Pick<DeckLibrary, 'getSnapshot' | 'subscribe'>;
  readonly warm?: (images: readonly WarmCardImage[]) => Promise<void>;
  readonly catalogWaitMs?: number;
}

/**
 * Gets the deck screen ready before it is opened, so it opens with its
 * lists and pictures in place: the saved decks, the tournament and classic
 * lists and the card catalog are loaded, and the covers the screen shows
 * first are loaded and decoded -- the saved decks' as soon as storage has
 * them, the lists' once the catalog can name their cards -- then the first
 * cards the editor's search shows for a new Standard deck.
 */
export const warmDeckScreen = async ({
  catalog = cardCatalog(),
  samples = popularDecklistSource,
  library = deckLibrary(),
  warm = warmCardImages,
  catalogWaitMs = CATALOG_WAIT_MS,
}: DeckScreenWarmupOptions = {}): Promise<void> => {
  if (catalog.prefetch) catalog.prefetch();
  else catalog.load();
  const collection: Promise<PopularDecklistCollection | undefined> = (
    samples.prefetch ? samples.prefetch() : samples.load()
  ).catch(() => undefined);
  const loadedCatalog = catalogLoaded(catalog, catalogWaitMs);
  await libraryLoaded(library);
  const decks = library.getSnapshot().decks;
  const saved = warm(
    homeCoverImages({ decks, collection: undefined, catalog: undefined })
  );
  const lists = homeCoverImages({
    decks,
    collection: await collection,
    catalog: await loadedCatalog,
  });
  const catalogNow = await loadedCatalog;
  await Promise.all([saved, warm(lists)]);
  if (!catalogNow) return;
  const order = preferences().get(DECK_SCREEN_PREFERENCES);
  await warm(
    openingSearchResults(catalogNow.cards, 'standard', order)
      .cards.slice(0, SEARCH_RESULTS_AHEAD)
      .map(resultImageOf)
  );
};
