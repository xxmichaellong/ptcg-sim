import type { DeckList } from '@ptcgsim/deck-core';

/**
 * The same cards in the same counts, in whatever order: how a shelf knows
 * the seat holds one of its lists, when names repeat across seasons.
 */
export const sameCards = (left: DeckList, right: DeckList): boolean => {
  const counts = new Map<string, number>();
  for (const { card, count } of left) {
    counts.set(card.id, (counts.get(card.id) ?? 0) + count);
  }
  for (const { card, count } of right) {
    const held = counts.get(card.id);
    if (held === undefined) return false;
    counts.set(card.id, held - count);
  }
  return [...counts.values()].every((count) => count === 0);
};
