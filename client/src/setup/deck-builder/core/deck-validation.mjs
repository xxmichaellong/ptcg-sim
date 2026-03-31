export const DECK_FORMATS = {
  POCKET: 'pocket',
  TCG: 'tcg',
};

export const POCKET_DECK_RULES = {
  formatName: 'TCG Pocket',
  deckSize: { min: 20, max: 20 },
  maxCopiesPerCard: 2,
  exemptSupertypes: ['Energy'],
};

export const TCG_DECK_RULES = {
  formatName: 'TCG',
  deckSize: { min: 60, max: 60 },
  maxCopiesPerCard: 4,
  exemptSupertypes: ['Energy'],
};

const RULES_BY_FORMAT = {
  [DECK_FORMATS.POCKET]: POCKET_DECK_RULES,
  [DECK_FORMATS.TCG]: TCG_DECK_RULES,
};

export function isPocketCard(card = {}) {
  const image = card?.image || card?.images?.large || card?.images?.small || '';
  // Cards from TCGdex contain /tcgp/
  // Cards from Limitless contain /pocket/
  return String(image).includes('/tcgp/') || String(image).includes('/pocket/');
}

export function detectDeckFormat(deck = {}) {
  let pocketCount = 0;
  let tcgCount = 0;
  for (const group of Object.values(deck)) {
    for (const variant of group?.cards || []) {
      if (isPocketCard(variant?.data)) pocketCount += variant.count || 0;
      else tcgCount += variant.count || 0;
    }
  }
  return pocketCount > tcgCount ? DECK_FORMATS.POCKET : DECK_FORMATS.TCG;
}

export function validateDeck(decklist = {}, selectedFormat = DECK_FORMATS.POCKET) {
  const rules = RULES_BY_FORMAT[selectedFormat] || POCKET_DECK_RULES;
  const errors = [];

  const cardGroups = Object.values(decklist || {});
  const totalCards = cardGroups.reduce((total, group) => total + (group?.totalCount || 0), 0);

  if (totalCards < rules.deckSize.min || totalCards > rules.deckSize.max) {
    errors.push(`Deck must contain exactly ${rules.deckSize.max} cards. Current total: ${totalCards}.`);
  }

  let hasPocketCards = false;
  let hasTcgCards = false;

  for (const [cardName, group] of Object.entries(decklist || {})) {
    if (!group?.cards?.length) continue;

    const representativeCard = group.cards[0]?.data;
    const supertype = representativeCard?.supertype || '';
    const isExempt = rules.exemptSupertypes?.includes(supertype);

    if (!isExempt && (group.totalCount || 0) > rules.maxCopiesPerCard) {
      errors.push(`${cardName} has ${group.totalCount} copies (max ${rules.maxCopiesPerCard}).`);
    }

    if (isPocketCard(representativeCard)) hasPocketCards = true;
    else hasTcgCards = true;
  }

  const isMixedPool = hasPocketCards && hasTcgCards;

  if (isMixedPool) {
    errors.push('Deck contains a mix of TCG and Pocket cards. Use only one card pool per deck.');
  } else if (selectedFormat === DECK_FORMATS.POCKET && hasTcgCards) {
    errors.push('Pocket format selected, but deck contains TCG cards.');
  } else if (selectedFormat === DECK_FORMATS.TCG && hasPocketCards) {
    errors.push('TCG format selected, but deck contains Pocket cards.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    totalCards,
    formatName: rules.formatName,
    selectedFormat,
  };
}
