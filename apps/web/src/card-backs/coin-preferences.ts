import { isCoinValue, STANDARD_COIN } from '@ptcgsim/game-core';
import { definePreference } from '../preferences/preference-store.js';
import { RECENT_CARD_BACK_PREFERENCES } from './card-back-preferences.js';

export const COIN_PREFERENCES = definePreference({
  key: 'ptcgsim.coin.v1',
  defaults: Object.freeze({ coin: STANDARD_COIN }),
  parse: (stored: unknown) => {
    const coin: unknown =
      typeof stored === 'object' && stored !== null
        ? Reflect.get(stored, 'coin')
        : undefined;
    return { coin: isCoinValue(coin) ? coin : STANDARD_COIN };
  },
});

export const RECENT_COIN_PREFERENCES = definePreference({
  ...RECENT_CARD_BACK_PREFERENCES,
  key: 'ptcgsim.coin-recent.v1',
});
