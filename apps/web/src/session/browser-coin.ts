import { STANDARD_COIN } from '@ptcgsim/game-core';
import { COIN_PREFERENCES } from '../card-backs/coin-preferences.js';
import { preferences } from '../preferences/preference-store.js';
import {
  requestBrowserCardBack,
  type BrowserCardBackRequestOptions,
} from './browser-card-back.js';

/** The same designer and image importer as sleeves, in the coin's shape. */
export const editBrowserCoin = async (
  current?: string,
  signal?: AbortSignal,
  remember = true,
  options: Pick<BrowserCardBackRequestOptions, 'worn' | 'forgetWorn'> = {}
): Promise<string | undefined> => {
  const store = preferences();
  const chosen = await requestBrowserCardBack({
    ...options,
    shape: 'coin',
    current: current ?? store.get(COIN_PREFERENCES).coin,
    ...(signal ? { signal } : {}),
    forgetWorn: (coin) => {
      const putBack = options.forgetWorn?.(coin);
      const before = store.get(COIN_PREFERENCES).coin;
      if (before === coin) store.set(COIN_PREFERENCES, { coin: STANDARD_COIN });
      return () => {
        if (
          before === coin &&
          store.get(COIN_PREFERENCES).coin === STANDARD_COIN
        )
          store.set(COIN_PREFERENCES, { coin: before });
        putBack?.();
      };
    },
  });
  if (remember && chosen && !signal?.aborted)
    store.set(COIN_PREFERENCES, { coin: chosen });
  return signal?.aborted ? undefined : chosen;
};
