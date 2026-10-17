/**
 * When two prints with one name are the same card. The TCG Tournament
 * Handbook (4.1.3) lets any version of a card be played when the names are
 * identical and the text is functionally identical, even where "the
 * wording has been altered" (its example: Copycat CES 127 and TRR 83), but
 * not where the effect differs (Rainbow Energy CES 151, which puts a damage
 * counter, and TR 17, which does damage).
 *
 * Text is compared after undoing the rewording that never changed what a
 * card does; a few staples reworded further are listed by name.
 */

const ENERGY_WORDS: Readonly<Record<string, string>> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
  N: 'Dragon',
  C: 'Colorless',
};

/** In order: a later rule may rely on an earlier one. */
const WORDING: readonly (readonly [RegExp, string])[] = [
  [/[‘’ʼ]/gu, "'"],
  // Rules reminders older Supporters and Stadiums print in their text.
  [
    /\bYou can play only one Supporter card each turn\. When you play this card, put it next to your Active Pokémon\. When your turn ends, discard this card\.\s*/giu,
    '',
  ],
  [
    /\bThis card stays in play when you play it\. Discard this card if another Stadium card comes into play\.\s*/giu,
    '',
  ],
  // "their" since Sun & Moon.
  [/\bhis or her\b/giu, 'their'],
  [/\bhim or her\b/giu, 'them'],
  [/\bhe or she\b/giu, 'they'],
  // "reveal" and "Then, shuffle" since Scarlet & Violet.
  [/\bShuffle your deck afterward\b/giu, 'Then, shuffle your deck'],
  [/\bshow (it|them) to your opponent\b/giu, 'reveal $1'],
  [
    /\bswitch (1 of your opponent's Benched Pokémon) with their Active Pokémon\b/giu,
    'switch in $1 to the Active Spot',
  ],
  [/\bEnergy(?: card)? attached to 1 of\b/giu, 'Energy from 1 of'],
];

/**
 * A card's rules text with wording-only changes undone, so prints that
 * differ only so compare equal. TCGdex spells energy symbols as words in
 * older sets: {C}{C} is "ColorlessColorless" there.
 */
export const rulesWording = (text: string): string => {
  let result = text.replaceAll(
    /\{([GRWLPFDMYNC])\}/gu,
    (_, symbol: string) => ENERGY_WORDS[symbol]!
  );
  for (const [pattern, replacement] of WORDING) {
    result = result.replaceAll(pattern, replacement);
  }
  return result;
};

/**
 * Trainers every print of which is one card: reworded past what
 * `rulesWording` undoes, or made one by official errata, which has every
 * print played as the newest (Rare Candy: its older prints, which also
 * evolved to Stage 1, are legal as today's -- Limitless lists Sandstorm's
 * as legal). Each name was checked against all its English prints; a
 * later card with the name and another effect must come off.
 */
export const ONE_CARD_TRAINERS: ReadonlySet<string> = new Set([
  'Copycat',
  'Counter Gain',
  'Lucky Helmet',
  'Pokémon Center Lady',
  'Rare Candy',
  'Repel',
  'Scoop Up Cyclone',
  'Scramble Switch',
  'Switch',
  'Tool Scrapper',
  'Ultra Ball',
]);
