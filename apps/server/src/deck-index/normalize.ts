/**
 * How the deck index reads names: archetypes ("Gardevoir ex", "N's
 * Zoroark") and tournaments are matched the way a player types them --
 * case, accents and apostrophes don't matter, and the words that only say
 * which kind of Pokémon a deck is built on (ex, V, VSTAR, VMAX, GX, Mega)
 * may be left out.
 */

/** Words a search may omit: "Gardevoir" finds "Gardevoir ex". */
export const OPTIONAL_WORDS: ReadonlySet<string> = new Set([
  'ex',
  'v',
  'vstar',
  'vmax',
  'gx',
  'mega',
]);

/** At most this many words of a search are matched. */
const MAXIMUM_TERMS = 8;

/**
 * Lowercase, without accents or apostrophes, every other non-letter and
 * non-digit a space: `N’s Zoroark` -> `ns zoroark`, `Pokémon` -> `pokemon`.
 */
export const normalizeName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’ʼ`´]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const nameWords = (value: string): readonly string[] => {
  const normalized = normalizeName(value);
  return normalized === '' ? [] : normalized.split(' ');
};

/**
 * The words of a search that must all match. The optional words are
 * dropped -- unless the search is nothing but optional words ("ex"), which
 * then must match as typed.
 */
export const searchTerms = (query: string): readonly string[] => {
  const words = nameWords(query).slice(0, MAXIMUM_TERMS);
  const required = words.filter((word) => !OPTIONAL_WORDS.has(word));
  return required.length > 0 ? required : words;
};

/**
 * An FTS5 query: every term must match a word's start (`charz` finds
 * Charizard). Terms are letters and digits only, so quoting them is safe;
 * null when there is nothing to search for.
 */
export const ftsQuery = (terms: readonly string[]): string | null =>
  terms.length === 0 ? null : terms.map((term) => `"${term}"*`).join(' ');

/**
 * What an archetype is found by: its name, the words of its id
 * (`mega-charizard-x-ex`), and the Pokémon its icons show.
 */
export const archetypeSearchText = (archetype: {
  readonly id: string;
  readonly name: string;
  readonly icons: readonly string[];
}): string =>
  [
    normalizeName(archetype.name),
    normalizeName(archetype.id.replaceAll('-', ' ')),
    ...archetype.icons.map((icon) => normalizeName(icon.replaceAll('-', ' '))),
  ]
    .filter((part) => part !== '')
    .join(' ');

/** A name without its optional words, for telling an exact match apart. */
export const coreName = (value: string): string =>
  nameWords(value)
    .filter((word) => !OPTIONAL_WORDS.has(word))
    .join(' ');
