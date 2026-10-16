import type { CatalogCard, LoadedCatalog } from './catalog.js';
import { foldText } from './card-query.js';
import { printId, type DeckCard } from './deck-list.js';
import {
  resolvePastedDecklistImageUrl,
  type PastedDecklistLanguage,
  type PastedDecklistRow,
} from './pasted-decklist.js';

/**
 * Between the catalog and decks: turning a catalogued printing into a deck
 * card, and finding the printing a decklist line means.
 */

/** Pokémon TCG Live's promo codes, as Limitless (and the catalog) write them. */
const SET_ALIASES: Readonly<Record<string, string>> = {
  'PR-SV': 'SVP',
  'PR-SW': 'SP',
  'PR-SM': 'SMP',
  'PR-XY': 'XYP',
  'PR-BLW': 'BWP',
  'PR-HS': 'HSP',
  'PR-DPP': 'DPP',
  'PR-NP': 'NP',
  SMA: 'HIF',
  EP: 'EPO',
};

const canonicalSet = (code: string): string => {
  const upper = code.trim().toUpperCase();
  return SET_ALIASES[upper] ?? upper;
};

/** "TG01" and "TG1", "005" and "5" are the same collector number. */
const canonicalNumber = (number: string): string =>
  number
    .trim()
    .toUpperCase()
    .replaceAll(/(^|\D)0+(?=\d)/gu, '$1');

/** The key a printing is looked up by, whatever spelling a list uses. */
export const printKey = (set: string, number: string): string =>
  `${canonicalSet(set)} ${canonicalNumber(number)}`;

export interface DeckCardOptions {
  /** Card images in this language where the printing has them (Limitless). */
  readonly language?: PastedDecklistLanguage;
  /** Finds the card's evolution line through cards the deck may not hold. */
  readonly catalog?: LoadedCatalog;
}

/** The Basic Pokémon a card's evolution line starts from, by the catalog. */
export const evolutionLineOf = (
  catalog: LoadedCatalog,
  card: Pick<CatalogCard, 'name' | 'evolvesFrom'>
): string | undefined => {
  if (!card.evolvesFrom) return undefined;
  const index = catalogIndex(catalog);
  let root = card.evolvesFrom;
  for (let step = 0; step < 4; step += 1) {
    const parent = index.byName
      .get(foldText(root))
      ?.find((print) => print.evolvesFrom)?.evolvesFrom;
    if (!parent || parent === root) break;
    root = parent;
  }
  return root;
};

/** A deck card for a catalogued printing, with the facts the rules check. */
export const deckCardFromCatalog = (
  card: CatalogCard,
  options: DeckCardOptions = {}
): DeckCard => {
  const localized =
    options.language && options.language !== 'English' && card.set.code
      ? resolvePastedDecklistImageUrl(
          { name: card.name, setCode: card.set.code, number: card.number },
          { language: options.language }
        )
      : undefined;
  const line = options.catalog
    ? evolutionLineOf(options.catalog, card)
    : undefined;
  const tags = card.tags.filter((tag) =>
    ['ACE SPEC', 'Radiant', 'Prism Star', 'Star'].includes(tag)
  );
  return Object.freeze({
    id: card.id,
    name: card.name,
    category: card.category,
    image: localized ?? card.image,
    imageSmall: localized ?? card.imageSmall,
    ...(card.set.code ? { set: card.set.code } : {}),
    number: card.number,
    setName: card.set.name,
    released: card.set.released,
    facts: Object.freeze({
      ...(card.stage ? { stage: card.stage } : {}),
      ...(card.evolvesFrom ? { evolvesFrom: card.evolvesFrom } : {}),
      ...(line ? { line } : {}),
      ...(tags.length > 0 ? { tags: Object.freeze(tags) } : {}),
      ...(card.trainerType ? { trainerType: card.trainerType } : {}),
      ...(card.energyType ? { energyType: card.energyType } : {}),
      ...(card.regulationMark ? { regulationMark: card.regulationMark } : {}),
      legal: Object.freeze({ ...card.legal }),
      ...(card.set.pocket ? { pocket: true } : {}),
    }),
  });
};

