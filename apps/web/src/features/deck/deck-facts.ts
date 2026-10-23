import {
  DECK_FACTS_VERSION,
  withCatalogFacts,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';

import type { DeckLibrary, SavedDeck } from './deck-library.js';

/**
 * What a deck's facts were brought up to: how this build works them out,
 * then the catalog's build ("2/2026-10-23T06:17:00.000Z"). A stamp from
 * before the version was kept is the catalog's build alone, version 0.
 */
interface FactsStamp {
  readonly version: number;
  readonly builtAt: string;
}

const readStamp = (stamp: string): FactsStamp => {
  const match = /^(\d+)\/(.+)$/u.exec(stamp);
  return match
    ? { version: Number(match[1]), builtAt: match[2]! }
    : { version: 0, builtAt: stamp };
};

/** Built after the other, by when the server built each catalog. */
const builtAfter = (ours: string, theirs: string): boolean => {
  const [left, right] = [Date.parse(ours), Date.parse(theirs)];
  return Number.isFinite(left) && Number.isFinite(right)
    ? left > right
    : ours > theirs;
};

const newer = (ours: FactsStamp, theirs: FactsStamp): boolean =>
  ours.version !== theirs.version
    ? ours.version > theirs.version
    : builtAfter(ours.builtAt, theirs.builtAt);

/**
 * Saved decks with their cards' facts as this page works them out from its
 * catalog (ADR-033 §13), except where another tab brought them up to a
 * newer catalog or a newer way of working them out: two tabs a daily
 * rebuild (or a release) apart would otherwise rewrite a deck in turn for
 * as long as both stayed open, each write undoing the other tab's edits.
 */
export const bringDeckFactsUpToDate = (
  library: DeckLibrary,
  decks: readonly SavedDeck[],
  catalog: LoadedCatalog
): void => {
  const ours: FactsStamp = {
    version: DECK_FACTS_VERSION,
    builtAt: catalog.builtAt,
  };
  for (const deck of decks) {
    if (
      deck.factsFrom !== undefined &&
      !newer(ours, readStamp(deck.factsFrom))
    ) {
      continue;
    }
    const upgraded = withCatalogFacts(deck.cards, catalog);
    if (upgraded !== deck.cards) {
      library.update(
        deck.id,
        {
          cards: upgraded,
          factsFrom: `${String(ours.version)}/${ours.builtAt}`,
        },
        { touch: false }
      );
    }
  }
};
