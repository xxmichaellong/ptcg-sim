/**
 * The languages the app is offered in, each named in itself. English is the
 * source: every message is written in it, and a language missing a message
 * shows the English one. Adding a language means adding it here and running
 * the translate script (scripts/translate.ts) for it.
 */
export const LOCALES = [
  { locale: 'en', name: 'English' },
  { locale: 'es', name: 'Español' },
  { locale: 'pt', name: 'Português' },
  { locale: 'de', name: 'Deutsch' },
  { locale: 'fr', name: 'Français' },
  { locale: 'it', name: 'Italiano' },
  { locale: 'nl', name: 'Nederlands' },
  { locale: 'pl', name: 'Polski' },
  { locale: 'sv', name: 'Svenska' },
  { locale: 'tr', name: 'Türkçe' },
  { locale: 'ru', name: 'Русский' },
  { locale: 'sr', name: 'Српски' },
  { locale: 'ar', name: 'العربية' },
  { locale: 'ja', name: '日本語' },
  { locale: 'zh', name: '简体中文' },
  { locale: 'ko', name: '한국어' },
  { locale: 'th', name: 'ไทย' },
  { locale: 'vi', name: 'Tiếng Việt' },
  { locale: 'id', name: 'Bahasa Indonesia' },
  { locale: 'fil', name: 'Filipino' },
] as const;

export type Locale = (typeof LOCALES)[number]['locale'];

export const SOURCE_LOCALE = 'en' satisfies Locale;

const SUPPORTED: ReadonlySet<string> = new Set(
  LOCALES.map(({ locale }) => locale)
);

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && SUPPORTED.has(value);

/** The languages written right to left. */
const RIGHT_TO_LEFT: ReadonlySet<string> = new Set<Locale>(['ar']);

/**
 * Which way a language is written. The page's chrome follows it; the table
 * never does (ADR-034).
 */
export const textDirection = (locale: string): 'ltr' | 'rtl' =>
  RIGHT_TO_LEFT.has(locale) ? 'rtl' : 'ltr';

/** Tags whose language subtag is not the one the app uses for them. */
const ALIASES: Readonly<Record<string, Locale>> = {
  tl: 'fil',
  in: 'id',
};

/**
 * The supported language a BCP 47 tag asks for, by its language subtag:
 * `pt-BR` is Português, `zh-TW` is 简体中文 (the one Chinese offered),
 * `sr-Latn` is Српски. Undefined for a language the app is not offered in.
 */
export const localeForTag = (tag: string): Locale | undefined => {
  const language = tag.trim().toLowerCase().split(/[-_]/u)[0] ?? '';
  const locale = ALIASES[language] ?? language;
  return isLocale(locale) ? locale : undefined;
};

/** The first of the browser's languages the app is offered in, else English. */
export const browserLocale = (
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language]
): Locale => {
  for (const tag of languages) {
    const locale = tag ? localeForTag(tag) : undefined;
    if (locale) return locale;
  }
  return SOURCE_LOCALE;
};
