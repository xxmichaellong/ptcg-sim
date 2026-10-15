import {
  ENERGY_TYPES,
  type CatalogAbility,
  type CatalogAttack,
  type CatalogCard,
  type CatalogSet,
  type EnergyType,
  type LoadedCatalog,
} from './catalog.js';
import { foldText } from './card-query.js';
import type { CardCategory } from './deck-list.js';

/**
 * The card catalog as the server sends it (ADR-032).
 *
 * The server builds it one set at a time and serves it as one JSON body,
 * assembled by joining the sets' stored JSON, so each set carries its own
 * cards. Cards use short keys and leave out what they don't have:
 *
 *   {
 *     "v": 1, "builtAt": "…", "source": "TCGdex",
 *     "bans": { "expanded": ["PHF 99", …] },
 *     "sets": [{
 *       "id": "sv06", "code": "TWM", "name": "Twilight Masquerade",
 *       "series": "Scarlet & Violet", "released": "2024-05-24",
 *       "official": 167, "total": 226,
 *       "img": "https://assets.tcgdex.net/en/sv/sv06/",
 *       "cards": [{ "n": "130", "nm": "Dragapult ex", "c": "P",
 *                   "st": "Stage 2", "hp": 320, "ty": "N", … }]
 *     }]
 *   }
 *
 * Card keys: n collector number (as Limitless writes it), nm name, c category
 * (P/T/E), st stage, hp, ty types (energy letters), ef evolves from,
 * tt trainer type, et energy type (B/S), tx effect text, rm regulation
 * mark, il illustrator, ra rarity, rt retreat, dx Pokédex numbers,
 * ab abilities [kind, name, text], at attacks [name, cost letters, damage,
 * text?], wk weakness, rs resistance (letters), tg tags, lg the source's
 * legality (1 Standard, 2 Expanded), im image base when it isn't the set's
 * `img` + `n` ("" when the source has none).
 *
 * Decoding is defensive: a card that doesn't decode is skipped, and only a
 * body that isn't a catalog at all is an error.
 */

export const CATALOG_WIRE_VERSION = 1;

/** Energy as Pokémon TCG Live writes it: {R} is Fire, {N} Dragon, {Y} Fairy. */
export const ENERGY_LETTERS: Readonly<Record<string, EnergyType>> =
  Object.freeze({
    G: 'Grass',
    R: 'Fire',
    W: 'Water',
    L: 'Lightning',
    P: 'Psychic',
    F: 'Fighting',
    D: 'Darkness',
    M: 'Metal',
    Y: 'Fairy',
    N: 'Dragon',
    C: 'Colorless',
  });

export const LEGAL_STANDARD = 1;
export const LEGAL_EXPANDED = 2;

export interface WireCatalogCard {
  readonly n: string;
  readonly nm: string;
  readonly c: 'P' | 'T' | 'E';
  readonly st?: string;
  readonly hp?: number;
  readonly ty?: string;
  readonly ef?: string;
  readonly tt?: string;
  readonly et?: 'B' | 'S';
  readonly tx?: string;
  readonly rm?: string;
  readonly il?: string;
  readonly ra?: string;
  readonly rt?: number;
  readonly dx?: readonly number[];
  readonly ab?: readonly (readonly [string, string, string])[];
  readonly at?: readonly (
    | readonly [string, string, string]
    | readonly [string, string, string, string]
  )[];
  readonly wk?: string;
  readonly rs?: string;
  readonly tg?: readonly string[];
  readonly lg?: number;
  readonly im?: string;
}

export interface WireCatalogSet {
  readonly id: string;
  readonly code?: string;
  readonly name: string;
  readonly series: string;
  readonly released: string;
  readonly official?: number;
  readonly total?: number;
  readonly logo?: string;
  readonly symbol?: string;
  readonly pocket?: true;
  /** Image base: a card's image is `img` + its number + "/high.webp". */
  readonly img?: string;
  readonly cards: readonly WireCatalogCard[];
}

export interface WireCatalog {
  readonly v: typeof CATALOG_WIRE_VERSION;
  readonly builtAt: string;
  readonly source: string;
  readonly bans?: {
    readonly standard?: readonly string[];
    readonly expanded?: readonly string[];
  };
  readonly sets: readonly WireCatalogSet[];
}

export class CatalogWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogWireError';
  }
}

