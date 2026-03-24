import { isDatabaseCard, isFormattedDeckCard } from './card-compare.mjs';

export function formatImageUrl(cardObj = {}) {
  if (isDatabaseCard(cardObj)) {
    return cardObj.images?.large || '';
  }

  if (isFormattedDeckCard(cardObj)) {
    const image = cardObj.image || '';
    if (image.startsWith('assets')) {
      if (!image.includes('tishinator')) {
        return `https://tishinator.github.io/PTCGDeckBuilder${image}`;
      }
    }
    return image;
  }

  return '';
}

export function formatCardType(cardObj = {}) {
  return cardObj.supertype || '';
}

export function serializeDeckToSimCsv(decklist = {}) {
  const simHeader = 'QTY,Name,Type,URL';
  const rows = [];

  for (const cardName in decklist) {
    const group = decklist[cardName];
    if (!group?.cards) continue;

    for (const variant of group.cards) {
      const quantity = variant?.count;
      const type = formatCardType(variant?.data || {});
      const url = formatImageUrl(variant?.data || {});

      if (cardName !== '' && type !== '' && url !== '') {
        rows.push(`${quantity},${cardName},${type},${url}`);
      }
    }
  }

  return `${simHeader}\n${rows.join('\n')}`;
}

export function parseSimCsv(csvData = '') {
  const rows = String(csvData).split('\n');
  const newDecklist = {};

  for (const [index, row] of rows.entries()) {
    if (index === 0 || !row.trim()) continue;

    const cells = row.split(',');
    const card = {
      count: cells[0],
      name: cells[1],
      supertype: cells[2],
      image: cells[3]?.trim(),
    };

    if (!newDecklist[card.name]) {
      newDecklist[card.name] = { cards: [], totalCount: 0 };
    }

    let cardFound = false;
    for (const cardEntry of newDecklist[card.name].cards) {
      if (cardEntry.data.image === card.image) {
        cardEntry.count += Number(card.count);
        cardFound = true;
        break;
      }
    }

    if (!cardFound) {
      newDecklist[card.name].cards.push({ data: card, count: Number(card.count) });
    }

    newDecklist[card.name].totalCount += Number(card.count);
  }

  return newDecklist;
}
