import { i18n, type Messages } from '@lingui/core';

import { messages as englishMessages } from '../locales/en.json?lingui';
import {
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { LANGUAGE_PREFERENCES } from './language-preference.js';
import {
  browserLocale,
  SOURCE_LOCALE,
  textDirection,
  type Locale,
} from './locales.js';

/**
 * The page's language (ADR-034). English is compiled into the page and
 * active from the first line of code that runs, so a message can never be
 * asked for before a language is set; any other language's catalog is
 * fetched when chosen, and English stays up until it arrives.
 */
i18n.loadAndActivate({ locale: SOURCE_LOCALE, messages: englishMessages });

type CompiledCatalog = { readonly messages: Messages };

/**
 * Each language's compiled catalog, fetched when chosen. The `?lingui`
 * suffix routes the JSON catalog through the Lingui Vite plugin, which
 * compiles it and fills what it lacks from English; a plain import would
 * give the raw source catalog. Spelled out one by one: the boundary check
 * admits no computed import.
 */
const CATALOGS: Readonly<
  Record<Exclude<Locale, typeof SOURCE_LOCALE>, () => Promise<CompiledCatalog>>
> = {
  es: () => import('../locales/es.json?lingui'),
  pt: () => import('../locales/pt.json?lingui'),
  de: () => import('../locales/de.json?lingui'),
  fr: () => import('../locales/fr.json?lingui'),
  it: () => import('../locales/it.json?lingui'),
  nl: () => import('../locales/nl.json?lingui'),
  pl: () => import('../locales/pl.json?lingui'),
  sv: () => import('../locales/sv.json?lingui'),
  tr: () => import('../locales/tr.json?lingui'),
  ru: () => import('../locales/ru.json?lingui'),
  sr: () => import('../locales/sr.json?lingui'),
  ar: () => import('../locales/ar.json?lingui'),
  ja: () => import('../locales/ja.json?lingui'),
  zh: () => import('../locales/zh.json?lingui'),
  ko: () => import('../locales/ko.json?lingui'),
  th: () => import('../locales/th.json?lingui'),
  vi: () => import('../locales/vi.json?lingui'),
  id: () => import('../locales/id.json?lingui'),
  fil: () => import('../locales/fil.json?lingui'),
};

const loadCatalog = async (locale: Locale): Promise<Messages> =>
  locale === SOURCE_LOCALE
    ? englishMessages
    : (await CATALOGS[locale]()).messages;

/** The language the saved choice resolves to on this browser. */
export const chosenLocale = (
  store: PreferenceStore = preferences()
): Locale => {
  const { language } = store.get(LANGUAGE_PREFERENCES);
  return language === 'auto' ? browserLocale() : language;
};

let requested = 0;

/**
 * Loads and activates a language. Only the latest request activates, so a
 * slow catalog never replaces one chosen after it. A catalog that fails to
 * load leaves the current language up.
 */
export const activateLocale = async (locale: Locale): Promise<void> => {
  requested += 1;
  const request = requested;
  try {
    const messages = await loadCatalog(locale);
    if (request !== requested) return;
    if (i18n.locale !== locale || i18n.messages !== messages)
      i18n.loadAndActivate({ locale, messages });
    document.documentElement.lang = locale;
    document.documentElement.dir = textDirection(locale);
  } catch (error) {
    console.error(`The ${locale} catalog did not load`, error);
  }
};

let started: Promise<void> | null = null;

/**
 * Activates the saved language and follows the choice from then on (this
 * tab's Settings, or another tab's). Called once before the first render,
 * so a page in another language never flashes English; later calls return
 * the same promise.
 */
export const startLocalization = (
  store: PreferenceStore = preferences()
): Promise<void> => {
  if (!started) {
    store.subscribe(LANGUAGE_PREFERENCES, () => {
      void activateLocale(chosenLocale(store));
    });
    started = activateLocale(chosenLocale(store));
  }
  return started;
};