const LIMITS = Object.freeze({
  sets: 2_000,
  cardsPerSet: 2_000,
  cards: 100_000,
  bans: 2_000,
  shortText: 128,
  name: 160,
  text: 4_000,
  url: 1_024,
  abilities: 8,
  attacks: 8,
  tags: 16,
  dex: 8,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, maximum: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;

const integer = (value: unknown, maximum: number): number | undefined =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= maximum
    ? value
    : undefined;

const httpsUrl = (value: unknown): string | undefined => {
  const url = text(value, LIMITS.url);
  return url?.startsWith('https://') ? url : undefined;
};

/**
 * A collector number as Pokémon TCG Live and Limitless write it: upper
 * case, no leading zeros in its digits ("001" is "1", "TG01" is "TG1",
 * "SV049" is "SV49", "206a" is "206A").
 */
export const normalizeCollectorNumber = (value: string): string => {
  const upper = value.trim().toUpperCase();
  const match = /^([A-Z-]*?)0*(\d+)([A-Z]*)$/u.exec(upper);
  return match ? `${match[1]!}${match[2]!}${match[3]!}` : upper;
};

/** The id of one printing: its set code and normalized number. */
export const catalogCardId = (code: string, number: string): string =>
  `${code.trim().toUpperCase()} ${normalizeCollectorNumber(number)}`;

const energy = (letter: string): EnergyType | undefined =>
  ENERGY_LETTERS[letter];

const energies = (value: unknown): readonly EnergyType[] | undefined => {
  if (value === undefined) return Object.freeze([]);
  if (typeof value !== 'string' || value.length > 12) return undefined;
  const result: EnergyType[] = [];
  for (const letter of value) {
    const type = energy(letter);
    if (!type) return undefined;
    result.push(type);
  }
  return Object.freeze(result);
};

const CATEGORIES: Readonly<Record<string, CardCategory>> = {
  P: 'Pokémon',
  T: 'Trainer',
  E: 'Energy',
};

const STAGES = new Set([
  'Basic',
  'Stage 1',
  'Stage 2',
  'Mega',
  'VMAX',
  'VSTAR',
  'V-UNION',
  'BREAK',
  'Level-Up',
  'Restored',
  'Baby',
  'LEGEND',
]);

const TRAINER_TYPES = new Set([
  'Item',
  'Supporter',
  'Stadium',
  'Tool',
  'Technical Machine',
  "Rocket's Secret Machine",
]);

/** Pokémon TCG Live's image file number: three digits, or as printed. */
const limitlessNumber = (number: string): string =>
  /^\d+$/u.test(number) ? number.padStart(3, '0') : number;

const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';

/** Limitless's scan of a card, for printings the source has no image of. */
export const limitlessImages = (
  code: string,
  number: string,
  pocket: boolean
): { readonly large: string; readonly small: string } => {
  const file = `${code}_${limitlessNumber(number)}`;
  if (pocket) {
    const url = `${LIMITLESS_CDN}/pocket/${code}/${file}_EN_SM.webp`;
    return { large: url, small: url };
  }
  return {
    large: `${LIMITLESS_CDN}/tpci/${code}/${file}_R_EN_LG.png`,
    small: `${LIMITLESS_CDN}/tpci/${code}/${file}_R_EN_SM.png`,
  };
};

const decodeAbilities = (
  value: unknown
): readonly CatalogAbility[] | undefined => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > LIMITS.abilities)
    return undefined;
  const result: CatalogAbility[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) return undefined;
    const kind = text(entry[0], LIMITS.shortText);
    const name = text(entry[1], LIMITS.name);
    const effect = entry[2] === '' ? '' : text(entry[2], LIMITS.text);
    if (!kind || !name || effect === undefined) return undefined;
    result.push(Object.freeze({ kind, name, text: effect }));
  }
  return Object.freeze(result);
};

const decodeAttacks = (
  value: unknown
): readonly CatalogAttack[] | undefined => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > LIMITS.attacks) return undefined;
  const result: CatalogAttack[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) return undefined;
    const name = text(entry[0], LIMITS.name);
    const cost = energies(entry[1] === '' ? undefined : entry[1]);
    const damage = entry[2] === '' ? '' : text(entry[2], LIMITS.shortText);
    const effect =
      entry[3] === undefined ? undefined : text(entry[3], LIMITS.text);
    if (!name || !cost || damage === undefined) return undefined;
    if (entry[3] !== undefined && effect === undefined) return undefined;
    result.push(
      Object.freeze({
        name,
        cost,
        damage,
        ...(effect ? { text: effect } : {}),
      })
    );
  }
  return Object.freeze(result);
};

const decodeTags = (value: unknown): readonly string[] | undefined => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > LIMITS.tags) return undefined;
  const tags: string[] = [];
  for (const tag of value) {
    const decoded = text(tag, LIMITS.shortText);
    if (!decoded) return undefined;
    if (!tags.includes(decoded)) tags.push(decoded);
  }
  return tags;
};

