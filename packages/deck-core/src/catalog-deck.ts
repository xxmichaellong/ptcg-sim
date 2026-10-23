import type { CatalogCard, LoadedCatalog } from './catalog.js';
import { foldText, trainerName } from './card-query.js';
import { catalogNumberOf, limitlessNumber } from './catalog-wire.js';
import { printId, type DeckCard } from './deck-list.js';
import { basicEnergyTypeOf } from './deck-rules.js';
import {
  isUnambiguousPocketCode,
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

/** Pokémon TCG API set ids (old lists' `hgss4-84`) TCGdex spells otherwise. */
const LEGACY_SET_IDS: Readonly<Record<string, string>> = { base6: 'lc' };

const tcgdexSetId = (setId: string): string => {
  const id = setId.trim().toLowerCase();
  return LEGACY_SET_IDS[id] ?? id;
};

const setIdKey = (setId: string, number: string): string =>
  `${tcgdexSetId(setId)} ${canonicalNumber(number)}`;

/**
 * "EX" (a Pokémon-EX) or "ex" (a Pokémon ex) closing a name: two different
 * Pokémon however a search folds them.
 */
const exMark = (name: string): 'EX' | 'ex' | undefined => {
  const mark = /[\s-](EX|ex)(?=\s|$)/u.exec(name.trim())?.[1];
  return mark === 'EX' || mark === 'ex' ? mark : undefined;
};

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

/**
 * Series Limitless has translated scans of: HeartGold & SoulSilver on (its
 * promos too). Not Diamond & Pearl, Platinum or older, McDonald's or the
 * trainer kits, nor TCG Pocket -- their cards keep the catalog's scan.
 * (Checked against Limitless, October 2026.)
 */
const TRANSLATED_SERIES = new Set([
  'HeartGold & SoulSilver',
  'Call of Legends',
  'Black & White',
  'XY',
  'Sun & Moon',
  'Sword & Shield',
  'Scarlet & Violet',
  'Mega Evolution',
]);

/**
 * How a card's facts are worked out from the catalog here (this function,
 * `decodeCatalog`, the reprint rules). Raised with any change to that, so a
 * deck saved with facts worked out before is brought up to date once.
 */
export const DECK_FACTS_VERSION = 1;

/** A deck card for a catalogued printing, with the facts the rules check. */
export const deckCardFromCatalog = (
  card: CatalogCard,
  options: DeckCardOptions = {}
): DeckCard => {
  const localized =
    options.language &&
    options.language !== 'English' &&
    card.set.code &&
    !card.set.pocket &&
    TRANSLATED_SERIES.has(card.set.series)
      ? resolvePastedDecklistImageUrl(
          {
            name: card.name,
            setCode: card.set.code,
            // Limitless names an alternate printing's scan in lower case.
            number: limitlessNumber(card.number),
          },
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
  /** By TCGdex set id and number, for old lists' `hgss4-84`. */
  readonly bySetId: ReadonlyMap<string, CatalogCard>;
  readonly byName: ReadonlyMap<string, readonly CatalogCard[]>;
}

const indexes = new WeakMap<LoadedCatalog, CatalogIndex>();

/** Lookups for decklist lines, built once per catalog. */
export const catalogIndex = (catalog: LoadedCatalog): CatalogIndex => {
  let index = indexes.get(catalog);
  if (!index) {
    const byPrint = new Map<string, CatalogCard>();
    const bySetId = new Map<string, CatalogCard>();
    const byName = new Map<string, CatalogCard[]>();
    for (const card of catalog.cards) {
      const key = printKey(card.set.code ?? card.set.id, card.number);
      if (!byPrint.has(key)) byPrint.set(key, card);
      const setKey = setIdKey(card.set.id, card.number);
      if (!bySetId.has(setKey)) bySetId.set(setKey, card);
      const names = new Set([foldText(card.name)]);
      // A Trainer is found by its name without a subtitle too.
      if (card.category === 'Trainer')
        names.add(foldText(trainerName(card.name)));
      for (const name of names) {
        const named = byName.get(name);
        if (named) named.push(card);
        else byName.set(name, [card]);
      }
    }
    index = { byPrint, bySetId, byName };
    indexes.set(catalog, index);
  }
  return index;
};

const isOrdinary = (card: CatalogCard): boolean =>
  card.set.official === undefined ||
  !/^\d+$/u.test(card.number) ||
  Number(card.number) <= card.set.official;

/**
 * The symbols in a name that make it another card, which a search's folding
 * drops: Nidoran♂ is not Nidoran♀, nor Celebi ☆ (or ★) Celebi, nor
 * Shaymin ◇ Shaymin.
 */
const nameMarks = (name: string): string =>
  [...name.replaceAll('★', '☆').matchAll(/[♂♀☆◇]/gu)]
    .map(([mark]) => mark)
    .sort()
    .join('');

/**
 * Whether a catalogued card goes by a name: a Trainer's subtitle aside, and
 * a Pokémon-EX never a Pokémon ex, nor one name's ♂, ♀, ☆ or ◇ another's.
 */
const goesBy = (card: CatalogCard, name: string): boolean =>
  nameMarks(card.name) === nameMarks(name) &&
  ((foldText(card.name) === foldText(name) &&
    (card.category !== 'Pokémon' || exMark(card.name) === exMark(name))) ||
    (card.category === 'Trainer' &&
      foldText(trainerName(card.name)) === foldText(trainerName(name))));

/**
 * Whether a list's name fits the card its id names: one's words within the
 * other's, since TCGdex and old lists spell some differently ("Pokegear" is
 * Pokégear 3.0, "Regigigas Lv.X" is TCGdex's Regigigas of that number, a δ
 * Pokémon goes without its δ). A wrong id ("Relicanth" on a Treecko) fails.
 */
const fitsId = (card: CatalogCard, name: string): boolean => {
  const words = (value: string) => new Set(foldText(value).split(' '));
  const listed = words(name);
  const catalogued = words(card.name);
  const within = (inner: Set<string>, outer: Set<string>) =>
    [...inner].every((word) => outer.has(word));
  return (
    (within(listed, catalogued) || within(catalogued, listed)) &&
    (card.category !== 'Pokémon' || exMark(card.name) === exMark(name))
  );
};

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
    if (card && goesBy(card, row.name)) {
      return { row, card, match: 'print' };
    }
  }
  // An old list's Pokémon TCG API id: `4 Yanma hgss4-84`.
  const separator = row.catalogId?.indexOf('-') ?? -1;
  if (row.catalogId && separator > 0) {
    // Promos by the number the catalog writes: `dpp-DP03` is DPP 3.
    const setId = tcgdexSetId(row.catalogId.slice(0, separator));
    const card = index.bySetId.get(
      setIdKey(
        setId,
        catalogNumberOf(setId, row.catalogId.slice(separator + 1))
      )
    );
    if (card && fitsId(card, row.name)) {
      return { row, card, match: 'print' };
    }
  }
  const name = foldText(row.name);
  const named = (index.byName.get(name) ?? []).filter((card) =>
    goesBy(card, row.name)
  );
  // A TCG Pocket line stays in Pocket, and any other line out of it: the
  // same name in the other game is another card.
  const pocket =
    row.setCode !== undefined && isUnambiguousPocketCode(row.setCode);
  // Its name as written first, while a symbol keeps its braces ("{R}
  // Energy"), then folded.
  const type = pocket
    ? undefined
    : (basicEnergyTypeOf(row.name) ?? basicEnergyTypeOf(name));
  if (type) {
    const basics = (index.byName.get(`${type} energy`) ?? []).filter(
      (card) => card.energyType === 'Basic' && !card.set.pocket
    );
    const card = preferred(basics);
    if (card) return { row, card, match: 'energy' };
  }
  const card = preferred(
    named.filter((candidate) => Boolean(candidate.set.pocket) === pocket)
  );
  return card ? { row, card, match: 'name' } : { row };
};

