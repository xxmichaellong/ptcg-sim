import {
  deckTotals,
  sortDeckList,
  type CardCategory,
  type DeckList,
} from './deck-list.js';

/**
 * A deck as text, in the shape Pokémon TCG Live exports and every deck
 * site (Limitless, the PTCGL importer itself) reads:
 *
 *   Pokémon: 12
 *   4 Dreepy TWM 128
 *   …
 *
 *   Trainer: 36
 *   …
 *
 *   Energy: 12
 *   …
 *
 *   Total Cards: 60
 *
 * A card with no set and number (typed in by hand) is written by name.
 */
export const formatDecklistText = (list: DeckList): string => {
  const totals = deckTotals(list);
  const sorted = sortDeckList(list);
  const section = (category: CardCategory, count: number): string[] => {
    const lines = sorted
      .filter((entry) => entry.card.category === category)
      .map(({ card, count: copies }) =>
        // One line a card, whatever a name kept from a file holds.
        [copies, card.name.replace(/\s+/gu, ' '), card.set, card.number]
          .filter((part) => part !== undefined && part !== '')
          .join(' ')
      );
    return lines.length === 0 ? [] : [`${category}: ${count}`, ...lines, ''];
  };
  return [
    ...section('Pokémon', totals.pokemon),
    ...section('Trainer', totals.trainer),
    ...section('Energy', totals.energy),
    `Total Cards: ${totals.total}`,
  ].join('\n');
};
