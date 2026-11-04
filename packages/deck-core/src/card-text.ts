import type { CatalogCard } from './catalog.js';
import { printId, type DeckCard, type DeckCardText } from './deck-list.js';

/** A catalogued card's text, in the deck's shape: what an edit starts from. */
export const catalogCardText = (card: CatalogCard): DeckCardText => {
  const text: Record<string, unknown> = {};
  if (card.hp !== undefined) text.hp = card.hp;
  if (card.types.length > 0) text.types = [...card.types];
  if (card.stage) text.stage = card.stage;
  if (card.evolvesFrom) text.evolvesFrom = card.evolvesFrom;
  if (card.abilities.length > 0)
    text.abilities = card.abilities.map((ability) => ({ ...ability }));
  if (card.attacks.length > 0)
    text.attacks = card.attacks.map((attack) => ({
      ...attack,
      cost: [...attack.cost],
    }));
  if (card.weakness) {
    text.weakness = card.weakness;
    if (card.weaknessValue) text.weaknessValue = card.weaknessValue;
  }
  if (card.resistance) {
    text.resistance = card.resistance;
    if (card.resistanceValue) text.resistanceValue = card.resistanceValue;
  }
  if (card.retreat !== undefined && card.category === 'Pokémon')
    text.retreat = card.retreat;
  if (card.text) text.rules = card.text;
  return text as DeckCardText;
};

/** A print id as the catalog keys one: a set code and a number. */
const PRINT_ID = /^\S{1,32} \S{1,24}$/u;

/**
 * The catalog print a deck card is ("PAL 185"), by its set and number,
 * else by an id that names one; none for a card made by hand.
 */
export const deckCardPrint = (
  card: Pick<DeckCard, 'id' | 'set' | 'number'>
): string | undefined => {
  if (card.set && card.number) {
    const print = printId(card.set, card.number);
    return PRINT_ID.test(print) ? print : undefined;
  }
  return !card.id.startsWith('custom:') && PRINT_ID.test(card.id)
    ? card.id
    : undefined;
};

/** A print id's set and number ("PAL 185" → PAL, 185). */
export const splitPrint = (
  print: string
): { readonly set: string; readonly number: string } | undefined => {
  if (!PRINT_ID.test(print)) return undefined;
  const space = print.indexOf(' ');
  return { set: print.slice(0, space), number: print.slice(space + 1) };
};