/** How a decklist line found its printing. */
export type DecklistMatch =
  /** Its set and number. */
  | 'print'
  /** Its name, in the set it gave (the set numbers its cards differently). */
  | 'name_in_set'
  /** Basic Energy, by name. */
  | 'energy'
  /** Its name alone: the newest ordinary printing, maybe not the one meant. */
  | 'name';

export interface ResolvedDecklistRow {
  readonly row: PastedDecklistRow;
  readonly card?: CatalogCard;
  readonly match?: DecklistMatch;
}

export interface CatalogIndex {
  readonly byPrint: ReadonlyMap<string, CatalogCard>;
  readonly byName: ReadonlyMap<string, readonly CatalogCard[]>;
}

const indexes = new WeakMap<LoadedCatalog, CatalogIndex>();

/** Lookups for decklist lines, built once per catalog. */
export const catalogIndex = (catalog: LoadedCatalog): CatalogIndex => {
  let index = indexes.get(catalog);
  if (!index) {
    const byPrint = new Map<string, CatalogCard>();
    const byName = new Map<string, CatalogCard[]>();
    for (const card of catalog.cards) {
      const key = printKey(card.set.code ?? card.set.id, card.number);
      if (!byPrint.has(key)) byPrint.set(key, card);
      const name = foldText(card.name);
      const named = byName.get(name);
      if (named) named.push(card);
      else byName.set(name, [card]);
    }
    index = { byPrint, byName };
    indexes.set(catalog, index);
  }
  return index;
};

/** "Fire Energy", "Basic Fire Energy", and PTCGO's "Basic {R} Energy Energy". */
const ENERGY_NAME =
  /^(?:basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dark|[grwlpfdmy]) energy(?: energy)?(?: null)?$/u;

const ENERGY_SYMBOLS: Readonly<Record<string, string>> = {
  g: 'grass',
  r: 'fire',
  w: 'water',
  l: 'lightning',
  p: 'psychic',
  f: 'fighting',
  d: 'darkness',
  m: 'metal',
  y: 'fairy',
  dark: 'darkness',
};

const isOrdinary = (card: CatalogCard): boolean =>
  card.set.official === undefined ||
  !/^\d+$/u.test(card.number) ||
  Number(card.number) <= card.set.official;

/** Newest ordinary printing first, then newest of any kind. */
const preferred = (cards: readonly CatalogCard[]): CatalogCard | undefined =>
  [...cards].sort(
    (left, right) =>
      Number(isOrdinary(right)) - Number(isOrdinary(left)) ||
      right.set.released.localeCompare(left.set.released)
  )[0];

/** Finds the printing a pasted line names, as closely as the line allows. */
export const resolveDecklistRow = (
  index: CatalogIndex,
  row: PastedDecklistRow
): ResolvedDecklistRow => {
  if (row.setCode && row.number) {
    const card = index.byPrint.get(printKey(row.setCode, row.number));
    if (card && foldText(card.name) === foldText(row.name)) {
      return { row, card, match: 'print' };
    }
  }
  const name = foldText(row.name);
  const named = index.byName.get(name) ?? [];
  if (row.setCode && named.length > 0) {
    const set = canonicalSet(row.setCode);
    const inSet = named.filter((card) => card.set.code === set);
    const card = preferred(inSet);
    if (card) return { row, card, match: 'name_in_set' };
  }
  const energy = ENERGY_NAME.exec(name);
  if (energy) {
    const type = ENERGY_SYMBOLS[energy[1]!] ?? energy[1];
    const basics = (index.byName.get(`${type} energy`) ?? []).filter(
      (card) => card.energyType === 'Basic' && !card.set.pocket
    );
    const card = preferred(basics);
    if (card) return { row, card, match: 'energy' };
  }
  const card = preferred(named.filter((candidate) => !candidate.set.pocket));
  return card ? { row, card, match: 'name' } : { row };
};

