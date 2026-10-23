import { withCatalogFacts, type LoadedCatalog } from '@ptcgsim/deck-core';

import type { DeckLibrary, SavedDeck } from './deck-library.js';

/** Built after the other, by when the server built each catalog. */
const builtAfter = (ours: string, theirs: string): boolean => {
  const [left, right] = [Date.parse(ours), Date.parse(theirs)];
  return Number.isFinite(left) && Number.isFinite(right)
    ? left > right
    : ours > theirs;
};

/**
 * Saved decks with their cards' facts as this page's catalog has them
 * (ADR-033 §13), except where another tab brought them up to a newer one:
 * two tabs a daily rebuild apart would otherwise rewrite a deck in turn for
 * as long as both stayed open, each write undoing the other tab's edits.
 */
export const bringDeckFactsUpToDate = (
  library: DeckLibrary,
  decks: readonly SavedDeck[],
  catalog: LoadedCatalog
): void => {
  for (const deck of decks) {
    if (
      deck.factsFrom !== undefined &&
      !builtAfter(catalog.builtAt, deck.factsFrom)
    ) {
      continue;
    }
    const upgraded = withCatalogFacts(deck.cards, catalog);
    if (upgraded !== deck.cards) {
      library.update(
        deck.id,
        { cards: upgraded, factsFrom: catalog.builtAt },
        { touch: false }
      );
    }
  }
};
