import {
  cardImageCandidates,
  cardImageInLanguage,
  isCardImageLanguage,
  type CardImageLanguage,
} from '@ptcgsim/deck-core';
import type { BoardScene } from '@ptcgsim/renderer-contract';

import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { LANGUAGE_PREFERENCES } from './language-preference.js';
import { browserLocale } from './locales.js';

/**
 * The language card images are shown in, on this device: the page's own
 * when cards are printed in it, else English, until the player picks one.
 * Only what this player sees changes: a deck keeps the scans it was built
 * with, and the other player sees the cards in their own choice.
 */
export type CardImageChoice = 'app' | CardImageLanguage;

export interface CardImagePreferences {
  readonly cardImages: CardImageChoice;
}

export const CARD_IMAGE_PREFERENCES = definePreference<CardImagePreferences>({
  key: 'ptcgsim.card-images.v1',
  defaults: Object.freeze({ cardImages: 'app' }),
  parse: (value) => {
    const cardImages =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'cardImages')
        : undefined;
    return {
      cardImages: isCardImageLanguage(cardImages) ? cardImages : 'app',
    };
  },
});

/** Each language cards are printed in, named in itself. */
export const CARD_IMAGE_LANGUAGE_NAMES: Readonly<
  Record<CardImageLanguage, string>
> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
};

/** What a choice comes to with the page in `locale`. */
export const cardImageLanguageFor = (
  choice: CardImageChoice,
  locale: string
): CardImageLanguage =>
  choice !== 'app' ? choice : isCardImageLanguage(locale) ? locale : 'en';

const pageLocale = (store: PreferenceStore): string => {
  const { language } = store.get(LANGUAGE_PREFERENCES);
  return language === 'auto' ? browserLocale() : language;
};

/** The language this device shows card images in, now. */
export const cardImageLanguage = (
  store: PreferenceStore = preferences()
): CardImageLanguage =>
  cardImageLanguageFor(
    store.get(CARD_IMAGE_PREFERENCES).cardImages,
    pageLocale(store)
  );

/** The same, kept current in a component. */
export const useCardImageLanguage = (): CardImageLanguage => {
  const { cardImages } = usePreference(CARD_IMAGE_PREFERENCES);
  const { language } = usePreference(LANGUAGE_PREFERENCES);
  return cardImageLanguageFor(
    cardImages,
    language === 'auto' ? browserLocale() : language
  );
};

/**
 * Translated scans that did not load this visit (older sets were never
 * printed in every language): a card asked for again goes straight to its
 * deck's own scan. Bounded, oldest forgotten first.
 */
const failedImages = new Set<string>();
const KEPT_FAILURES = 1_000;

export const noteCardImageFailure = (url: string): void => {
  failedImages.delete(url);
  failedImages.add(url);
  for (const stale of failedImages) {
    if (failedImages.size <= KEPT_FAILURES) break;
    failedImages.delete(stale);
  }
};

/** Forgets every failure noted (tests). */
export const forgetCardImageFailures = (): void => {
  failedImages.clear();
};

/**
 * What to ask for to show the card image at `url` in `language`, and what
 * to fall back to: its deck's own scan, unless the translation already
 * failed this visit.
 */
export const localizedCardImage = (
  url: string,
  language: CardImageLanguage = cardImageLanguage()
): { readonly url: string; readonly fallbackUrl?: string } => {
  const shown = cardImageInLanguage(url, language);
  return shown.fallbackUrl !== undefined && failedImages.has(shown.url)
    ? { url }
    : shown;
};

/** Every address to try for a card image, in order (see cardImageCandidates). */
export const cardImageAddresses = (
  url: string,
  alternate: string | undefined,
  language: CardImageLanguage
): readonly string[] =>
  cardImageCandidates(url, alternate, language).filter(
    (candidate, index, all) =>
      index === all.length - 1 || !failedImages.has(candidate)
  );

/** The table's cards, faces asked for in `language`. */
export const localizeSceneCardImages = (
  scene: BoardScene,
  language: CardImageLanguage = cardImageLanguage()
): BoardScene => {
  let changed = false;
  const cards = scene.cards.map((card) => {
    if (card.concealed) return card;
    const shown = localizedCardImage(card.imageUrl, language);
    if (shown.url === card.imageUrl) return card;
    changed = true;
    return {
      ...card,
      imageUrl: shown.url,
      ...(shown.fallbackUrl ? { imageFallbackUrl: shown.fallbackUrl } : {}),
    };
  });
  return changed ? { ...scene, cards } : scene;
};

const RETRY_MARKER = /[?&]ptcgsim-retry=\d+$/u;

/**
 * Notes every card image on the page that fails to load, wherever it is
 * drawn (the table, its windows, the deck screen), so a translation that
 * does not exist is asked for once. Returns the cleanup.
 */
export const watchCardImageFailures = (
  target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document
): (() => void) => {
  const failed = (event: Event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const src = (image.getAttribute('src') ?? '').replace(RETRY_MARKER, '');
    if (src) noteCardImageFailure(src);
  };
  target.addEventListener('error', failed, true);
  return () => target.removeEventListener('error', failed, true);
};