const decodeDex = (value: unknown): readonly number[] | undefined => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > LIMITS.dex) return undefined;
  const result: number[] = [];
  for (const number of value) {
    const decoded = integer(number, 10_000);
    if (decoded === undefined) return undefined;
    result.push(decoded);
  }
  return Object.freeze(result);
};

const optional = <Key extends string, Value>(
  key: Key,
  value: Value | undefined
): { [K in Key]?: Value } =>
  (value === undefined ? {} : { [key]: value }) as { [K in Key]?: Value };

/** Two FNV-1a lanes over normalized characters: 53 bits, as base 36. */
class GroupHash {
  #low = 0x811c9dc5;
  #high = 0x01000193;
  #space = true;

  /**
   * Case, runs of spaces, curly apostrophes and the accent in "Pokémon"
   * never make two printings different, so they hash the same.
   */
  add(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      let code = value.charCodeAt(index);
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        if (this.#space) continue;
        this.#space = true;
        code = 32;
      } else {
        this.#space = false;
        if (code >= 65 && code <= 90) code += 32;
        else if (code === 0xe9 || code === 0xc9) code = 101;
        else if (code === 0x2019 || code === 0x2018) code = 39;
      }
      this.#mix(code);
    }
    // A separator, so "ab" + "c" and "a" + "bc" differ.
    this.#mix(1);
    this.#space = true;
  }

  digest(): string {
    return ((this.#high & 0x1fffff) * 0x100000000 + this.#low).toString(36);
  }

  #mix(code: number): void {
    this.#low = Math.imul(this.#low ^ code, 0x01000193) >>> 0;
    this.#high = Math.imul(this.#high ^ code, 0x5bd1e995) >>> 0;
  }
}

type Mutable = Record<string, unknown>;

const assign = (target: Mutable, key: string, value: unknown): void => {
  if (value !== undefined) target[key] = value;
};

interface DecodedPrint {
  /** The card without `tags`, `legal` and `printGroup`, which come later. */
  readonly card: Mutable & {
    readonly id: string;
    readonly set: CatalogSet;
  };
  readonly tags: readonly string[];
  readonly legal: number;
  readonly groupKey: string;
  readonly basicEnergy: boolean;
}

/**
 * What makes two printings the same card: the same name and the same
 * rules. Reprints, full arts and promos share it, so they share legality
 * (a reprint legal in a format makes every print of it legal there). A
 * hash taken in one pass with no copies: the decoder keys 20,000 cards.
 */
export const printGroupKey = (card: {
  readonly name: string;
  readonly category: CardCategory;
  readonly stage?: string | undefined;
  readonly hp?: number | undefined;
  readonly types: readonly EnergyType[];
  readonly abilities: readonly CatalogAbility[];
  readonly attacks: readonly CatalogAttack[];
  readonly text?: string | undefined;
  readonly energyType?: 'Basic' | 'Special' | undefined;
}): string => {
  const hash = new GroupHash();
  if (card.category === 'Energy' && card.energyType === 'Basic') {
    hash.add(card.name);
    return `e${hash.digest()}`;
  }
  hash.add(card.name);
  hash.add(card.category);
  hash.add(card.stage ?? '');
  hash.add(card.hp === undefined ? '' : String(card.hp));
  for (const type of card.types) hash.add(type);
  for (const ability of card.abilities) {
    hash.add(ability.name);
    hash.add(ability.text);
  }
  for (const attack of card.attacks) {
    hash.add(attack.name);
    for (const type of attack.cost) hash.add(type);
    hash.add(attack.damage);
    hash.add(attack.text ?? '');
  }
  hash.add(card.text ?? '');
  return `g${hash.digest()}`;
};

