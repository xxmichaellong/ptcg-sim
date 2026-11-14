/**
 * Several coins in one flip, as a card asks for them: so many coins
 * (`count`, 2 to MAX_COIN_FLIP_COUNT), or one after another until one lands
 * tails (`untilTails`, at most MAX_UNTIL_TAILS_FLIPS in all).
 */
export type CoinFlipSeries =
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'untilTails' };

/** The most coins one `count` flip throws. */
export const MAX_COIN_FLIP_COUNT = 10;
/** Where "until tails" stops if it never lands tails (2^-30 odds). */
export const MAX_UNTIL_TAILS_FLIPS = 30;
