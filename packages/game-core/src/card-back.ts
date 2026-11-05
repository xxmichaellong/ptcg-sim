/**
 * A card back is a short reference each viewer draws for itself (ADR-041),
 * never an outside image every opponent's browser would load. The field
 * that carries it keeps its old name, `cardBackUrl`, so stored rooms, saves
 * and replays keep loading; a value with none of the prefixes below is a
 * legacy URL (ADR-013), read as `url:`.
 *
 * - `preset:<id>`: a back shipped with the app (`standard`, `black`, its
 *   recolors).
 * - `design:1.<base>.<pattern>.<accent>.<emblem>`: a sleeve drawn from four
 *   values, each from a fixed list or range (no free text).
 * - `img:<sha256>`: an image in the app's own store.
 * - `url:<https URL>`: a legacy URL, which no viewer loads on the table.
 */

/** The longest reference but a legacy URL. */
export const CARD_BACK_REFERENCE_MAX = 128;
/**
 * The longest value at all: a legacy URL's bound, `MAX_IMAGE_URL_CODE_UNITS`
 * (ADR-013). Kept here so the web bundle takes this module alone.
 */
export const CARD_BACK_VALUE_MAX = 4_096;

export const STANDARD_CARD_BACK_ID = 'standard';
export const STANDARD_CARD_BACK = `preset:${STANDARD_CARD_BACK_ID}`;
/** The shipped back's path before references: the standard back. */
export const LEGACY_DEFAULT_CARD_BACK_URL = '/v2/assets/cardback.png';

export const CARD_BACK_COLOURS = [
  'ink',
  'charcoal',
  'slate',
  'stone',
  'navy',
  'denim',
  'royal',
  'sky',
  'ocean',
  'teal',
  'mint',
  'jade',
  'forest',
  'sage',
  'olive',
  'lime',
  'gold',
  'amber',
  'peach',
  'rust',
  'coral',
  'crimson',
  'wine',
  'rose',
  'mauve',
  'violet',
  'lavender',
  'plum',
  'cocoa',
  'sand',
  'cream',
  'snow',
] as const;
export type CardBackColour = (typeof CARD_BACK_COLOURS)[number];

export const CARD_BACK_PATTERNS = [
  'plain',
  'stripes',
  'pinstripes',
  'checks',
  'grid',
  'plaid',
  'dots',
  'halftone',
  'waves',
  'swirl',
  'rays',
  'diamonds',
  'chevrons',
  'hexagons',
  'scales',
  'crosshatch',
] as const;
export type CardBackPattern = (typeof CARD_BACK_PATTERNS)[number];

/**
 * The emblem at a sleeve's middle is real Pokémon iconography (ADR-041 §6):
 * a Pokémon by its National Pokédex number (`pokemon-25`), a Poké Ball
 * (`ball-great`), an Energy type (`energy-fire`), or none.
 */
export const CARD_BACK_POKEMON_COUNT = 1025;
export const CARD_BACK_BALLS = [
  'poke',
  'great',
  'ultra',
  'master',
  'premier',
  'luxury',
  'dusk',
  'heal',
  'quick',
  'timer',
  'repeat',
  'nest',
  'net',
  'dive',
  'safari',
] as const;
export const CARD_BACK_ENERGY = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'fairy',
  'dragon',
  'colorless',
] as const;
/**
 * The first designer's drawn emblems, kept in designs already made: each
 * now draws as the real one it stood for.
 */
export const CARD_BACK_LEGACY_EMBLEMS: Readonly<Record<string, string>> =
  Object.freeze({
    ball: 'ball-poke',
    star: 'energy-colorless',
    bolt: 'energy-lightning',
    leaf: 'energy-grass',
    flame: 'energy-fire',
    drop: 'energy-water',
    moon: 'energy-darkness',
  });
/** A design's emblem: `none`, or one of the lists above. */
export type CardBackEmblem = string;

const POKEMON_EMBLEM = /^pokemon-([1-9][0-9]{0,3})$/u;

