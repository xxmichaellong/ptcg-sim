/**
 * TCGdex's card data (https://tcgdex.dev, MIT) turned into the catalog's
 * wire format (packages/deck-core/src/catalog-wire.ts, ADR-032). Everything
 * from TCGdex is untrusted: values are checked, long text is refused, and a
 * card that doesn't fit is left out rather than failing its set.
 *
 * TCGdex doesn't record some mechanics (Tera, Ancient, Future, the Battle
 * Styles, ACE SPEC before Scarlet & Violet, …); those come from `tags.json`
 * (scripts/card-catalog/build-tag-table.mjs), keyed by TCGdex card id.
 */
import setCodeSeed from './set-codes.json';
import tagTable from './tags.json';

export const TCGDEX_GRAPHQL_URL = 'https://api.tcgdex.net/v2/graphql';
export const TCGDEX_REST_URL = 'https://api.tcgdex.net/v2/en';

/** Every English set, with what the catalog needs to know about it. */
export const TCGDEX_SETS_QUERY =
  '{ sets { id name releaseDate serie { id name } cardCount { official total } logo symbol } }';

const CARD_FIELDS =
  'id localId name category hp types stage suffix evolveFrom trainerType energyType effect regulationMark legal { standard expanded } image illustrator rarity retreat dexId abilities { type name effect } attacks { name cost damage effect } weaknesses { type value } resistances { type value }';

/**
 * One set's cards. TCGdex matches `id` as a substring, so the caller keeps
 * only ids that start with the set's.
 */
export const tcgdexSetCardsQuery = (setId: string): string =>
  `{ cards(filters: { id: ${JSON.stringify(`${setId}-`)} }) { ${CARD_FIELDS} } }`;

const LIMITS = Object.freeze({
  name: 160,
  shortText: 128,
  text: 4_000,
  url: 1_024,
  number: 24,
  abilities: 8,
  attacks: 8,
  dex: 8,
  setId: 32,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : undefined;
};

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

/** Energy as Pokémon TCG Live writes it ({R} Fire, {N} Dragon, {Y} Fairy). */
const ENERGY_LETTERS: Readonly<Record<string, string>> = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Fairy: 'Y',
  Dragon: 'N',
  Colorless: 'C',
};

const letters = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .map((type) =>
      typeof type === 'string' ? ENERGY_LETTERS[type] : undefined
    )
    .filter((letter): letter is string => letter !== undefined)
    .join('');
  return result === '' ? undefined : result.slice(0, 12);
};

const firstType = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.type === 'string') {
      const letter = ENERGY_LETTERS[entry.type];
      if (letter) return letter;
    }
  }
  return undefined;
};

const CATEGORIES: Readonly<Record<string, 'P' | 'T' | 'E'>> = {
  Pokemon: 'P',
  Trainer: 'T',
  Energy: 'E',
};

const STAGES: Readonly<Record<string, string>> = {
  Basic: 'Basic',
  Stage1: 'Stage 1',
  Stage2: 'Stage 2',
  VMAX: 'VMAX',
  VSTAR: 'VSTAR',
  'V-UNION': 'V-UNION',
  MEGA: 'Mega',
  BREAK: 'BREAK',
  'LEVEL-UP': 'Level-Up',
  RESTORED: 'Restored',
  Baby: 'Baby',
};

const TRAINER_TYPES = new Set([
  'Item',
  'Supporter',
  'Stadium',
  'Tool',
  'Technical Machine',
  "Rocket's Secret Machine",
]);

const SUFFIX_TAGS: Readonly<Record<string, readonly string[]>> = {
  EX: ['EX'],
  ex: ['ex'],
  V: ['V'],
  GX: ['GX'],
  'TAG TEAM-GX': ['TAG TEAM', 'GX'],
  SP: ['SP'],
  Prime: ['Prime'],
  Legend: ['LEGEND'],
};

