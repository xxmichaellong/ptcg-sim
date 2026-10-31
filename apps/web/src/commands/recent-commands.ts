import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';

/** How many commands run last are remembered (the palette shows six). */
const RECENT_KEPT = 10;

export interface CommandPreferences {
  /** Ids of the commands run last, the latest first. */
  readonly recent: readonly string[];
}

export const COMMAND_PREFERENCES = definePreference<CommandPreferences>({
  key: 'ptcgsim.commands.v1',
  defaults: Object.freeze({ recent: Object.freeze([]) }),
  parse: (value) => {
    const recent: unknown =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'recent')
        : undefined;
    return {
      recent: Array.isArray(recent)
        ? recent
            .filter((id): id is string => typeof id === 'string')
            .slice(0, RECENT_KEPT)
        : [],
    };
  },
});

/** Notes a command as just run: first, once, the oldest dropped. */
export const recordCommandRun = (
  id: string,
  store: PreferenceStore = preferences()
): void => {
  const { recent } = store.get(COMMAND_PREFERENCES);
  if (recent[0] === id) return;
  store.set(COMMAND_PREFERENCES, {
    recent: [id, ...recent.filter((known) => known !== id)].slice(
      0,
      RECENT_KEPT
    ),
  });
};
