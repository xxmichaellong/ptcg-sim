import type { Deck, DeckCard } from './types.js';

export const DECK_FORMATS = {
  POCKET: 'pocket',
  TCG: 'tcg',
} as const;

export type DeckFormat = (typeof DECK_FORMATS)[keyof typeof DECK_FORMATS];

export interface DeckRules {
  readonly formatName: string;
  readonly deckSize: {
    readonly min: number;
    readonly max: number;
  };
  readonly maxCopiesPerCard: number;
  readonly exemptSupertypes: readonly string[];
}

export const POCKET_DECK_RULES: DeckRules = {
  formatName: 'TCG Pocket',
  deckSize: { min: 20, max: 20 },
  maxCopiesPerCard: 2,
  exemptSupertypes: ['Energy'],
};

export const TCG_DECK_RULES: DeckRules = {
  formatName: 'TCG',
  deckSize: { min: 60, max: 60 },
  maxCopiesPerCard: 4,
  exemptSupertypes: ['Energy'],
};

const RULES_BY_FORMAT: Readonly<Record<DeckFormat, DeckRules>> = {
  [DECK_FORMATS.POCKET]: POCKET_DECK_RULES,
  [DECK_FORMATS.TCG]: TCG_DECK_RULES,
};

export const isPocketCard = (card: DeckCard = {}): boolean => {
  const image = card.image || card.images?.large || card.images?.small || '';
  return image.includes('/tcgp/') || image.includes('/pocket/');
};

export const detectDeckFormat = (deck: Deck = {}): DeckFormat => {
  let pocketCount = 0;
  let tcgCount = 0;
  for (const group of Object.values(deck)) {
    for (const variant of group?.cards ?? []) {
      if (isPocketCard(variant.data)) pocketCount += variant.count || 0;
      else tcgCount += variant.count || 0;
    }
  }
  return pocketCount > tcgCount ? DECK_FORMATS.POCKET : DECK_FORMATS.TCG;
};

export interface DeckValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly totalCards: number;
  readonly formatName: string;
  readonly selectedFormat: string;
}

export const validateDeck = (
  decklist: Deck = {},
  selectedFormat: DeckFormat | string = DECK_FORMATS.POCKET
): DeckValidationResult => {
  const rules =
    selectedFormat === DECK_FORMATS.TCG
      ? RULES_BY_FORMAT.tcg
      : POCKET_DECK_RULES;
  const errors: string[] = [];
  const groups = Object.values(decklist);
  const totalCards = groups.reduce(
    (total, group) => total + (group?.totalCount || 0),
    0
  );

  if (totalCards < rules.deckSize.min || totalCards > rules.deckSize.max) {
    errors.push(
      `Deck must contain exactly ${rules.deckSize.max} cards. Current total: ${totalCards}.`
    );
  }

  let hasPocketCards = false;
  let hasTcgCards = false;

  for (const [cardName, group] of Object.entries(decklist)) {
    if (!group?.cards?.length) continue;

    const representativeCard = group.cards[0]?.data;
    const supertype = representativeCard?.supertype || '';
    const isExempt = rules.exemptSupertypes.includes(supertype);
    if (!isExempt && (group.totalCount || 0) > rules.maxCopiesPerCard) {
      errors.push(
        `${cardName} has ${group.totalCount} copies (max ${rules.maxCopiesPerCard}).`
      );
    }

    for (const variant of group.cards) {
      if (isPocketCard(variant.data)) hasPocketCards = true;
      else hasTcgCards = true;
    }
  }

  if (hasPocketCards && hasTcgCards) {
    errors.push(
      'Deck contains a mix of TCG and Pocket cards. Use only one card pool per deck.'
    );
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
};