const STAGE_TAGS: Readonly<Record<string, string>> = {
  VMAX: 'VMAX',
  VSTAR: 'VSTAR',
  'V-UNION': 'V-UNION',
  Mega: 'Mega',
  BREAK: 'BREAK',
  'Level-Up': 'Level-Up',
  Baby: 'Baby',
};

/** Card id -> mechanics TCGdex doesn't record. */
const TABLE_TAGS: ReadonlyMap<string, readonly string[]> = (() => {
  const byCard = new Map<string, string[]>();
  for (const [tag, ids] of Object.entries(
    tagTable as Readonly<Record<string, readonly string[]>>
  )) {
    for (const id of ids) {
      const tags = byCard.get(id) ?? [];
      tags.push(tag);
      byCard.set(id, tags);
    }
  }
  return byCard;
})();

/** An owner's Pokémon: "Brock's Onix", "N's Zoroark ex", "Lt. Surge's Raichu". */
const OWNER = /^(?:[A-Z][\w.]*\s)?[A-Z][\w.]*'s\s/u;

/** The tags a card earns from its suffix, stage, name and rarity. */
export const cardTags = (card: {
  readonly id: string;
  readonly name: string;
  readonly category: 'P' | 'T' | 'E';
  readonly stage?: string | undefined;
  readonly suffix?: string | undefined;
  readonly rarity?: string | undefined;
}): readonly string[] => {
  const tags = new Set<string>();
  for (const tag of SUFFIX_TAGS[card.suffix ?? ''] ?? []) {
    // TCGdex writes TCG Pocket's "ex" as "EX"; the name says which it is.
    tags.add(
      tag === 'EX' && card.name.endsWith(' ex')
        ? 'ex'
        : tag === 'ex' && card.name.endsWith(' EX')
          ? 'EX'
          : tag
    );
  }
  const stageTag = STAGE_TAGS[card.stage ?? ''];
  if (stageTag) tags.add(stageTag);
  const name = card.name.replaceAll('’', "'");
  if (card.rarity === 'ACE SPEC Rare') tags.add('ACE SPEC');
  if (card.rarity === 'Radiant Rare' || name.startsWith('Radiant ')) {
    tags.add('Radiant');
  }
  if (name.includes('◇')) tags.add('Prism Star');
  if (name.includes('☆')) tags.add('Star');
  if (name.includes('δ')) tags.add('Delta Species');
  if (card.category === 'P') {
    if (/^(?:M|Mega) /u.test(name)) tags.add('Mega');
    if (name.startsWith('Dark ')) tags.add('Dark');
    if (name.startsWith('Light ')) tags.add('Light');
    if (name.startsWith('Shining ')) tags.add('Shining');
    if (name.startsWith("Team Rocket's ")) tags.add("Team Rocket's");
    else if (OWNER.test(name)) tags.add("Owner's");
  }
  for (const tag of TABLE_TAGS.get(card.id) ?? []) tags.add(tag);
  return [...tags];
};

/** A wire card, as `catalog-wire.ts` reads it. */
export interface WireCard {
  n: string;
  nm: string;
  c: 'P' | 'T' | 'E';
  st?: string;
  hp?: number;
  ty?: string;
  ef?: string;
  tt?: string;
  et?: 'B' | 'S';
  tx?: string;
  rm?: string;
  il?: string;
  ra?: string;
  rt?: number;
  dx?: number[];
  ab?: [string, string, string][];
  at?: ([string, string, string] | [string, string, string, string])[];
  wk?: string;
  rs?: string;
  tg?: string[];
  lg?: number;
  im?: string;
}

const damageText = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value, LIMITS.shortText);
};

/**
 * One TCGdex card in wire form, or undefined when it can't be one.
 * `imageBase` is the set's image directory; a card whose image is there
 * under its number leaves `im` out.
 */
