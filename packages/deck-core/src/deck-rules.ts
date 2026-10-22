import { plural, t } from '@lingui/core/macro';

import {
  deckTotals,
  ruleName,
  type DeckCard,
  type DeckList,
} from './deck-list.js';

/**
 * Deck-building rules for each format a deck can be built for. A deck is
 * checked against one format, and every problem comes back as a typed issue
 * naming the cards it is about, so the builder can point at them.
 *
 * Legality (which cards a format allows) comes from the card itself: the
 * catalog marks each printing legal or not, reprints included. A card with
 * no such facts -- typed in by hand, or from an older saved deck -- is
 * reported as unchecked, never guessed.
 */

export const DECK_FORMAT_IDS = [
  'standard',
  'expanded',
  'unlimited',
  'pocket',
] as const;
export type DeckFormatId = (typeof DECK_FORMAT_IDS)[number];

export interface DeckFormatRules {
  readonly id: DeckFormatId;
  readonly name: string;
  readonly deckSize: number;
  /** Copies of one card name (Basic Energy aside). */
  readonly copies: number;
  readonly legality?: 'standard' | 'expanded';
  readonly pocket: boolean;
}

export const DECK_FORMATS: Readonly<Record<DeckFormatId, DeckFormatRules>> =
  Object.freeze({
    standard: Object.freeze({
      id: 'standard',
      name: 'Standard',
      deckSize: 60,
      copies: 4,
      legality: 'standard',
      pocket: false,
    }),
    expanded: Object.freeze({
      id: 'expanded',
      name: 'Expanded',
      deckSize: 60,
      copies: 4,
      legality: 'expanded',
      pocket: false,
    }),
    unlimited: Object.freeze({
      id: 'unlimited',
      name: 'Unlimited',
      deckSize: 60,
      copies: 4,
      pocket: false,
    }),
    pocket: Object.freeze({
      id: 'pocket',
      name: 'TCG Pocket',
      deckSize: 20,
      copies: 2,
      pocket: true,
    }),
  });

export const isDeckFormatId = (value: unknown): value is DeckFormatId =>
  typeof value === 'string' &&
  (DECK_FORMAT_IDS as readonly string[]).includes(value);

export type DeckIssue =
  | {
      readonly code: 'size';
      readonly count: number;
      readonly required: number;
    }
  | { readonly code: 'no_basic' }
  | {
      readonly code: 'copies';
      readonly name: string;
      readonly count: number;
      readonly limit: number;
      readonly cardIds: readonly string[];
    }
  | {
      /** ACE SPEC, Radiant, Pokémon ☆: one card of the kind per deck. */
      readonly code: 'one_per_deck';
      readonly kind: 'ACE SPEC' | 'Radiant' | 'Star';
      readonly count: number;
      readonly cardIds: readonly string[];
    }
  | {
      /** Prism Star: one copy of each name. */
      readonly code: 'prism_star';
      readonly name: string;
      readonly count: number;
      readonly cardIds: readonly string[];
    }
  | {
      readonly code: 'not_legal';
      readonly cardIds: readonly string[];
    }
  | {
      readonly code: 'wrong_pool';
      /** Pocket cards in a TCG deck, or TCG cards in a Pocket deck. */
      readonly cardIds: readonly string[];
    }
  | {
      readonly code: 'energy_in_pocket';
      readonly cardIds: readonly string[];
    }
  | {
      /** Cards the rules know nothing about (typed in by hand). */
      readonly code: 'unchecked';
      readonly cardIds: readonly string[];
    };

export interface DeckCheck {
  readonly format: DeckFormatRules;
  /** Problems that make the deck illegal in the format. */
  readonly errors: readonly DeckIssue[];
  /** Things the check could not confirm. */
  readonly warnings: readonly DeckIssue[];
  readonly valid: boolean;
  readonly total: number;
}

/** The basic Energy types, as the catalog names them ("fire energy"). */
export type BasicEnergyType =
  | 'grass'
  | 'fire'
  | 'water'
  | 'lightning'
  | 'psychic'
  | 'fighting'
  | 'darkness'
  | 'metal'
  | 'fairy';

const ENERGY_BY_SYMBOL: Readonly<Record<string, BasicEnergyType>> = {
  g: 'grass',
  r: 'fire',
  w: 'water',
  l: 'lightning',
  p: 'psychic',
  f: 'fighting',
  d: 'darkness',
  m: 'metal',
  y: 'fairy',
};

