import {
  ENERGY_TYPES,
  type CatalogCard,
  type CatalogSort,
  type EnergyType,
} from './catalog.js';

/**
 * Card search: one query language, the one Limitless TCG's card search
 * uses, over the catalog in memory.
 *
 *   charizard                 name contains "charizard"
 *   "professor's research"    name contains the phrase
 *   t:fire s:basic hp>=100    Fire, Basic, at least 100 HP
 *   is:ex,v                   ex or V (a comma is "or")
 *   is:tera+ex                Tera and ex (a plus is "and")
 *   -is:ace                   not an ACE SPEC (a minus is "not")
 *   text:draw_3_cards         rules text has the exact phrase
 *   ac<=cc  ac>=lll  ac:0     an attack payable with CC / needing LLL / free
 *   w:fighting rs:none rc<=1  weakness, resistance, retreat
 *   reg>=g f:standard e:PAL a:"Mitsuhiro Arita" r:illustration
 *
 * Filters chosen by clicking are the same clauses, so the two always agree.
 */

export type QueryOperator = ':' | '=' | '<' | '<=' | '>' | '>=';

export interface QueryClause {
  readonly field: QueryField;
  readonly operator: QueryOperator;
  /** Any one of these matches ("or"), or all of them when `all`. */
  readonly values: readonly string[];
  readonly all?: boolean;
  readonly negate?: boolean;
  /** Matched exactly, not as a part ("!name" or a quoted phrase). */
  readonly exact?: boolean;
}

export const QUERY_FIELDS = [
  'name',
  'text',
  'is',
  'type',
  'stage',
  'hp',
  'cost',
  'damage',
  'has',
  'weakness',
  'resistance',
  'retreat',
  'dex',
  'series',
  'set',
  'number',
  'artist',
  'rarity',
  'regulation',
  'format',
  'evolves',
] as const;
export type QueryField = (typeof QUERY_FIELDS)[number];

const FIELD_ALIASES: Readonly<Record<string, QueryField>> = {
  name: 'name',
  text: 'text',
  x: 'text',
  is: 'is',
  type: 'type',
  t: 'type',
  stage: 'stage',
  s: 'stage',
  hp: 'hp',
  attack: 'cost',
  att: 'cost',
  ac: 'cost',
  cost: 'cost',
  damage: 'damage',
  dmg: 'damage',
  has: 'has',
  weakness: 'weakness',
  weak: 'weakness',
  w: 'weakness',
  resistance: 'resistance',
  rs: 'resistance',
  retreat: 'retreat',
  rc: 'retreat',
  pokedex: 'dex',
  dex: 'dex',
  series: 'series',
  block: 'series',
  era: 'series',
  set: 'set',
  e: 'set',
  number: 'number',
  n: 'number',
  artist: 'artist',
  illus: 'artist',
  illustrator: 'artist',
  a: 'artist',
  rarity: 'rarity',
  r: 'rarity',
  regulation: 'regulation',
  reg: 'regulation',
  mark: 'regulation',
  format: 'format',
  f: 'format',
  evolves: 'evolves',
  from: 'evolves',
};

export interface CardQuery {
  readonly clauses: readonly QueryClause[];
  readonly sort?: CatalogSort;
  /** "cards" shows one print per card; "prints" every printing. */
  readonly unique?: 'cards' | 'prints';
}

const SORT_ALIASES: Readonly<Record<string, CatalogSort>> = {
  newest: 'newest',
  new: 'newest',
  date: 'newest',
  release: 'newest',
  oldest: 'oldest',
  old: 'oldest',
  name: 'name',
  hp: 'hp',
  type: 'type',
  set: 'set',
};

/** Splits a query into words, keeping quoted phrases whole. */
const tokenize = (text: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
    } else if (!quoted && /\s/u.test(character)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return tokens;
};

const unquote = (value: string): { text: string; quoted: boolean } => {
  const quoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  return {
    text: (quoted ? value.slice(1, -1) : value.replaceAll('"', '')).trim(),
    quoted,
  };
};

const CLAUSE = /^(-?)(!?)([a-z]+)(:|<=|>=|<|>|=)(.*)$/iu;