/** Whether a value names an emblem a design may carry. */
export const isCardBackEmblem = (value: string): boolean => {
  if (value === 'none' || Object.hasOwn(CARD_BACK_LEGACY_EMBLEMS, value))
    return true;
  const pokemon = POKEMON_EMBLEM.exec(value);
  if (pokemon) return Number(pokemon[1]) <= CARD_BACK_POKEMON_COUNT;
  if (value.startsWith('ball-'))
    return (CARD_BACK_BALLS as readonly string[]).includes(value.slice(5));
  if (value.startsWith('energy-'))
    return (CARD_BACK_ENERGY as readonly string[]).includes(value.slice(7));
  return false;
};

/** An emblem as it draws: a first-designer emblem as the real one it meant. */
export const canonicalCardBackEmblem = (emblem: CardBackEmblem): string =>
  CARD_BACK_LEGACY_EMBLEMS[emblem] ?? emblem;

/** The sleeve designer's four values. */
export interface CardBackDesign {
  readonly base: CardBackColour;
  readonly pattern: CardBackPattern;
  readonly accent: CardBackColour;
  readonly emblem: CardBackEmblem;
}

export type CardBack =
  | { readonly kind: 'preset'; readonly id: string }
  | { readonly kind: 'design'; readonly design: CardBackDesign }
  | { readonly kind: 'image'; readonly sha256: string }
  | { readonly kind: 'url'; readonly url: string };

const DESIGN_VERSION = '1';
const PRESET_ID = /^[a-z0-9-]{1,32}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const oneOf = <T extends string>(
  list: readonly T[],
  value: string | undefined
): T | undefined =>
  value !== undefined && (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

const parseDesign = (params: string): CardBackDesign | null => {
  const [version, base, pattern, accent, emblem, ...rest] = params.split('.');
  if (version !== DESIGN_VERSION || rest.length > 0) return null;
  const design = {
    base: oneOf(CARD_BACK_COLOURS, base),
    pattern: oneOf(CARD_BACK_PATTERNS, pattern),
    accent: oneOf(CARD_BACK_COLOURS, accent),
    emblem:
      emblem !== undefined && isCardBackEmblem(emblem) ? emblem : undefined,
  };
  return design.base && design.pattern && design.accent && design.emblem
    ? (design as CardBackDesign)
    : null;
};

/**
 * What a stored value is: null for one that is empty, too long, or names a
 * kind with a malformed body (the room refuses those).
 */
export const parseCardBack = (value: string): CardBack | null => {
  if (value.length < 1 || value.length > CARD_BACK_VALUE_MAX) return null;
  const colon = value.indexOf(':');
  const prefix = colon > 0 ? value.slice(0, colon) : '';
  const body = value.slice(colon + 1);
  switch (prefix) {
    case 'preset':
      return value.length <= CARD_BACK_REFERENCE_MAX && PRESET_ID.test(body)
        ? { kind: 'preset', id: body }
        : null;
    case 'design': {
      if (value.length > CARD_BACK_REFERENCE_MAX) return null;
      const design = parseDesign(body);
      return design ? { kind: 'design', design } : null;
    }
    case 'img':
      return SHA256_HEX.test(body) ? { kind: 'image', sha256: body } : null;
    case 'url':
      return /^https:\/\/\S+$/u.test(body) ? { kind: 'url', url: body } : null;
    default:
      // Before references: the shipped back's path, or a pasted URL.
      return value === LEGACY_DEFAULT_CARD_BACK_URL
        ? { kind: 'preset', id: STANDARD_CARD_BACK_ID }
        : { kind: 'url', url: value };
  }
};

/** Whether a value may stand as a card back (commands, events, state). */
export const isCardBackValue = (value: unknown): value is string =>
  typeof value === 'string' && parseCardBack(value) !== null;

/** The reference a back is written as. */
export const cardBackReference = (back: CardBack): string => {
  switch (back.kind) {
    case 'preset':
      return `preset:${back.id}`;
    case 'design': {
      const { base, pattern, accent, emblem } = back.design;
      return `design:${DESIGN_VERSION}.${base}.${pattern}.${accent}.${emblem}`;
    }
    case 'image':
      return `img:${back.sha256}`;
    case 'url':
      return `url:${back.url}`;
  }
};

/** Whether a value is the standard back, in either of its spellings. */
export const isStandardCardBack = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  const back = parseCardBack(value);
  return back?.kind === 'preset' && back.id === STANDARD_CARD_BACK_ID;
};
