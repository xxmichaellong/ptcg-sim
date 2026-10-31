import { definePreference } from '../../preferences/preference-store.js';
import {
  TOURNAMENT_FORMATS,
  type TournamentFormat,
} from './tournament-decks-client.js';

/**
 * What tournament data the deck screen shows (ADR-037 §9): one format, and
 * official majors (Regionals and up) alone unless online events are asked
 * for too. Shared by deck search, the tournaments list and a deck's lists,
 * and kept between visits.
 */
export interface TournamentPreferences {
  readonly format: TournamentFormat;
  /** Limitless's online events too, not majors alone. */
  readonly online: boolean;
}

const DEFAULTS: TournamentPreferences = Object.freeze({
  format: 'STANDARD',
  online: false,
});

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

export const TOURNAMENT_PREFERENCES = definePreference<TournamentPreferences>({
  key: 'ptcgsim.tournaments.v1',
  defaults: DEFAULTS,
  parse: (value) => {
    const format = field(value, 'format');
    return {
      format: (TOURNAMENT_FORMATS as readonly unknown[]).includes(format)
        ? (format as TournamentFormat)
        : DEFAULTS.format,
      online: field(value, 'online') === true,
    };
  },
});

/**
 * Whether majors are played in a format: every major Labs has is Standard,
 * so majors alone in another show nothing (ADR-037 §8).
 */
export const majorsPlayIn = (format: TournamentFormat): boolean =>
  format === 'STANDARD';