const decodeCard = (
  value: unknown,
  set: CatalogSet,
  wire: { readonly img?: string },
  rawCode: string
): DecodedPrint | undefined => {
  if (!isRecord(value)) return undefined;
  const rawNumber = text(value.n, 24);
  const name = text(value.nm, LIMITS.name);
  const category =
    typeof value.c === 'string' ? CATEGORIES[value.c] : undefined;
  if (!rawNumber || !name || !category) return undefined;
  const number = normalizeCollectorNumber(rawNumber);

  const types = energies(value.ty);
  const abilities = decodeAbilities(value.ab);
  const attacks = decodeAttacks(value.at);
  const tags = decodeTags(value.tg);
  const dex = decodeDex(value.dx);
  if (!types || !abilities || !attacks || !tags || !dex) return undefined;

  const stage =
    typeof value.st === 'string' && STAGES.has(value.st) ? value.st : undefined;
  const trainerType =
    typeof value.tt === 'string' && TRAINER_TYPES.has(value.tt)
      ? value.tt
      : undefined;
  const energyType =
    value.et === 'B' ? 'Basic' : value.et === 'S' ? 'Special' : undefined;
  const weakness = typeof value.wk === 'string' ? energy(value.wk) : undefined;
  const resistance =
    typeof value.rs === 'string' ? energy(value.rs) : undefined;

  let image: string | undefined;
  let imageSmall: string | undefined;
  const base =
    value.im === undefined
      ? wire.img
        ? `${wire.img}${rawNumber}`
        : undefined
      : value.im === ''
        ? undefined
        : httpsUrl(value.im);
  if (base) {
    image = `${base}/high.webp`;
    imageSmall = `${base}/low.webp`;
  } else if (rawCode) {
    const fallback = limitlessImages(rawCode, number, set.pocket ?? false);
    image = fallback.large;
    imageSmall = fallback.small;
  }
  if (!image || !imageSmall) return undefined;

  const effect = text(value.tx, LIMITS.text);
  const hp = integer(value.hp, 1_000);
  const retreat = integer(value.rt, 10);
  // One object per card, filled in place: the decoder makes 20,000 of
  // them, and spreading optional fields would make ten times as many.
  const card: DecodedPrint['card'] = {
    id: catalogCardId(set.code ?? set.id, number),
    name,
    category,
    set,
    number,
    image,
    imageSmall,
    types,
    abilities,
    attacks,
    dex,
  };
  assign(card, 'rarity', text(value.ra, LIMITS.shortText));
  assign(card, 'illustrator', text(value.il, LIMITS.shortText));
  assign(card, 'regulationMark', text(value.rm, 4));
  assign(card, 'stage', stage);
  assign(card, 'hp', hp);
  assign(card, 'evolvesFrom', text(value.ef, LIMITS.name));
  assign(card, 'weakness', weakness);
  assign(card, 'resistance', resistance);
  assign(card, 'retreat', retreat);
  assign(card, 'trainerType', trainerType);
  assign(card, 'energyType', energyType);
  assign(card, 'text', effect);
  return {
    card,
    tags,
    legal: integer(value.lg, 3) ?? 0,
    groupKey: printGroupKey({
      name,
      category,
      stage,
      hp,
      types,
      abilities,
      attacks,
      text: effect,
      energyType,
    }),
    basicEnergy: category === 'Energy' && energyType === 'Basic',
  };
};

const decodeSet = (value: unknown): CatalogSet | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, 32);
  const name = text(value.name, LIMITS.name);
  const series = text(value.series, LIMITS.name);
  const released = text(value.released, 10);
  if (
    !id ||
    !name ||
    !series ||
    !released ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(released)
  ) {
    return undefined;
  }
  const code = text(value.code, 16);
  return Object.freeze({
    id,
    ...optional('code', code?.toUpperCase()),
    name,
    series,
    released,
    ...optional('symbol', httpsUrl(value.symbol)),
    ...optional('logo', httpsUrl(value.logo)),
    ...(typeof value.official === 'number' &&
    Number.isSafeInteger(value.official) &&
    value.official > 0 &&
    value.official < 10_000
      ? { official: value.official }
      : {}),
    ...(value.pocket === true ? { pocket: true } : {}),
  });
};

const banList = (value: unknown): ReadonlySet<string> => {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.slice(0, LIMITS.bans).flatMap((entry) => {
      const id = text(entry, 32);
      if (!id) return [];
      const space = id.lastIndexOf(' ');
      return space > 0
        ? [catalogCardId(id.slice(0, space), id.slice(space + 1))]
        : [];
    })
  );
};

/**
 * Reads the server's catalog body. Throws `CatalogWireError` only when the
 * body isn't a catalog of this version; a card or set that doesn't decode
 * is left out. A later printing with an id already taken is left out too.
 */
