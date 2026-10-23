import {
  decodeCatalog,
  deckCardFromCatalog,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import type {
  CardCatalogSource,
  CardCatalogState,
} from './card-catalog-contract.js';
import type { DeckLibrarySnapshot, SavedDeck } from './deck-library.js';
import { warmDeckScreen } from './deck-screen-warmup.js';
import {
  decodePopularDecklists,
  type PopularDecklistCollection,
  type PopularDecklistSource,
} from './popular-decklists.js';
import type { WarmCardImage } from './warm-card-images.js';

const catalog = decodeCatalog(fixture);
const card = (id: string) =>
  deckCardFromCatalog(catalog.cards.find((entry) => entry.id === id)!);

/** A catalog that loads when the test says. */
const catalogSource = () => {
  let state: CardCatalogState = { status: 'idle' };
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  const set = (next: CardCatalogState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const source: CardCatalogSource = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => asked.push('load'),
    prefetch: () => {
      asked.push('prefetch');
      set({ status: 'loading' });
    },
    retry: () => undefined,
  };
  return {
    source,
    asked,
    ready: (loaded: LoadedCatalog) => set({ status: 'ready', catalog: loaded }),
    fail: () => set({ status: 'idle' }),
  };
};

const lists = (): PopularDecklistCollection => {
  const current = decodePopularDecklists({
    'Current Standard': {
      'Dragapult — 1st of 285': '4 Dreepy TWM 128\n2 Dragapult ex TWM 130',
    },
  }).groups.map((group) => ({
    ...group,
    source: { name: 'Limitless', url: 'https://x', fetchedAt: 'today' },
  }));
  const classic = decodePopularDecklists({
    '2023-2024 S&V': { Gardevoir: '4 Ralts SVI 84\n2 Gardevoir ex SVI 86' },
    '2022-2023 SWSH': { Charizard: '4 Charmander PAF 7' },
  }).groups;
  return {
    groups: [...current, ...classic],
    deckCount: 3,
    totalDecklistCodeUnits: 0,
  };
};

const samplesSource = (
  collection: PopularDecklistCollection
): PopularDecklistSource => ({
  load: () => Promise.resolve(collection),
  prefetch: () => Promise.resolve(collection),
  selectRandom: () => Promise.reject(new Error('unused')),
});

const saved: SavedDeck = {
  id: 'deck-1',
  name: 'Charizard',
  format: 'standard',
  cards: [
    { card: card('OBF 125'), count: 2 },
    { card: card('PAF 7'), count: 4 },
  ],
  createdAt: 0,
  updatedAt: 0,
};

const library = (decks: readonly SavedDeck[]) => {
  const snapshot: DeckLibrarySnapshot = { status: 'ready', decks };
  return { getSnapshot: () => snapshot, subscribe: () => () => undefined };
};

describe('warming the deck screen up', () => {
  it("warms the saved decks' covers at once, then the lists', then a new deck's search", async () => {
    const catalogs = catalogSource();
    const warmed: (readonly string[])[] = [];
    const warm = (images: readonly WarmCardImage[]) => {
      warmed.push(images.map((image) => image.src));
      return Promise.resolve();
    };
    const done = warmDeckScreen({
      catalog: catalogs.source,
      samples: samplesSource(lists()),
      library: library([saved]),
      warm,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The catalog is still loading: the saved deck's cover is already asked.
    expect(catalogs.asked).toEqual(['prefetch']);
    expect(warmed).toEqual([[card('OBF 125').imageSmall]]);

    catalogs.ready(catalog);
    await done;
    // The tournament list's cover, then the classic season's that shows.
    expect(warmed[1]).toEqual([
      card('OBF 125').imageSmall,
      card('TWM 130').imageSmall,
      card('SVI 86').imageSmall,
    ]);
    // Then what a new deck's search grid opens on.
    expect(warmed[2]!.length).toBeGreaterThan(0);
    expect(warmed[2]!.length).toBeLessThanOrEqual(30);
  });

  it('warms only what it can name when the catalog does not load', async () => {
    const catalogs = catalogSource();
    const warmed: (readonly string[])[] = [];
    const done = warmDeckScreen({
      catalog: catalogs.source,
      samples: samplesSource(lists()),
      library: library([saved]),
      warm: (images) => {
        warmed.push(images.map((image) => image.src));
        return Promise.resolve();
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    catalogs.fail();
    await done;
    expect(warmed).toEqual([
      [card('OBF 125').imageSmall],
      [card('OBF 125').imageSmall],
    ]);
  });
});