/**
 * Reads a typed query. Words that aren't a known `field:value` search the
 * name, so "Type: Null" or "Mr. Mime" still find their cards.
 */
export const parseCardQuery = (text: string): CardQuery => {
  const clauses: QueryClause[] = [];
  let sort: CatalogSort | undefined;
  let unique: CardQuery['unique'];
  const nameWords: string[] = [];
  for (const token of tokenize(text.slice(0, 2_000))) {
    const match = CLAUSE.exec(token);
    const key = match?.[3]?.toLowerCase() ?? '';
    const rawValue = match?.[5] ?? '';
    if (match && rawValue !== '') {
      const negate = match[1] === '-';
      const exact = match[2] === '!';
      const operator = match[4] as QueryOperator;
      if (key === 'sort' || key === 'order' || key === 'o') {
        sort = SORT_ALIASES[rawValue.toLowerCase()] ?? sort;
        continue;
      }
      if (key === 'unique' || key === 'u') {
        unique = rawValue.toLowerCase().startsWith('print')
          ? 'prints'
          : 'cards';
        continue;
      }
      const field = FIELD_ALIASES[key];
      if (field) {
        const { text: value, quoted } = unquote(rawValue);
        const all = !quoted && value.includes('+');
        const values = (quoted ? [value] : value.split(all ? '+' : ','))
          .map((part) => part.trim())
          .filter(Boolean);
        if (values.length > 0) {
          clauses.push({
            field,
            operator,
            values,
            ...(all ? { all } : {}),
            ...(negate ? { negate } : {}),
            ...(exact || quoted ? { exact: true } : {}),
          });
          continue;
        }
      }
    }
    const negate = token.startsWith('-') && token.length > 1;
    const { text: word, quoted } = unquote(negate ? token.slice(1) : token);
    if (!word) continue;
    if (negate || quoted) {
      clauses.push({
        field: 'name',
        operator: ':',
        values: [word],
        ...(negate ? { negate } : {}),
      });
    } else {
      nameWords.push(word);
    }
  }
  if (nameWords.length > 0) {
    clauses.unshift({
      field: 'name',
      operator: ':',
      values: [nameWords.join(' ')],
    });
  }
  return {
    clauses,
    ...(sort ? { sort } : {}),
    ...(unique ? { unique } : {}),
  };
};

/** Letters and digits only, lower case, accents folded: "Pokémon" = "pokemon". */
/**
 * A Trainer's name without its cosmetic subtitle: "Boss's Orders
 * (Giovanni)" is Boss's Orders, and plays as any other.
 */
export const trainerName = (name: string): string =>
  name.replace(/\s*\([^)]*\)\s*$/u, '');

