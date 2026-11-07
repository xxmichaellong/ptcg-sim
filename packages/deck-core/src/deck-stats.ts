import { isBasicEnergy, isBasicPokemon } from './deck-rules.js';
import { deckTotals, type DeckList } from './deck-list.js';

/**
 * The numbers players check a deck by: how its 60 split, how many Basic
 * Pokémon it has, and what that means for the opening hand.
 */
export interface DeckStats {
  readonly total: number;
  readonly pokemon: number;
  readonly trainer: number;
  readonly energy: number;
  /** Basic Pokémon cards (the ones a game can start with). */
  readonly basics: number;
  /** Pokémon whose stage isn't known (typed in by hand). */
  readonly unknownPokemon: number;
  readonly byTrainerType: Readonly<Record<string, number>>;
  readonly basicEnergy: number;
  readonly specialEnergy: number;
  /** Chance a 7-card opening hand has no Basic Pokémon. */
  readonly mulligan: number;
  /** Chance it has exactly one (that one must start). */
  readonly oneBasic: number;
}

/** n choose k, as a float; exact enough for decks of a few dozen cards. */
const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index += 1) {
    result = (result * (n - Math.min(k, n - k) + index)) / index;
  }
  return result;
};

/** Chance a hand of `hand` from `deck` cards holds exactly `hits` of `copies`. */
export const handChance = (
  deck: number,
  copies: number,
  hand: number,
  hits: number
): number =>
  deck < hand
    ? 0
    : (choose(copies, hits) * choose(deck - copies, hand - hits)) /
      choose(deck, hand);

export const deckStats = (list: DeckList): DeckStats => {
  const totals = deckTotals(list);
  let basics = 0;
  let unknownPokemon = 0;
  let basicEnergy = 0;
  let specialEnergy = 0;
  const byTrainerType: Record<string, number> = {};
  for (const { card, count } of list) {
    if (card.category === 'Pokémon') {
      if (isBasicPokemon(card)) basics += count;
      else if (!card.facts?.stage) unknownPokemon += count;
    } else if (card.category === 'Trainer') {
      const kind = card.facts?.trainerType ?? 'Other';
      byTrainerType[kind] = (byTrainerType[kind] ?? 0) + count;
    } else if (isBasicEnergy(card)) {
      basicEnergy += count;
    } else {
      specialEnergy += count;
    }
  }
  const hand = Math.min(7, totals.total);
  return Object.freeze({
    ...totals,
    basics,
    unknownPokemon,
    byTrainerType: Object.freeze(byTrainerType),
    basicEnergy,
    specialEnergy,
    mulligan:
      totals.total === 0 ? 0 : handChance(totals.total, basics, hand, 0),
    oneBasic:
      totals.total === 0 ? 0 : handChance(totals.total, basics, hand, 1),
  });
};

/**
 * A sample opening: the deck shuffled, its first seven cards the hand and
 * the next six the Prizes, as a game's setup deals them. `random` returns
 * [0, 1), Math.random's contract.
 */
export const sampleOpening = <Card>(
  list: readonly { readonly card: Card; readonly count: number }[],
  random: () => number = Math.random
): { readonly hand: readonly Card[]; readonly prizes: readonly Card[] } => {
  const cards = list.flatMap(({ card, count }) =>
    Array.from({ length: Math.min(count, 999) }, () => card)
  );
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other]!, cards[index]!];
  }
  return Object.freeze({
    hand: Object.freeze(cards.slice(0, 7)),
    prizes: Object.freeze(cards.slice(7, 13)),
  });
};
