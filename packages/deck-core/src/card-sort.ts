import type { Deck, DeckCard } from './types.js';

const SUPERTYPE_PRIORITY: Readonly<Record<string, number>> = {
  Pokémon: 1,
  Pokemon: 1,
  Trainer: 2,
  Energy: 3,
};

export const compareCardsBySupertype = (
  first: Pick<DeckCard, 'supertype'> = {},
  second: Pick<DeckCard, 'supertype'> = {}
): number => {
  const firstPriority = SUPERTYPE_PRIORITY[first.supertype ?? ''] ?? 999;
  const secondPriority = SUPERTYPE_PRIORITY[second.supertype ?? ''] ?? 999;
  if (firstPriority < secondPriority) return -1;
  if (firstPriority > secondPriority) return 1;
  return 0;
};

export type CountedDeckCard = DeckCard & { readonly count: number };

export const flattenDeckToCardArray = (deck: Deck = {}): CountedDeckCard[] =>
  Object.values(deck).flatMap((group) =>
    (group?.cards ?? []).map((variant) => ({
      ...variant.data,
      count: variant.count,
    }))
  );

export const sortCardsBySupertype = <Card extends DeckCard>(
  cards: readonly Card[] = []
): Card[] => [...cards].sort(compareCardsBySupertype);

export const getSortedDeckCardArray = (deck: Deck = {}): CountedDeckCard[] =>
  sortCardsBySupertype(flattenDeckToCardArray(deck));
