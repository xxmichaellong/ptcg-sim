import { definePreference } from '../preferences/preference-store.js';
import { isLocale, type Locale } from './locales.js';

/** `auto` follows the browser's languages; anything else is a choice. */
export type LanguageChoice = 'auto' | Locale;

export interface LanguagePreferences {
  readonly language: LanguageChoice;
}

export const LANGUAGE_PREFERENCES = definePreference<LanguagePreferences>({
  key: 'ptcgsim.language.v1',
  defaults: Object.freeze({ language: 'auto' }),
  parse: (value) => {
    const language =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'language')
        : undefined;
    return { language: isLocale(language) ? language : 'auto' };
  },
});
