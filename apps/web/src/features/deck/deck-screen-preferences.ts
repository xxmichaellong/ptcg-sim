import { CATALOG_SORTS, type CatalogSort } from '@ptcgsim/deck-core';

import { definePreference } from '../../preferences/preference-store.js';

/**
 * How the player likes the deck screen, kept between visits. (Card images'
 * language, once chosen here for each import, is now a setting of its own
 * that applies to every card shown: card-image-language.ts.)
 */
export interface DeckScreenPreferences {
  /** The deck shown as rows of names, or as card images. */
  readonly deckView: 'list' | 'images';
  readonly sort: CatalogSort;
  /** Every printing of a card in the search results, not one per card. */
  readonly allPrints: boolean;
  /** Saved decks last put on each seat, for the next room. */
  readonly lastDeckIds: {
    readonly main?: string;
    readonly alternate?: string;
  };
}

const DEFAULTS: DeckScreenPreferences = Object.freeze({
  deckView: 'list',
  sort: 'newest',
  allPrints: false,
  lastDeckIds: Object.freeze({}),
});

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

const deckId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 64
    ? value
    : undefined;

export const DECK_SCREEN_PREFERENCES = definePreference<DeckScreenPreferences>({
  key: 'ptcgsim.deck-screen.v1',
  defaults: DEFAULTS,
  parse: (value) => {
    const view = field(value, 'deckView');
    const sort = field(value, 'sort');
    const last = field(value, 'lastDeckIds');
    const main = deckId(field(last, 'main'));
    const alternate = deckId(field(last, 'alternate'));
    return {
      deckView: view === 'images' ? 'images' : 'list',
      sort: (CATALOG_SORTS as readonly unknown[]).includes(sort)
        ? (sort as CatalogSort)
        : DEFAULTS.sort,
      allPrints: field(value, 'allPrints') === true,
      lastDeckIds: Object.freeze({
        ...(main ? { main } : {}),
        ...(alternate ? { alternate } : {}),
      }),
    };
  },
});