export const decodeCatalog = (value: unknown): LoadedCatalog => {
  if (!isRecord(value))
    throw new CatalogWireError('The catalog is not an object.');
  if (value.v !== CATALOG_WIRE_VERSION) {
    throw new CatalogWireError(
      `Unsupported catalog version ${String(value.v)}.`
    );
  }
  const builtAt = text(value.builtAt, 40);
  if (!builtAt || !Number.isFinite(Date.parse(builtAt))) {
    throw new CatalogWireError('The catalog has no build time.');
  }
  if (!Array.isArray(value.sets) || value.sets.length > LIMITS.sets) {
    throw new CatalogWireError('The catalog has no sets.');
  }
  const bans = isRecord(value.bans) ? value.bans : {};
  const bannedStandard = banList(bans.standard);
  const bannedExpanded = banList(bans.expanded);

  const sets: CatalogSet[] = [];
  const prints: DecodedPrint[] = [];
  const seen = new Set<string>();
  for (const rawSet of value.sets) {
    const set = decodeSet(rawSet);
    if (!set || !isRecord(rawSet) || !Array.isArray(rawSet.cards)) continue;
    if (sets.some((existing) => existing.id === set.id)) continue;
    sets.push(set);
    const wire = {
      ...optional('img', httpsUrl(rawSet.img)),
    };
    for (const rawCard of rawSet.cards.slice(0, LIMITS.cardsPerSet)) {
      if (prints.length >= LIMITS.cards) break;
      const print = decodeCard(rawCard, set, wire, set.code ?? '');
      if (!print || seen.has(print.card.id)) continue;
      seen.add(print.card.id);
      prints.push(print);
    }
  }

  // Legality and tags belong to the card, not the printing: a group is
  // legal where any of its prints is, banned where any is banned, and
  // carries every tag any print carries.
  const groups = new Map<
    string,
    { legal: number; banned: number; tags: Set<string> }
  >();
  for (const print of prints) {
    const group = groups.get(print.groupKey) ?? {
      legal: 0,
      banned: 0,
      tags: new Set<string>(),
    };
    group.legal |= print.legal;
    if (bannedStandard.has(print.card.id)) group.banned |= LEGAL_STANDARD;
    if (bannedExpanded.has(print.card.id)) group.banned |= LEGAL_EXPANDED;
    for (const tag of print.tags) group.tags.add(tag);
    groups.set(print.groupKey, group);
  }

  const groupTags = new Map<string, readonly string[]>();
  const cards: CatalogCard[] = prints.map((print) => {
    const group = groups.get(print.groupKey)!;
    const pocket = print.card.set.pocket ?? false;
    // Basic Energy is legal in every format, whatever set it's from.
    const legal = pocket
      ? 0
      : print.basicEnergy
        ? LEGAL_STANDARD | LEGAL_EXPANDED
        : group.legal;
    const allowed = legal & ~group.banned;
    let tags = groupTags.get(print.groupKey);
    if (!tags) {
      tags = Object.freeze([...group.tags]);
      groupTags.set(print.groupKey, tags);
    }
    const card = print.card;
    card.tags = tags;
    card.legal = Object.freeze({
      standard: (allowed & LEGAL_STANDARD) !== 0,
      expanded: (allowed & LEGAL_EXPANDED) !== 0,
    });
    card.printGroup = print.groupKey;
    return Object.freeze(card) as unknown as CatalogCard;
  });

  const order = new Map(
    [...sets]
      .sort(
        (left, right) =>
          right.released.localeCompare(left.released) ||
          left.id.localeCompare(right.id)
      )
      .map((set, index) => [set.id, index])
  );
  // Sort keys computed once per card, not once per comparison.
  const keyed = cards.map((card) => {
    const match = /^(\D*)(\d+)(.*)$/u.exec(card.number);
    return {
      card,
      set: order.get(card.set.id)!,
      prefix: match ? match[1]! : card.number,
      digits: match ? Number(match[2]) : -1,
      suffix: match ? match[3]! : '',
    };
  });
  keyed.sort(
    (left, right) =>
      left.set - right.set ||
      (left.prefix < right.prefix ? -1 : left.prefix > right.prefix ? 1 : 0) ||
      left.digits - right.digits ||
      (left.suffix < right.suffix ? -1 : left.suffix > right.suffix ? 1 : 0)
  );
  for (let index = 0; index < keyed.length; index += 1) {
    cards[index] = keyed[index]!.card;
  }
  sets.sort((left, right) => order.get(left.id)! - order.get(right.id)!);

  const byId = new Map<string, CatalogCard>();
  const byName = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    byId.set(card.id, card);
    const key = foldText(card.name);
    const list = byName.get(key);
    if (list) list.push(card);
    else byName.set(key, [card]);
  }
  return Object.freeze({
    builtAt,
    cards: Object.freeze(cards),
    sets: Object.freeze(sets),
    byId,
    byName,
  });
};

/** Every energy letter, in the order the catalog's types list them. */
export const ENERGY_LETTER_OF: Readonly<Record<EnergyType, string>> =
  Object.freeze(
    Object.fromEntries(
      ENERGY_TYPES.map((type) => [
        type,
        Object.entries(ENERGY_LETTERS).find(([, named]) => named === type)![0],
      ])
    ) as Record<EnergyType, string>
  );