export const normalizeTcgdexCard = (
  value: unknown,
  setId: string,
  imageBase: string | undefined,
  limitlessScans = false
): WireCard | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, LIMITS.setId + LIMITS.number + 1);
  const localId = text(value.localId, LIMITS.number);
  const number = localId ? catalogNumber(setId, localId) : undefined;
  const name = text(value.name, LIMITS.name);
  const category =
    typeof value.category === 'string' ? CATEGORIES[value.category] : undefined;
  if (!id || !number || !name || !category) return undefined;
  if (!id.startsWith(`${setId}-`)) return undefined;

  const card: WireCard = { n: number, nm: name, c: category };
  const stage =
    typeof value.stage === 'string' ? STAGES[value.stage] : undefined;
  if (stage) card.st = stage;
  const hp = integer(value.hp, 1_000);
  if (hp !== undefined && category === 'P') card.hp = hp;
  const types = letters(value.types);
  if (types) card.ty = types;
  const evolvesFrom = text(value.evolveFrom, LIMITS.name);
  if (evolvesFrom) card.ef = evolvesFrom;
  if (
    category === 'T' &&
    typeof value.trainerType === 'string' &&
    TRAINER_TYPES.has(value.trainerType)
  ) {
    card.tt = value.trainerType;
  }
  if (category === 'E') {
    if (value.energyType === 'Normal') card.et = 'B';
    else if (value.energyType === 'Special') card.et = 'S';
  }
  const effect = text(value.effect, LIMITS.text);
  if (effect) card.tx = effect;
  const mark = text(value.regulationMark, 2);
  if (mark && /^[A-Z]$/u.test(mark)) card.rm = mark;
  const illustrator = text(value.illustrator, LIMITS.shortText);
  if (illustrator) card.il = illustrator;
  const rarity = text(value.rarity, LIMITS.shortText);
  if (rarity && rarity !== 'None') card.ra = rarity;
  const retreat = integer(value.retreat, 10);
  if (retreat !== undefined && category === 'P') card.rt = retreat;
  if (Array.isArray(value.dexId)) {
    const dex = value.dexId
      .map((entry) => integer(entry, 10_000))
      .filter((entry): entry is number => entry !== undefined)
      .slice(0, LIMITS.dex);
    if (dex.length > 0) card.dx = dex;
  }
  if (Array.isArray(value.abilities)) {
    const abilities = value.abilities.flatMap((ability) => {
      if (!isRecord(ability)) return [];
      const abilityName = text(ability.name, LIMITS.name);
      if (!abilityName) return [];
      return [
        [
          text(ability.type, LIMITS.shortText) ?? 'Ability',
          abilityName,
          text(ability.effect, LIMITS.text) ?? '',
        ] as [string, string, string],
      ];
    });
    if (abilities.length > 0) card.ab = abilities.slice(0, LIMITS.abilities);
  }
  if (Array.isArray(value.attacks)) {
    const attacks = value.attacks.flatMap((attack) => {
      if (!isRecord(attack)) return [];
      const attackName = text(attack.name, LIMITS.name);
      const damage = damageText(attack.damage);
      if (!attackName || damage === undefined) return [];
      const cost = letters(attack.cost) ?? '';
      const attackEffect = text(attack.effect, LIMITS.text);
      return [
        attackEffect
          ? ([attackName, cost, damage, attackEffect] as [
              string,
              string,
              string,
              string,
            ])
          : ([attackName, cost, damage] as [string, string, string]),
      ];
    });
    if (attacks.length > 0) card.at = attacks.slice(0, LIMITS.attacks);
  }
  const weakness = firstType(value.weaknesses);
  if (weakness) card.wk = weakness;
  const resistance = firstType(value.resistances);
  if (resistance) card.rs = resistance;
  const tags = cardTags({
    id,
    name,
    category,
    stage,
    suffix: typeof value.suffix === 'string' ? value.suffix : undefined,
    rarity,
  });
  if (tags.length > 0) card.tg = [...tags];
  if (isRecord(value.legal)) {
    const legal =
      (value.legal.standard === true ? 1 : 0) |
      (value.legal.expanded === true ? 2 : 0);
    if (legal !== 0) card.lg = legal;
  }
  const image = httpsUrl(value.image);
  if (!image) {
    // The browser falls back to Limitless's scan; with none there, a card
    // with no picture can't be played, so it isn't listed.
    if (!limitlessScans) return undefined;
    card.im = '';
  } else if (image !== `${imageBase ?? ''}${number}`) card.im = image;
  return card;
};

