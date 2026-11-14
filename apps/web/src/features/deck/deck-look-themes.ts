import {
  isCoinValue,
  isPlaymatValue,
  isCardBackValue,
} from '@ptcgsim/game-core';
import { definePreference } from '../../preferences/preference-store.js';
export interface DeckLook {
  readonly cardBack?: string;
  readonly coin?: string;
  readonly playmat?: string;
}
export interface DeckLookTheme extends DeckLook {
  readonly id: string;
  readonly name: string;
}
export const DECK_LOOK_THEMES = definePreference<{
  readonly themes: readonly DeckLookTheme[];
}>({
  key: 'ptcgsim.deck-themes.v1',
  synced: true,
  defaults: { themes: [] },
  parse: (value: unknown) => ({
    themes:
      typeof value === 'object' &&
      value !== null &&
      Array.isArray(Reflect.get(value, 'themes'))
        ? (Reflect.get(value, 'themes') as unknown[])
            .flatMap((item) => {
              if (typeof item !== 'object' || item === null) return [];
              const id: unknown = Reflect.get(item, 'id'),
                name: unknown = Reflect.get(item, 'name'),
                cardBack: unknown = Reflect.get(item, 'cardBack'),
                coin: unknown = Reflect.get(item, 'coin'),
                playmat: unknown = Reflect.get(item, 'playmat');
              return typeof id === 'string' &&
                id.length <= 64 &&
                typeof name === 'string' &&
                name.trim() &&
                name.length <= 80
                ? [
                    {
                      id,
                      name,
                      ...(isCardBackValue(cardBack) ? { cardBack } : {}),
                      ...(isCoinValue(coin) ? { coin } : {}),
                      ...(isPlaymatValue(playmat) ? { playmat } : {}),
                    },
                  ]
                : [];
            })
            .slice(0, 50)
        : [],
  }),
});