/**
 * The printing a card image shows, read from the image's address: Limitless
 * scans (`…/tpci/PAL/PAL_185_R_EN.png`), TCGdex assets
 * (`…/en/sv/sv02/185/high.webp`) and the Pokémon TCG API's scans v1 gave an
 * old list's ids (`…/hgss4/84_hires.png`). Lets decks saved before the catalog --
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
  // v1's scans for an old list's ids (`hgss4-84`): the Pokémon TCG API's.
  const legacy =
    /images\.pokemontcg\.io\/([a-z0-9.]+)\/([A-Za-z0-9]+?)(?:_hires)?\.png$/u.exec(
      url
    );
  if (legacy) return { setId: tcgdexSetId(legacy[1]!), number: legacy[2]! };
  return undefined;
};

/** Finds a catalogued printing for a deck card that has none recorded. */
export const findCatalogPrint = (
  catalog: LoadedCatalog,
  card: Pick<DeckCard, 'name' | 'set' | 'number' | 'image'>
): CatalogCard | undefined => {
  const index = catalogIndex(catalog);
  const named = (candidate: CatalogCard | undefined) =>
    candidate && goesBy(candidate, card.name) ? candidate : undefined;
  if (card.set && card.number) {
    const found = named(index.byPrint.get(printKey(card.set, card.number)));
    if (found) return found;
  }
  const fromImage = printFromImageUrl(card.image);
  if (fromImage?.set) {
    return named(index.byPrint.get(printKey(fromImage.set, fromImage.number)));
  }
  if (fromImage?.setId) {
    // TCGdex's own number for it ("SWSH022"), as the catalog writes it (22).
    return named(
      index.bySetId.get(
        setIdKey(
          fromImage.setId,
          catalogNumberOf(fromImage.setId, fromImage.number)
        )
      )
    );
  }
  return undefined;
};

/** Lists already brought up to a catalog, so a second look costs nothing. */
const reconciled = new WeakMap<object, LoadedCatalog>();

/**
 * The same facts, whatever order their keys were written in: a deck read
 * back from storage writes them in its own, and seen as changed it would be
 * upgraded and saved again on every load, and between two tabs for good.
 */
const sameFacts = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const record = (value: object) => value as Record<string, unknown>;
  const keys = (value: object) =>
    Object.keys(value).filter((key) => record(value)[key] !== undefined);
  const [ours, theirs] = [keys(left), keys(right)];
  return (
    ours.length === theirs.length &&
    ours.every((key) => sameFacts(record(left)[key], record(right)[key]))
  );
};

/**
 * A deck with its cards' facts as the catalog has them now: added where a
 * card has none (imported while the catalog was away, or from a v1 file),
 * and updated where they changed (a rotation, a ban, a legal reprint).
 * Everything the table shows is kept as it was, its type included, and a
 * card made by hand is left alone. The same list back when nothing changed.
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
    // A card given another type than the catalog's (in the card dialog) is
    // played as its maker said, not as that print.
    if (!print || print.category !== card.category) return entry;
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