/**
 * The printing a card image shows, read from the image's address: Limitless
 * scans (`…/tpci/PAL/PAL_185_R_EN.png`) and TCGdex assets
 * (`…/en/sv/sv02/185/high.webp`). Lets decks saved before the catalog --
 * which kept only names and images -- find their cards again.
 */
export const printFromImageUrl = (
  url: string
):
  | { readonly set?: string; readonly setId?: string; readonly number: string }
  | undefined => {
  const limitless =
    /\/tpci\/([A-Z0-9-]+)\/[A-Z0-9-]+_([A-Z]*\d+[a-zA-Z]?)_R_[A-Z]{2}/u.exec(
      url
    );
  if (limitless) return { set: limitless[1]!, number: limitless[2]! };
  const tcgdex =
    /assets\.tcgdex\.net\/[a-z]{2}\/[^/]+\/([^/]+)\/([^/]+?)(?:\/(?:high|low)\.\w+)?$/u.exec(
      url
    );
  if (tcgdex) return { setId: tcgdex[1]!, number: tcgdex[2]! };
  return undefined;
};

/** Finds a catalogued printing for a deck card that has none recorded. */
export const findCatalogPrint = (
  catalog: LoadedCatalog,
  card: Pick<DeckCard, 'name' | 'set' | 'number' | 'image'>
): CatalogCard | undefined => {
  const index = catalogIndex(catalog);
  const named = (candidate: CatalogCard | undefined) =>
    candidate && foldText(candidate.name) === foldText(card.name)
      ? candidate
      : undefined;
  if (card.set && card.number) {
    const found = named(index.byPrint.get(printKey(card.set, card.number)));
    if (found) return found;
  }
  const fromImage = printFromImageUrl(card.image);
  if (fromImage?.set) {
    return named(index.byPrint.get(printKey(fromImage.set, fromImage.number)));
  }
  if (fromImage?.setId) {
    const number = canonicalNumber(fromImage.number);
    return named(
      catalog.cards.find(
        (candidate) =>
          candidate.set.id === fromImage.setId &&
          canonicalNumber(candidate.number) === number
      )
    );
  }
  return undefined;
};

/** Lists already brought up to a catalog, so a second look costs nothing. */
const reconciled = new WeakMap<object, LoadedCatalog>();

const sameFacts = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * A deck with its cards' facts as the catalog has them now: added where a
 * card has none (imported while the catalog was away, or from a v1 file),
 * and updated where they changed (a rotation, a ban, a legal reprint).
 * Everything the table shows is kept as it was, and a card made by hand is
 * left alone. The same list back when nothing changed.
 */
export const withCatalogFacts = (
  list: readonly { readonly card: DeckCard; readonly count: number }[],
  catalog: LoadedCatalog
): readonly { readonly card: DeckCard; readonly count: number }[] => {
  if (reconciled.get(list) === catalog) return list;
  let changed = false;
  const next = list.map((entry) => {
    const { card } = entry;
    if (card.presentation !== undefined) return entry;
    const print = findCatalogPrint(catalog, card);
    if (!print) return entry;
    const {
      image: _image,
      imageSmall: _imageSmall,
      ...found
    } = deckCardFromCatalog(print, { catalog });
    if (card.facts && sameFacts(card.facts, found.facts)) return entry;
    changed = true;
    return Object.freeze({
      count: entry.count,
      card: Object.freeze(
        card.facts
          ? { ...card, facts: found.facts }
          : {
              ...found,
              id: card.id,
              name: card.name,
              image: card.image,
              ...(card.imageSmall ? { imageSmall: card.imageSmall } : {}),
            }
      ),
    });
  });
  const result = changed ? Object.freeze(next) : list;
  reconciled.set(result, catalog);
  return result;
};

/** A printing's id for a deck card made from a list line (no catalog). */
export const lineCardId = (row: PastedDecklistRow): string | undefined =>
  row.setCode && row.number
    ? printId(canonicalSet(row.setCode), canonicalNumber(row.number))
    : undefined;