// By type ("Basic Fire Energy", "Dark Energy") or by its symbol, braced as
// Pokémon TCG Live writes it ("Basic {R} Energy") or bare once folded;
// PTCGO's lists add another "Energy", and some exports a "null".
const BASIC_ENERGY_NAME =
  /^(?:basic\s+)?(?:\{([grwlpfdmy])\}|([grwlpfdmy])|(grass|fire|water|lightning|psychic|fighting|darkness|dark|metal|fairy))\s+energy(?:\s+energy)?(?:\s+null)?$/iu;

/**
 * The basic Energy a card's name says it is, however a list writes it; the
 * one rule the deck checks, the catalog's matching and the deck box share.
 */
export const basicEnergyTypeOf = (
  name: string
): BasicEnergyType | undefined => {
  const match = BASIC_ENERGY_NAME.exec(name.trim());
  if (!match) return undefined;
  const [, braced, bare, word] = match;
  const symbol = (braced ?? bare)?.toLowerCase();
  if (symbol) return ENERGY_BY_SYMBOL[symbol];
  const type = (word ?? '').toLowerCase();
  return type === 'dark' ? 'darkness' : (type as BasicEnergyType);
};

/**
 * Basic Energy has no copy limit. A catalogued card says which it is; a card
 * typed in by hand is taken at its name.
 */
export const isBasicEnergy = (card: DeckCard): boolean =>
  card.category === 'Energy' &&
  (card.facts?.energyType
    ? card.facts.energyType === 'Basic'
    : basicEnergyTypeOf(ruleName(card)) !== undefined);

/** A Pokémon a game can start with: a Basic, or a Baby (they play as Basics). */
export const isBasicPokemon = (card: DeckCard): boolean =>
  card.category === 'Pokémon' &&
  (card.facts?.stage === 'Basic' || card.facts?.stage === 'Baby');

const hasTag = (card: DeckCard, tag: string): boolean =>
  card.facts?.tags?.includes(tag) ?? false;

/** Whether the card is from TCG Pocket (its facts, or its image's path). */
export const isPocketCard = (card: DeckCard): boolean =>
  card.facts?.pocket ??
  [card.image, card.imageSmall ?? ''].some(
    (url) => url.includes('/tcgp/') || url.includes('/pocket/')
  );

/** The format a deck most likely is, for a list with none chosen. */
export const guessDeckFormat = (list: DeckList): DeckFormatId => {
  let pocket = 0;
  let tcg = 0;
  let standard = true;
  let expanded = true;
  for (const { card, count } of list) {
    if (isPocketCard(card)) pocket += count;
    else tcg += count;
    if (card.facts?.legal?.standard === false) standard = false;
    if (card.facts?.legal?.expanded === false) expanded = false;
  }
  if (pocket > tcg) return 'pocket';
  if (standard) return 'standard';
  return expanded ? 'expanded' : 'unlimited';
};

const ids = (cards: readonly DeckCard[]): readonly string[] =>
  Object.freeze(cards.map((card) => card.id));

