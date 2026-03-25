import { areCardsEqual } from './card-compare.mjs';

export function createEmptyDeck() {
  return {};
}

export function cloneDeck(deck = {}) {
  return structuredClone(deck);
}

export function addCard(deck = {}, card = {}) {
  const newDeck = cloneDeck(deck);
  const cardName = card?.name;
  if (!cardName) return newDeck;

  if (!newDeck[cardName]) {
    newDeck[cardName] = { cards: [], totalCount: 0 };
  }

  let cardFound = false;
  for (const cardEntry of newDeck[cardName].cards) {
    if (areCardsEqual(cardEntry.data, card)) {
      cardEntry.count += 1;
      cardFound = true;
      break;
    }
  }

  if (!cardFound) {
    newDeck[cardName].cards.push({ data: card, count: 1 });
  }

  newDeck[cardName].totalCount += 1;
  return newDeck;
}

export function removeCard(deck = {}, card = {}) {
  const newDeck = cloneDeck(deck);
  const cardName = card?.name;
  if (!cardName || !newDeck[cardName]) return newDeck;

  for (const [index, cardVariant] of newDeck[cardName].cards.entries()) {
    if (areCardsEqual(cardVariant.data, card)) {
      cardVariant.count -= 1;
      if (Object.prototype.hasOwnProperty.call(cardVariant.data, 'count')) {
        cardVariant.data.count -= 1;
      }
      if (cardVariant.count <= 0) {
        newDeck[cardName].cards.splice(index, 1);
      }
      newDeck[cardName].totalCount -= 1;
      if (newDeck[cardName].totalCount <= 0) {
        delete newDeck[cardName];
      }
      break;
    }
  }

  return newDeck;
}

export function getDeckCounts(deck = {}) {
  const counts = {
    pokemon: 0,
    trainer: 0,
    energy: 0,
    total: 0,
  };

  for (const cardName in deck) {
    const group = deck[cardName];
    for (const variant of group?.cards || []) {
      const type = variant?.data?.supertype;
      const count = Number(variant?.count || 0);
      if (type === 'Pokémon' || type === 'Pokemon') counts.pokemon += count;
      if (type === 'Trainer') counts.trainer += count;
      if (type === 'Energy') counts.energy += count;
      counts.total += count;
    }
  }

  return counts;
}

export function filterDeck(deck = {}, filters = {}) {
  const {
    pokemon = true,
    trainer = true,
    energy = true,
  } = filters;

  return Object.entries(deck).reduce((acc, [key, value]) => {
    const filteredCards = (value?.cards || []).filter((card) => {
      const type = card?.data?.supertype;
      return (pokemon && (type === 'Pokémon' || type === 'Pokemon')) ||
        (trainer && type === 'Trainer') ||
        (energy && type === 'Energy');
    });

    if (filteredCards.length > 0) {
      acc[key] = { ...value, cards: filteredCards };
    }

    return acc;
  }, {});
}

export function detectImportFormat(fileContent = '') {
  if (String(fileContent).trim().startsWith('QTY,Name,Type,URL')) {
    return 'ptcg-sim-csv';
  }
  return 'unknown';
}
