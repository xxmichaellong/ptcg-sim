import { definePreference } from '../preferences/preference-store.js';

/** Who the player is at a multiplayer table, remembered on this device. */
export interface PlayerPreferences {
  /** The name they last hosted or joined a room with. */
  readonly displayName: string;
}

/** The room protocol caps display names well below this. */
const MAX_STORED_NAME = 64;

export const PLAYER_PREFERENCES = definePreference<PlayerPreferences>({
  key: 'ptcgsim.player.v1',
  defaults: Object.freeze({ displayName: '' }),
  parse: (value) => {
    const name =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'displayName')
        : undefined;
    return {
      displayName:
        typeof name === 'string' ? name.trim().slice(0, MAX_STORED_NAME) : '',
    };
  },
});
