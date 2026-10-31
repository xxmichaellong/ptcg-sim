/**
 * A card back is a short reference each viewer draws for itself (ADR-041),
 * never an outside image every opponent's browser would load. The field
 * that carries it keeps its old name, `cardBackUrl`, so stored rooms, saves
 * and replays keep loading; a value with none of the prefixes below is a
 * legacy URL (ADR-013), read as `url:`.
 *
 * - `preset:<id>`: a back shipped with the app (`standard`, its recolours).
 * - `design:1.<base>.<pattern>.<accent>.<emblem>`: a sleeve drawn from four
 *   values, each from a fixed list (no free text).
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
  'slate',
  'navy',
  'royal',
  'sky',
  'teal',
  'jade',
  'lime',
  'gold',
  'amber',
  'crimson',
  'rose',
  'violet',
  'plum',
  'snow',
  'sand',
] as const;
export type CardBackColour = (typeof CARD_BACK_COLOURS)[number];

export const CARD_BACK_PATTERNS = [
  'plain',
  'stripes',
  'checks',
  'dots',
  'waves',
  'rays',
  'diamonds',
  'scales',
] as const;
export type CardBackPattern = (typeof CARD_BACK_PATTERNS)[number];

export const CARD_BACK_EMBLEMS = [
  'none',
  'ball',
  'star',
  'bolt',
  'leaf',
  'flame',
  'drop',
  'moon',
] as const;
export type CardBackEmblem = (typeof CARD_BACK_EMBLEMS)[number];

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
    emblem: oneOf(CARD_BACK_EMBLEMS, emblem),
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