export const checkDeck = (
  list: DeckList,
  formatId: DeckFormatId
): DeckCheck => {
  const format = DECK_FORMATS[formatId];
  const errors: DeckIssue[] = [];
  const warnings: DeckIssue[] = [];
  const { total } = deckTotals(list);

  if (total !== format.deckSize) {
    errors.push({ code: 'size', count: total, required: format.deckSize });
  }
  // A Pokémon typed in by hand might be the Basic; only a deck whose every
  // Pokémon is known can be told it has none.
  if (
    total > 0 &&
    !list.some(({ card }) => isBasicPokemon(card)) &&
    !list.some(({ card }) => card.category === 'Pokémon' && !card.facts?.stage)
  ) {
    errors.push({ code: 'no_basic' });
  }

  const byName = new Map<
    string,
    { name: string; count: number; cards: DeckCard[] }
  >();
  for (const { card, count } of list) {
    if (isBasicEnergy(card)) continue;
    const key = ruleName(card);
    const group = byName.get(key) ?? { name: card.name, count: 0, cards: [] };
    group.count += count;
    group.cards.push(card);
    byName.set(key, group);
  }
  for (const group of byName.values()) {
    if (group.count > format.copies) {
      errors.push({
        code: 'copies',
        name: group.name,
        count: group.count,
        limit: format.copies,
        cardIds: ids(group.cards),
      });
    }
    const prism = group.cards.filter((card) => hasTag(card, 'Prism Star'));
    if (prism.length > 0 && group.count > 1) {
      errors.push({
        code: 'prism_star',
        name: group.name,
        count: group.count,
        cardIds: ids(prism),
      });
    }
  }

  for (const kind of ['ACE SPEC', 'Radiant', 'Star'] as const) {
    const cards = list.filter(({ card }) => hasTag(card, kind));
    const count = cards.reduce((sum, entry) => sum + entry.count, 0);
    if (count > 1) {
      errors.push({
        code: 'one_per_deck',
        kind,
        count,
        cardIds: ids(cards.map((entry) => entry.card)),
      });
    }
  }

  const wrongPool = list
    .map((entry) => entry.card)
    .filter((card) => isPocketCard(card) !== format.pocket);
  if (wrongPool.length > 0) {
    errors.push({ code: 'wrong_pool', cardIds: ids(wrongPool) });
  }
  if (format.pocket) {
    const energy = list
      .map((entry) => entry.card)
      .filter((card) => card.category === 'Energy');
    if (energy.length > 0) {
      errors.push({ code: 'energy_in_pocket', cardIds: ids(energy) });
    }
  }

  if (format.legality) {
    const legality = format.legality;
    const illegal: DeckCard[] = [];
    const unchecked: DeckCard[] = [];
    for (const { card } of list) {
      if (isPocketCard(card)) continue;
      const legal = card.facts?.legal?.[legality];
      if (legal === false) illegal.push(card);
      else if (legal === undefined && !isBasicEnergy(card))
        unchecked.push(card);
    }
    if (illegal.length > 0) {
      errors.push({ code: 'not_legal', cardIds: ids(illegal) });
    }
    if (unchecked.length > 0) {
      warnings.push({ code: 'unchecked', cardIds: ids(unchecked) });
    }
  }

  return Object.freeze({
    format,
    errors: Object.freeze(errors.map((issue) => Object.freeze(issue))),
    warnings: Object.freeze(warnings.map((issue) => Object.freeze(issue))),
    valid: errors.length === 0,
    total,
  });
};

const cardNames = (list: DeckList, cardIds: readonly string[]): string => {
  const names = [
    ...new Set(
      cardIds.map(
        (id) => list.find((entry) => entry.card.id === id)?.card.name ?? id
      )
    ),
  ];
  if (names.length <= 3) return names.join(', ');
  const shown = names.slice(0, 3).join(', ');
  const more = names.length - 3;
  return t({
    message: `${shown} and ${more} more`,
    comment: 'shown is a list of card names; more counts the rest',
  });
};

/**
 * One plain sentence per issue, for the deck's checklist, in the page's
 * language (ADR-034). Card names stay as the deck has them.
 */
export const describeDeckIssue = (list: DeckList, issue: DeckIssue): string => {
  switch (issue.code) {
    case 'size': {
      const { count, required } = issue;
      if (count < required) {
        const short = required - count;
        return t`${plural(short, { one: `# more card needed (${count}/${required}).`, other: `# more cards needed (${count}/${required}).` })}`;
      }
      const over = count - required;
      return t`${plural(over, { one: `# card too many (${count}/${required}).`, other: `# cards too many (${count}/${required}).` })}`;
    }
    case 'no_basic':
      return t`Needs at least one Basic Pokémon.`;
    case 'copies': {
      const { count, name, limit } = issue;
      return t`${plural(count, { one: `# copy of ${name} (max ${limit}).`, other: `# copies of ${name} (max ${limit}).` })}`;
    }
    case 'one_per_deck': {
      const { count } = issue;
      return issue.kind === 'Star'
        ? t`${plural(count, { one: '# Pokémon ☆ card (max 1).', other: '# Pokémon ☆ cards (max 1).' })}`
        : issue.kind === 'Radiant'
          ? t`${plural(count, { one: '# Radiant card (max 1).', other: '# Radiant cards (max 1).' })}`
          : t`${plural(count, { one: '# ACE SPEC card (max 1).', other: '# ACE SPEC cards (max 1).' })}`;
    }
    case 'prism_star': {
      const { count, name } = issue;
      return t`${plural(count, { one: `# copy of ${name} (Prism Star: max 1).`, other: `# copies of ${name} (Prism Star: max 1).` })}`;
    }
    case 'not_legal': {
      const cards = cardNames(list, issue.cardIds);
      return t`Not legal in this format: ${cards}.`;
    }
    case 'wrong_pool': {
      const cards = cardNames(list, issue.cardIds);
      return t`TCG and Pocket cards don't mix: ${cards}.`;
    }
    case 'energy_in_pocket':
      return t`Pocket decks have no Energy cards.`;
    case 'unchecked': {
      const cards = cardNames(list, issue.cardIds);
      return t`Legality not checked for cards added by hand: ${cards}.`;
    }
  }
};
