import { areCardsEqual } from './card-compare.js';
import type { Deck, DeckCard, DeckCardGroup, DeckCounts } from './types.js';

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const setOwnGroup = (deck: Deck, name: string, group: DeckCardGroup): void => {
  Object.defineProperty(deck, name, {
    configurable: true,
    enumerable: true,
    value: group,
    writable: true,
  });
};

export const createEmptyDeck = (): Deck => ({});

export const cloneDeck = (deck: Deck = {}): Deck => structuredClone(deck);

export const addCard = (deck: Deck = {}, card: DeckCard = {}): Deck => {
  const nextDeck = cloneDeck(deck);
  const cardName = card.name;
  if (!cardName) return nextDeck;

  if (!hasOwn(nextDeck, cardName)) {
    setOwnGroup(nextDeck, cardName, { cards: [], totalCount: 0 });
  }

  const group = nextDeck[cardName];
  if (!group) return nextDeck;

  const existing = group.cards.find((entry) => areCardsEqual(entry.data, card));
  if (existing) existing.count += 1;
  else group.cards.push({ data: structuredClone(card), count: 1 });

  group.totalCount += 1;
  return nextDeck;
};

export const removeCard = (deck: Deck = {}, card: DeckCard = {}): Deck => {
  const nextDeck = cloneDeck(deck);
  const cardName = card.name;
  if (!cardName || !hasOwn(nextDeck, cardName)) return nextDeck;

  const group = nextDeck[cardName];
  if (!group) return nextDeck;

  const index = group.cards.findIndex((variant) =>
    areCardsEqual(variant.data, card)
  );
  if (index === -1) return nextDeck;

  const variant = group.cards[index];
  if (!variant) return nextDeck;

  variant.count -= 1;
  if (hasOwn(variant.data, 'count')) {
    const dataCount = Number(variant.data.count);
    Object.defineProperty(variant.data, 'count', {
      configurable: true,
      enumerable: true,
      value: dataCount - 1,
      writable: true,
    });
  }
  if (variant.count <= 0) group.cards.splice(index, 1);

  group.totalCount -= 1;
  if (group.totalCount <= 0) delete nextDeck[cardName];
  return nextDeck;
};

export const getDeckCounts = (deck: Deck = {}): DeckCounts => {
  const counts: DeckCounts = {
    pokemon: 0,
    trainer: 0,
    energy: 0,
    total: 0,
  };

  for (const group of Object.values(deck)) {
    for (const variant of group?.cards ?? []) {
      const type = variant.data.supertype;
      const count = Number(variant.count || 0);
      if (type === 'Pokémon' || type === 'Pokemon') counts.pokemon += count;
      if (type === 'Trainer') counts.trainer += count;
      if (type === 'Energy') counts.energy += count;
      counts.total += count;
    }
  }

  return counts;
};

export interface DeckFilters {
  readonly pokemon?: boolean;
  readonly trainer?: boolean;
  readonly energy?: boolean;
}

export const filterDeck = (
  deck: Deck = {},
  filters: DeckFilters = {}
): Deck => {
  const { pokemon = true, trainer = true, energy = true } = filters;
  const filtered: Deck = {};

  for (const [name, group] of Object.entries(deck)) {
    const cards = (group?.cards ?? []).filter((variant) => {
      const type = variant.data.supertype;
      return (
        (pokemon && (type === 'Pokémon' || type === 'Pokemon')) ||
        (trainer && type === 'Trainer') ||
        (energy && type === 'Energy')
      );
    });
    if (cards.length > 0) setOwnGroup(filtered, name, { ...group, cards });
  }

  return filtered;
};

export type DeckImportFormat = 'ptcg-sim-csv' | 'unknown';

export const detectImportFormat = (
  fileContent: string = ''
): DeckImportFormat =>
  String(fileContent)
    .trim()
    .replace(/^\uFEFF/u, '')
    .startsWith('QTY,Name,Type,URL')
    ? 'ptcg-sim-csv'
    : 'unknown';
