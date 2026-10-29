import { definePreference } from '../preferences/preference-store.js';

/** How this viewer sees other players' card backs (ADR-041). */
export interface CardBackViewPreferences {
  /**
   * Opponents' uploaded and designed backs show as they chose them; off,
   * each draws as the standard back. Presets always show.
   */
  readonly opponentCustomBacks: boolean;
}

export const CARD_BACK_VIEW_PREFERENCES =
  definePreference<CardBackViewPreferences>({
    key: 'ptcgsim.card-backs.v1',
    defaults: Object.freeze({ opponentCustomBacks: true }),
    parse: (value) => ({
      opponentCustomBacks:
        typeof value !== 'object' ||
        value === null ||
        Reflect.get(value, 'opponentCustomBacks') !== false,
    }),
  });
