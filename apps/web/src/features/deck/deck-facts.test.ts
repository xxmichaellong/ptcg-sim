import {
  DECK_FACTS_VERSION,
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

/**
 * Two tabs over one store, each bringing decks up to its own catalog. A
 * hidden tab's timers run a second or more late: its write delay.
 */
const twoTabs = (
  name: string,
  delays: { readonly older?: number; readonly newer?: number } = {}
) => {
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
  const tab = (catalog: LoadedCatalog, writeDelayMs?: number) => {
    const library = new DeckLibrary({
      backend,
      channel: new BroadcastChannel(name),
      ...(writeDelayMs !== undefined ? { writeDelayMs } : {}),
    });
    libraries.push(library);
    library.subscribe(() => {
      const state = library.getSnapshot();
      if (state.status !== 'loading')
        bringDeckFactsUpToDate(library, state.decks, catalog);
    });
    return library;
  };
  return {
    older: tab(yesterday, delays.older),
    newer: tab(today, delays.newer),
    writes: () => writes,
    stored: () => stored.get('d1') as { cards: { count: number }[] },
  };
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

  it('keep every edit made in the tab in use, whichever catalog it has, while the other tab is hidden', async () => {
    for (const hidden of ['newer', 'older'] as const) {
      const tabs = twoTabs(`facts-hidden-${hidden}`, { [hidden]: 1_000 });
      const used = hidden === 'newer' ? tabs.older : tabs.newer;
      await wait(2_500);
      const before = used.get('d1')!.cards[0]!.count;
      const addOne = () => {
        const { card, count } = used.get('d1')!.cards[0]!;
        used.update('d1', { cards: deckListOf([{ card, count: count + 1 }]) });
      };
      addOne();
      await wait(300);
      addOne();
      await wait(3_000);
      expect(used.get('d1')?.cards[0]?.count, hidden).toBe(before + 2);
      expect(tabs.stored().cards[0]?.count, hidden).toBe(before + 2);
      for (const library of libraries.splice(0)) library.dispose();
    }
  }, 20_000);

  it('works out again the facts of a deck stamped by an older way of working them out, and leaves one stamped by a newer', () => {
    const library = new DeckLibrary({ backend: null });
    libraries.push(library);
    // Facts as an older build worked them out from today's catalog.
    const stale = deckListOf([
      {
        card: deckCardFromCatalog(yesterday.cards[0]!, { catalog: yesterday }),
        count: 1,
      },
    ]);
    const make = (factsFrom: string) => {
      const deck = library.create({
        name: factsFrom,
        format: 'standard',
        cards: stale,
      });
      return library.update(deck.id, { factsFrom }, { touch: false })!;
    };
    const olderWay = make(today.builtAt);
    const newerWay = make(`${String(DECK_FACTS_VERSION + 1)}/${today.builtAt}`);
    bringDeckFactsUpToDate(library, library.getSnapshot().decks, today);
    const standard = (id: string) =>
      library.get(id)?.cards[0]?.card.facts?.legal?.standard;
    expect(standard(olderWay.id)).toBe(false);
    expect(library.get(olderWay.id)?.factsFrom).toBe(
      `${String(DECK_FACTS_VERSION)}/${today.builtAt}`
    );
    expect(standard(newerWay.id)).toBe(true);
  });
});