/** A set as TCGdex's sets query lists it. */
export interface TcgdexSetSummary {
  readonly id: string;
  readonly name: string;
  readonly released: string;
  readonly seriesId: string;
  readonly series: string;
  readonly official: number;
  readonly total: number;
  readonly logo?: string;
  readonly symbol?: string;
}

/** The sets query's answer, keeping the sets that make sense. */
export const normalizeTcgdexSets = (
  value: unknown
): readonly TcgdexSetSummary[] => {
  const data = isRecord(value) && isRecord(value.data) ? value.data : undefined;
  if (!data || !Array.isArray(data.sets)) return [];
  const seen = new Set<string>();
  return data.sets.flatMap((set): TcgdexSetSummary[] => {
    if (!isRecord(set) || !isRecord(set.serie) || !isRecord(set.cardCount)) {
      return [];
    }
    const id = text(set.id, LIMITS.setId);
    const name = text(set.name, LIMITS.name);
    const released = text(set.releaseDate, 10);
    const seriesId = text(set.serie.id, LIMITS.setId);
    const series = text(set.serie.name, LIMITS.name);
    const total = integer(set.cardCount.total, 5_000);
    if (
      !id ||
      !/^[\w.-]+$/u.test(id) ||
      seen.has(id) ||
      !name ||
      !released ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(released) ||
      !seriesId ||
      !series ||
      total === undefined
    ) {
      return [];
    }
    seen.add(id);
    const logo = httpsUrl(set.logo);
    const symbol = httpsUrl(set.symbol);
    return [
      {
        id,
        name,
        released,
        seriesId,
        series,
        official: integer(set.cardCount.official, 5_000) ?? total,
        total,
        ...(logo ? { logo } : {}),
        ...(symbol ? { symbol } : {}),
      },
    ];
  });
};

/**
 * Pokémon TCG Live's and Limitless's code for a set, where TCGdex's own
 * fields don't give it (promos, folded subsets, old collisions).
 */
export const SET_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  swshp: 'SP',
  sma: 'HIF',
  rc: 'LTR',
  hgssp: 'HSP',
  ex7: 'TRR',
  dpp: 'DPP',
  np: 'NP',
  basep: 'WBSP',
  // Limitless's code; plain "B2" is TCG Pocket's Fantastical Parade.
  base4: 'BS2',
};

/**
 * Collector numbers as Limitless and Pokémon TCG Live write them, where
 * TCGdex differs: promos lose their series prefix ("SWSH022" is SP 22,
 * "SM85" is SMP 85) and the 30th Classic Collection gains "CC".
 */
const NUMBER_PREFIXES_DROPPED: Readonly<Record<string, string>> = {
  swshp: 'SWSH',
  smp: 'SM',
  xyp: 'XY',
  bwp: 'BW',
  hgssp: 'HGSS',
  dpp: 'DP',
};
const NUMBER_PREFIXES_ADDED: Readonly<Record<string, string>> = {
  '30th-c': 'CC',
};

/** A card's collector number in its set, as the catalog writes it. */
export const catalogNumber = (setId: string, localId: string): string => {
  const dropped = NUMBER_PREFIXES_DROPPED[setId];
  const number =
    dropped &&
    localId.startsWith(dropped) &&
    /^\d/u.test(localId.slice(dropped.length))
      ? localId.slice(dropped.length)
      : localId;
  return `${NUMBER_PREFIXES_ADDED[setId] ?? ''}${number}`;
};

const POCKET_SERIES = 'tcgp';

/**
 * Series whose sets Limitless has scans of, by set code and number: the
 * browser's fallback when TCGdex has no image. Not their trainer kits,
 * McDonald's collections or My First Battle.
 */
