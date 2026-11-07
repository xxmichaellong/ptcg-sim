import { parseCardBack } from '@ptcgsim/game-core';

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

/** How many of the player's own backs the chooser keeps to hand. */
export const RECENT_CARD_BACKS = 8;

/** The player's latest designed and uploaded backs, newest first. */
export interface RecentCardBacks {
  readonly backs: readonly string[];
}

/** A design or an uploaded picture: the backs worth keeping to hand. */
const isOwnMade = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const kind = parseCardBack(value)?.kind;
  return kind === 'design' || kind === 'image';
};

export const RECENT_CARD_BACK_PREFERENCES = definePreference<RecentCardBacks>({
  key: 'ptcgsim.card-back-recent.v1',
  defaults: Object.freeze({ backs: Object.freeze([]) }),
  parse: (value) => {
    const backs: unknown =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'backs')
        : undefined;
    return {
      backs: Array.isArray(backs)
        ? [...new Set(backs.filter(isOwnMade))].slice(0, RECENT_CARD_BACKS)
        : [],
    };
  },
});

/**
 * The list with `back` put first (a design or a picture; any other back
 * leaves it as it is), each once, no longer than the chooser keeps.
 */
export const withRecentCardBack = (
  recent: readonly string[],
  back: string
): readonly string[] =>
  isOwnMade(back)
    ? [back, ...recent.filter((each) => each !== back)].slice(
        0,
        RECENT_CARD_BACKS
      )
    : recent;
