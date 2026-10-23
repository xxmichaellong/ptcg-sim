import {
  deckCardFromCatalog,
  deckListOf,
  type CatalogCard,
  type CatalogSet,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';
import { afterEach, describe, expect, it } from 'vitest';

import { bringDeckFactsUpToDate } from './deck-facts.js';
import { DeckLibrary, type DeckLibraryBackend } from './deck-library.js';

const set: CatalogSet = {
  id: 'sv05',
  code: 'TEF',
  name: 'Temporal Forces',
  series: 'Scarlet & Violet',
  released: '2024-03-22',
};
const print = {
  id: 'TEF 157',
  name: 'Prime Catcher',
  category: 'Trainer',
  set,
  number: '157',
  image: 'https://assets/tef/157/high.webp',
  imageSmall: 'https://assets/tef/157/low.webp',
  tags: ['ACE SPEC'],
  types: [],
  abilities: [],
  attacks: [],
  dex: [],
  printGroup: 'Prime Catcher',
  trainerType: 'Item',
  regulationMark: 'H',
} as const;
const catalogOf = (standard: boolean, builtAt: string): LoadedCatalog => {
  const card = {
    ...print,
    legal: { standard, expanded: true },
  } as unknown as CatalogCard;
  return {
    builtAt,
    cards: [card],
    sets: [set],
    byId: new Map([[card.id, card]]),
    byName: new Map(),
  };
};
// A tab open since yesterday, and one opened after today's rebuild, which
// rotated the card out of Standard.
const yesterday = catalogOf(true, '2026-10-22T06:17:00Z');
const today = catalogOf(false, '2026-10-23T06:17:00Z');

const libraries: DeckLibrary[] = [];
afterEach(() => {
  for (const library of libraries.splice(0)) library.dispose();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two tabs over one store, each bringing decks up to its own catalog. */
const twoTabs = (name: string) => {
  const stored = new Map<string, unknown>();
  let writes = 0;
  const backend: DeckLibraryBackend = {
    readAll: async () =>
      [...stored.values()].map((deck) => structuredClone(deck)),
    read: async (id) => structuredClone(stored.get(id)),
    write: async (decks) => {
      writes += decks.length;
      const copies = decks.map((deck) => structuredClone(deck));
      await wait(4);
      for (const deck of copies) stored.set(deck.id, deck);
    },
    remove: async (id) => {
      await wait(4);
      stored.delete(id);
    },
  };
  stored.set('d1', {
    id: 'd1',
    name: 'Deck',
    format: 'standard',
    cards: structuredClone(
      deckListOf([
        {
          card: deckCardFromCatalog(yesterday.cards[0]!, {
            catalog: yesterday,
          }),
          count: 1,
        },
      ])
    ),
    createdAt: 1,
    updatedAt: 1,
  });
  const tab = (catalog: LoadedCatalog) => {
    const library = new DeckLibrary({
      backend,
      channel: new BroadcastChannel(name),
    });
    libraries.push(library);
    library.subscribe(() => {
      const state = library.getSnapshot();
      if (state.status !== 'loading')
        bringDeckFactsUpToDate(library, state.decks, catalog);
    });
    return library;
  };
  return { older: tab(yesterday), newer: tab(today), writes: () => writes };
};

describe('two tabs a catalog rebuild apart', () => {
  it('bring a deck up to the newer catalog once, then leave it, keeping what the older tab changes', async () => {
    const { older, newer, writes } = twoTabs('facts-a');
    await wait(500);
    expect(newer.get('d1')?.cards[0]?.card.facts?.legal?.standard).toBe(false);
    const settled = writes();
    await wait(500);
    expect(writes()).toBe(settled);
    // An edit in the older tab stays, and a deck it deletes stays deleted.
    const card = older.get('d1')!.cards[0]!.card;
    older.update('d1', { cards: deckListOf([{ card, count: 2 }]) });
    await wait(500);
    expect(older.get('d1')?.cards[0]?.count).toBe(2);
    expect(newer.get('d1')?.cards[0]?.count).toBe(2);
    older.remove('d1');
    await wait(500);
    expect(older.get('d1')).toBeUndefined();
    expect(newer.get('d1')).toBeUndefined();
  });
});