const LIMITLESS_SCANNED_SERIES = new Set([
  'dp',
  'pl',
  'hgss',
  'bw',
  'xy',
  'sm',
  'swsh',
  'sv',
  'me',
  POCKET_SERIES,
]);
const UNSCANNED_SET = /^(?:tk-|\d{4}|mfb$)/u;

export const hasLimitlessScans = (set: TcgdexSetSummary): boolean =>
  LIMITLESS_SCANNED_SERIES.has(set.seriesId) && !UNSCANNED_SET.test(set.id);

/**
 * A set's code from TCGdex's set details: the online game's code where it
 * has one (except its "PR-" promo codes, which Limitless writes as
 * SVP, SMP, …), else the official abbreviation without a subset suffix
 * ("BRS:TG" is BRS). TCG Pocket sets are known by their id ("A1").
 */
export const setCodeFromDetails = (
  setId: string,
  details: unknown
): string | undefined => {
  const override = SET_CODE_OVERRIDES[setId];
  if (override) return override;
  if (!isRecord(details)) return undefined;
  if (isRecord(details.serie) && details.serie.id === POCKET_SERIES) {
    return setId;
  }
  const online = text(details.tcgOnline, 16);
  if (online && !online.startsWith('PR')) return online;
  const official = isRecord(details.abbreviation)
    ? text(details.abbreviation.official, 16)
    : undefined;
  const code = official?.split(':', 1)[0]?.trim();
  return code && /^[A-Za-z0-9-]+$/u.test(code) ? code.toUpperCase() : undefined;
};

/** The checked-in codes, from scripts/card-catalog/build-set-codes.ts. */
export const SEEDED_SET_CODES: Readonly<Record<string, string>> =
  setCodeSeed as Readonly<Record<string, string>>;

/** One set of the catalog, as JSON, ready to be joined into the body. */
export const wireSetJson = (
  set: TcgdexSetSummary,
  code: string | undefined,
  cards: readonly unknown[]
): {
  readonly json: string;
  readonly cards: number;
  readonly dropped: number;
} => {
  const pocket = set.seriesId === POCKET_SERIES;
  // The image directory most of the set's cards share.
  const bases = new Map<string, number>();
  for (const card of cards) {
    if (!isRecord(card)) continue;
    const image = httpsUrl(card.image);
    const number = text(card.localId, LIMITS.number);
    if (image && number && image.endsWith(`/${number}`)) {
      const base = image.slice(0, image.length - number.length);
      bases.set(base, (bases.get(base) ?? 0) + 1);
    }
  }
  const imageBase = [...bases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const wireCards: WireCard[] = [];
  let dropped = 0;
  const numbers = new Set<string>();
  for (const card of cards) {
    const normalized = normalizeTcgdexCard(
      card,
      set.id,
      imageBase,
      code !== undefined && hasLimitlessScans(set)
    );
    if (!normalized || numbers.has(normalized.n)) {
      dropped += 1;
      continue;
    }
    numbers.add(normalized.n);
    wireCards.push(normalized);
  }
  const json = JSON.stringify({
    id: set.id,
    ...(code ? { code } : {}),
    name: set.name,
    series: set.series,
    released: set.released,
    official: set.official,
    total: set.total,
    ...(set.logo ? { logo: set.logo } : {}),
    ...(set.symbol ? { symbol: set.symbol } : {}),
    ...(pocket ? { pocket: true } : {}),
    ...(imageBase ? { img: imageBase } : {}),
    cards: wireCards,
  });
  return { json, cards: wireCards.length, dropped };
};

/** The cards a set query answered, or undefined if it isn't an answer. */
export const tcgdexCardsOf = (
  value: unknown
): readonly unknown[] | undefined => {
  if (!isRecord(value) || !isRecord(value.data)) return undefined;
  return Array.isArray(value.data.cards) ? value.data.cards : undefined;
};
