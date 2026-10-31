/**
 * Card images in the viewer's own language. A scan from TCGdex or from
 * Limitless's international prints names its language in its address, so
 * the same card in French is the same address with `fr` (or `FR`) in place
 * of `en`. A deck keeps the address it was built with, which both players'
 * tables share; each player's page asks for their own language's scan and
 * falls back to that address where none exists.
 *
 * Six languages print the international cards these sources carry. Japanese
 * prints (Limitless `tpc`), TCG Pocket, older pokemontcg.io scans, uploads
 * and card backs have no translated counterpart and are left as they are.
 */
export const CARD_IMAGE_LANGUAGES = [
  'en',
  'fr',
  'de',
  'it',
  'es',
  'pt',
] as const;

export type CardImageLanguage = (typeof CARD_IMAGE_LANGUAGES)[number];

export const isCardImageLanguage = (
  value: unknown
): value is CardImageLanguage =>
  typeof value === 'string' &&
  (CARD_IMAGE_LANGUAGES as readonly string[]).includes(value);

/** `https://assets.tcgdex.net/{language}/{serie}/{set}/{number}/…` */
const TCGDEX =
  /^(https:\/\/assets\.tcgdex\.net\/)(en|fr|de|it|es|pt)(\/[^?#]+)$/u;

/**
 * Limitless's international scans, `…/tpci/{set}/{set}_{number}_R_{XX}.png`
 * on either host, with or without a size (`_LG`, `_SM`, `_XS`).
 */
const LIMITLESS =
  /^https:\/\/limitlesstcg\.nyc3\.(?:cdn\.)?digitaloceanspaces\.com\/tpci\/([^?#]+_R_)(EN|FR|DE|IT|PT|ES)(?:_(LG|SM|XS))?\.png$/u;

const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';

/**
 * The address of the same scan in `language`, or `url` itself when it is
 * already in that language or names none. A Limitless scan in another
 * language comes from its CDN, at the size asked for: large when none was
 * (the size-less originals are four times the size).
 */
export const localizeCardImageUrl = (
  url: string,
  language: CardImageLanguage
): string => {
  const tcgdex = TCGDEX.exec(url);
  if (tcgdex)
    return tcgdex[2] === language ? url : `${tcgdex[1]}${language}${tcgdex[3]}`;
  const limitless = LIMITLESS.exec(url);
  if (limitless) {
    const code = language.toUpperCase();
    if (limitless[2] === code) return url;
    return `${LIMITLESS_CDN}/tpci/${limitless[1]}${code}_${limitless[3] ?? 'LG'}.png`;
  }
  return url;
};

/**
 * What to ask for to show `url` in `language`: the translated scan, with
 * the deck's own address to fall back to when the translation is missing
 * (older sets were never printed in every language). No fallback when the
 * address has no other language.
 */
export const cardImageInLanguage = (
  url: string,
  language: CardImageLanguage
): { readonly url: string; readonly fallbackUrl?: string } => {
  const localized = localizeCardImageUrl(url, language);
  return localized === url ? { url } : { url: localized, fallbackUrl: url };
};

/**
 * Every address to try for a card image, best first and without repeats:
 * `url` and then `alternate` (another source's scan of the printing), each
 * in `language` before as given.
 */
export const cardImageCandidates = (
  url: string,
  alternate: string | undefined,
  language: CardImageLanguage
): readonly string[] => {
  const candidates = [
    localizeCardImageUrl(url, language),
    ...(alternate ? [localizeCardImageUrl(alternate, language)] : []),
    url,
    ...(alternate ? [alternate] : []),
  ];
  return candidates.filter(
    (candidate, index) => candidates.indexOf(candidate) === index
  );
};