export const foldText = (value: string): string =>
  value
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[‘’ʼ]/gu, "'")
    .replaceAll(/[^\p{L}\p{N}'+×]+/gu, ' ')
    .trim();

const ENERGY_LETTERS: Readonly<Record<string, EnergyType>> = {
  g: 'Grass',
  r: 'Fire',
  w: 'Water',
  l: 'Lightning',
  p: 'Psychic',
  f: 'Fighting',
  d: 'Darkness',
  m: 'Metal',
  y: 'Fairy',
  n: 'Dragon',
  c: 'Colorless',
};

const energyNamed = (value: string): EnergyType | undefined => {
  const folded = foldText(value);
  if (folded.length === 1) return ENERGY_LETTERS[folded];
  if (folded === 'dark') return 'Darkness';
  if (folded === 'electric') return 'Lightning';
  if (folded === 'steel') return 'Metal';
  if (folded === 'normal') return 'Colorless';
  return ENERGY_TYPES.find((type) => type.toLowerCase() === folded);
};

/** What `is:` values mean, as tags the catalog gives cards. */
const IS_ALIASES: Readonly<Record<string, string>> = {
  ex: 'ex',
  'pokemon ex': 'ex',
  'ex old': 'EX',
  v: 'V',
  vmax: 'VMAX',
  vstar: 'VSTAR',
  vunion: 'V-UNION',
  'v union': 'V-UNION',
  gx: 'GX',
  tera: 'Tera',
  radiant: 'Radiant',
  ace: 'ACE SPEC',
  'ace spec': 'ACE SPEC',
  acespec: 'ACE SPEC',
  prism: 'Prism Star',
  'prism star': 'Prism Star',
  star: 'Star',
  'gold star': 'Star',
  fusion: 'Fusion Strike',
  'fusion strike': 'Fusion Strike',
  single: 'Single Strike',
  'single strike': 'Single Strike',
  rapid: 'Rapid Strike',
  'rapid strike': 'Rapid Strike',
  'tag team': 'TAG TEAM',
  tagteam: 'TAG TEAM',
  'ultra beast': 'Ultra Beast',
  ub: 'Ultra Beast',
  'team plasma': 'Team Plasma',
  plasma: 'Team Plasma',
  ancient: 'Ancient',
  future: 'Future',
  mega: 'Mega',
  break: 'BREAK',
  prime: 'Prime',
  legend: 'LEGEND',
  shining: 'Shining',
  delta: 'Delta Species',
  'delta species': 'Delta Species',
  sp: 'SP',
  baby: 'Baby',
  lvx: 'Level-Up',
  'lv x': 'Level-Up',
  'level up': 'Level-Up',
  dark: 'Dark',
  light: 'Light',
  "owner's": "Owner's",
  owners: "Owner's",
  'team rocket': "Team Rocket's",
  rocket: "Team Rocket's",
  "team rocket's": "Team Rocket's",
  eternamax: 'Eternamax',
};

const RULE_BOX_TAGS = new Set([
  'ex',
  'EX',
  'GX',
  'V',
  'VMAX',
  'VSTAR',
  'V-UNION',
  'TAG TEAM',
  'Radiant',
  'Prism Star',
  'BREAK',
  'LEGEND',
  'Mega',
]);

const STAGE_ALIASES: Readonly<Record<string, string>> = {
  '0': 'Basic',
  basic: 'Basic',
  '1': 'Stage 1',
  stage1: 'Stage 1',
  'stage 1': 'Stage 1',
  '2': 'Stage 2',
  stage2: 'Stage 2',
  'stage 2': 'Stage 2',
  vmax: 'VMAX',
  vstar: 'VSTAR',
  vunion: 'V-UNION',
  'v union': 'V-UNION',
  mega: 'Mega',
  break: 'BREAK',
  restored: 'Restored',
  legend: 'LEGEND',
  levelup: 'Level-Up',
  'level up': 'Level-Up',
  lvx: 'Level-Up',
  'lv x': 'Level-Up',
};

/** `type:` words that name a kind of card rather than a Pokémon type. */
const KIND_MATCHERS: Readonly<Record<string, (card: CatalogCard) => boolean>> =
  {
    pokemon: (card) => card.category === 'Pokémon',
    pkmn: (card) => card.category === 'Pokémon',
    trainer: (card) => card.category === 'Trainer',
    energy: (card) => card.category === 'Energy',
    item: (card) => card.trainerType === 'Item',
    supporter: (card) => card.trainerType === 'Supporter',
    stadium: (card) => card.trainerType === 'Stadium',
    tool: (card) => card.trainerType === 'Tool',
    'pokemon tool': (card) => card.trainerType === 'Tool',
    tm: (card) => card.trainerType === 'Technical Machine',
    'technical machine': (card) => card.trainerType === 'Technical Machine',
    'basic energy': (card) => card.energyType === 'Basic',
    basicenergy: (card) => card.energyType === 'Basic',
    special: (card) => card.energyType === 'Special',
    'special energy': (card) => card.energyType === 'Special',
    specialenergy: (card) => card.energyType === 'Special',
  };

interface Prepared {
  readonly name: string;
  readonly text: string;
  readonly maxDamage: number;
}

const prepared = new WeakMap<CatalogCard, Prepared>();

const prepare = (card: CatalogCard): Prepared => {
  let value = prepared.get(card);
  if (!value) {
    const text = [
      ...card.abilities.flatMap((ability) => [ability.name, ability.text]),
      ...card.attacks.flatMap((attack) => [attack.name, attack.text ?? '']),
      card.text ?? '',
    ].join(' \u0000 ');
    value = {
      name: foldText(card.name),
      text: foldText(text),
      maxDamage: Math.max(
        0,
        ...card.attacks.map((attack) => Number.parseInt(attack.damage, 10) || 0)
      ),
    };
    prepared.set(card, value);
  }
  return value;
};

const compareNumbers = (
  actual: number | undefined,
  operator: QueryOperator,
  expected: number
): boolean => {
  if (actual === undefined || Number.isNaN(expected)) return false;
  switch (operator) {
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    default:
      return actual === expected;
  }
};

const compareStrings = (
  actual: string | undefined,
  operator: QueryOperator,
  expected: string
): boolean => {
  if (actual === undefined) return false;
  const order = actual.localeCompare(expected, 'en', { sensitivity: 'base' });
  switch (operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    default:
      return order === 0;
  }
};

/** "ccl" or "2" -> energy counts; undefined if neither. */
const parseCost = (
  value: string
):
  | { readonly total: number; readonly symbols?: readonly EnergyType[] }
  | undefined => {
  if (/^\d+$/u.test(value)) return { total: Number(value) };
  const symbols: EnergyType[] = [];
  for (const letter of value.toLowerCase().replaceAll(/[\s{}[\]]/gu, '')) {
    const type = ENERGY_LETTERS[letter];
    if (!type) return undefined;
    symbols.push(type);
  }
  return { total: symbols.length, symbols };
};

const countSymbols = (
  symbols: readonly EnergyType[]
): Map<EnergyType, number> => {
  const counts = new Map<EnergyType, number>();
  for (const symbol of symbols)
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  return counts;
};

/** Whether `energy` pays `cost` (any Energy pays a Colorless symbol). */
const pays = (
  energy: readonly EnergyType[],
  cost: readonly EnergyType[]
): boolean => {
  if (cost.length > energy.length) return false;
  const left = countSymbols(energy);
  let spare = energy.length;
  for (const symbol of cost) {
    if (symbol === 'Colorless') continue;
    const have = left.get(symbol) ?? 0;
    if (have === 0) return false;
    left.set(symbol, have - 1);
    spare -= 1;
  }
  const colorless = cost.filter((symbol) => symbol === 'Colorless').length;
  return spare >= colorless;
};

const includes = (
  cost: readonly EnergyType[],
  wanted: readonly EnergyType[]
): boolean => {
  const have = countSymbols(cost);
  for (const [symbol, count] of countSymbols(wanted)) {
    if ((have.get(symbol) ?? 0) < count) return false;
  }
  return true;
};

const costMatches = (
  card: CatalogCard,
  operator: QueryOperator,
  value: string
): boolean => {
  const wanted = parseCost(value);
  if (!wanted) return false;
  return card.attacks.some((attack) => {
    if (!wanted.symbols)
      return compareNumbers(attack.cost.length, operator, wanted.total);
    if (operator === '<=') return pays(wanted.symbols, attack.cost);
    if (operator === '>=') return includes(attack.cost, wanted.symbols);
    if (operator === '<')
      return (
        attack.cost.length < wanted.total && pays(wanted.symbols, attack.cost)
      );
    if (operator === '>')
      return (
        attack.cost.length > wanted.total &&
        includes(attack.cost, wanted.symbols)
      );
    return (
      attack.cost.length === wanted.symbols.length &&
      includes(attack.cost, wanted.symbols)
    );
  });
};

const contains = (
  haystack: string,
  needle: string,
  exact: boolean
): boolean => {
  const folded = foldText(needle.replaceAll('_', ' '));
  if (!folded) return true;
  if (exact) return haystack === folded;
  // Every word of the needle, in any order, as the start of a word.
  return folded
    .split(' ')
    .every(
      (word) => haystack.startsWith(word) || haystack.includes(` ${word}`)
    );
};

const phrase = (haystack: string, needle: string): boolean =>
  haystack.includes(foldText(needle.replaceAll('_', ' ')));

const valueMatches = (
  card: CatalogCard,
  clause: QueryClause,
  value: string
): boolean => {
  const { operator } = clause;
  const folded = foldText(value);
  switch (clause.field) {
    case 'name':
      return contains(prepare(card).name, value, clause.exact ?? false);
    case 'text':
      return clause.exact || value.includes('_')
        ? phrase(prepare(card).text, value)
        : contains(prepare(card).text, value, false);
    case 'is': {
      const tag = IS_ALIASES[folded] ?? IS_ALIASES[folded.replaceAll(' ', '')];
      return tag
        ? card.tags.includes(tag)
        : card.tags.some((t) => foldText(t) === folded);
    }
    case 'type': {
      const kind = KIND_MATCHERS[folded];
      if (kind) return kind(card);
      const energy = energyNamed(value);
      if (!energy) return false;
      return card.category === 'Energy'
        ? card.types.includes(energy)
        : card.types.includes(energy);
    }
    case 'stage': {
      const stage =
        STAGE_ALIASES[folded] ?? STAGE_ALIASES[folded.replaceAll(' ', '')];
      return stage !== undefined && card.stage === stage;
    }
    case 'hp':
      return compareNumbers(card.hp, operator, Number(value));
    case 'cost':
      return costMatches(card, operator, value);
    case 'damage':
      return (
        card.attacks.length > 0 &&
        compareNumbers(prepare(card).maxDamage, operator, Number(value))
      );
    case 'has':
      if (folded === 'ability') return card.abilities.length > 0;
      if (folded === 'attack' || folded === 'attacks')
        return card.attacks.length > 0;
      if (folded.replaceAll(' ', '') === 'rulebox')
        return card.tags.some((tag) => RULE_BOX_TAGS.has(tag));
      return card.abilities.some(
        (ability) => foldText(ability.kind) === folded
      );
    case 'weakness':
      return folded === 'none'
        ? !card.weakness && card.category === 'Pokémon'
        : card.weakness === energyNamed(value);
    case 'resistance':
      return folded === 'none'
        ? !card.resistance && card.category === 'Pokémon'
        : card.resistance === energyNamed(value);
    case 'retreat':
      return compareNumbers(card.retreat, operator, Number(value));
    case 'dex':
      return card.dex.some((number) =>
        compareNumbers(number, operator, Number(value))
      );
    case 'series':
      return contains(foldText(card.set.series), value, false);
    case 'set':
      return (
        foldText(card.set.code ?? '') === folded ||
        foldText(card.set.id) === folded ||
        (!clause.exact && contains(foldText(card.set.name), value, false))
      );
    case 'number':
      return operator === ':' || operator === '='
        ? foldText(card.number) === folded
        : compareNumbers(
            Number.parseInt(card.number, 10),
            operator,
            Number(value)
          );
    case 'artist':
      return contains(
        foldText(card.illustrator ?? ''),
        value,
        clause.exact ?? false
      );
    case 'rarity':
      return contains(
        foldText(card.rarity ?? ''),
        value,
        clause.exact ?? false
      );
    case 'regulation':
      return compareStrings(
        card.regulationMark,
        operator === ':' ? '=' : operator,
        value
      );
    case 'format':
      if (folded === 'standard') return card.legal.standard;
      if (folded === 'expanded') return card.legal.expanded;
      if (folded === 'unlimited') return !card.set.pocket;
      if (folded === 'pocket') return card.set.pocket ?? false;
      return false;
    case 'evolves':
      return contains(
        foldText(card.evolvesFrom ?? ''),
        value,
        clause.exact ?? false
      );
  }
};

export const matchesClause = (
  card: CatalogCard,
  clause: QueryClause
): boolean => {
  const matched = clause.all
    ? clause.values.every((value) => valueMatches(card, clause, value))
    : clause.values.some((value) => valueMatches(card, clause, value));
  return clause.negate ? !matched : matched;
};

const TYPE_ORDER = new Map<string, number>(
  ENERGY_TYPES.map((type, index) => [type, index])
);
const CATEGORY_ORDER = { Pokémon: 0, Trainer: 1, Energy: 2 } as const;

const numberParts = (value: string): readonly [string, number, string] => {
  const match = /^(\D*)(\d+)(.*)$/u.exec(value);
  return match ? [match[1]!, Number(match[2]), match[3]!] : [value, -1, ''];
};

/** Collector numbers in print order: 2 before 10, "TG7" among the TGs. */
export const compareCollectorNumbers = (
  left: string,
  right: string
): number => {
  const [leftPrefix, leftNumber, leftSuffix] = numberParts(left);
  const [rightPrefix, rightNumber, rightSuffix] = numberParts(right);
  return (
    leftPrefix.localeCompare(rightPrefix, 'en') ||
    leftNumber - rightNumber ||
    leftSuffix.localeCompare(rightSuffix, 'en')
  );
};

const bySetOrder = (left: CatalogCard, right: CatalogCard): number =>
  left.set.released.localeCompare(right.set.released) ||
  left.set.id.localeCompare(right.set.id) ||
  compareCollectorNumbers(left.number, right.number);

const sorters: Readonly<
  Record<CatalogSort, (a: CatalogCard, b: CatalogCard) => number>
> = {
  newest: (a, b) => -bySetOrder(a, b) || 0,
  oldest: bySetOrder,
  name: (a, b) => a.name.localeCompare(b.name, 'en') || bySetOrder(b, a),
  hp: (a, b) =>
    (b.hp ?? -1) - (a.hp ?? -1) || a.name.localeCompare(b.name, 'en'),
  type: (a, b) =>
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    (TYPE_ORDER.get(a.types[0] ?? '') ?? 99) -
      (TYPE_ORDER.get(b.types[0] ?? '') ?? 99) ||
    (a.trainerType ?? '').localeCompare(b.trainerType ?? '') ||
    a.name.localeCompare(b.name, 'en'),
  set: (a, b) => -bySetOrder(a, b),
};

/** Rarities of the plain printing, preferred as a card's face in results. */
const PLAIN_RARITIES = new Set([
  'common',
  'uncommon',
  'rare',
  'rare holo',
  'double rare',
  'holo rare',
  'promo',
  'none',
  'ace spec rare',
  'radiant rare',
]);

const plainness = (card: CatalogCard): number =>
  card.rarity === undefined || PLAIN_RARITIES.has(card.rarity.toLowerCase())
    ? 0
    : 1;

export interface CatalogSearchResult {
  /** In result order: one per card, or every print. */
  readonly cards: readonly CatalogCard[];
  /** Prints per print group, for "N prints" on a card. */
  readonly printCounts: ReadonlyMap<string, number>;
  readonly total: number;
}

export interface CatalogSearchOptions {
  readonly sort?: CatalogSort;
  readonly unique?: 'cards' | 'prints';
  /** Extra clauses, e.g. from the filter chips. */
  readonly clauses?: readonly QueryClause[];
}

/**
 * Runs a query over the catalog. With `unique: 'cards'` (the default) each
 * card shows once, as its newest plain printing, and knows how many prints
 * it has.
 */
export const searchCatalog = (
  cards: readonly CatalogCard[],
  query: CardQuery,
  options: CatalogSearchOptions = {}
): CatalogSearchResult => {
  const clauses = [...query.clauses, ...(options.clauses ?? [])];
  const matched =
    clauses.length === 0
      ? [...cards]
      : cards.filter((card) =>
          clauses.every((clause) => matchesClause(card, clause))
        );
  const printCounts = new Map<string, number>();
  for (const card of matched) {
    printCounts.set(
      card.printGroup,
      (printCounts.get(card.printGroup) ?? 0) + 1
    );
  }
  const unique = query.unique ?? options.unique ?? 'cards';
  let shown = matched;
  if (unique === 'cards') {
    const best = new Map<string, CatalogCard>();
    for (const card of matched) {
      const current = best.get(card.printGroup);
      if (
        !current ||
        plainness(card) < plainness(current) ||
        (plainness(card) === plainness(current) &&
          bySetOrder(card, current) > 0)
      ) {
        best.set(card.printGroup, card);
      }
    }
    shown = [...best.values()];
  }
  const sorter = sorters[query.sort ?? options.sort ?? 'newest'];
  shown.sort(sorter);
  return { cards: shown, printCounts, total: matched.length };
};

/** Every print of one card, newest first. */
export const printsOf = (
  cards: readonly CatalogCard[],
  printGroup: string
): readonly CatalogCard[] =>
  cards
    .filter((card) => card.printGroup === printGroup)
    .sort((a, b) => -bySetOrder(a, b));
