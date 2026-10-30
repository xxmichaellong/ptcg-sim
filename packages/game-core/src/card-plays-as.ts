/** What a card may be played as besides its own kind. */
export type CardPlaysAs = 'Pokémon' | 'Energy';

export const CARD_PLAYS_AS: readonly CardPlaysAs[] = Object.freeze([
  'Pokémon',
  'Energy',
]);
