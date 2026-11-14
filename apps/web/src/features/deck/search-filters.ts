import {
  ENERGY_TYPES,
  foldText,
  parseCardQuery,
  type EnergyType,
  type QueryClause,
} from '@ptcgsim/deck-core';

/**
 * The More filters drawer, read from and written into the search box: each
 * control is one word of the query ("hp>=200", "ac<=RRC", "reg:H,I"), so a
 * filter typed in the box shows on its control, and one set on a control
 * shows in the box, where it can be edited or deleted like any other word.
 */
export interface SearchFilters {
  readonly hpMin: number | undefined;
  readonly hpMax: number | undefined;
  readonly retreatMax: number | undefined;
  readonly damageMin: number | undefined;
  /** The Energy an attack is payable with ("ac<="), one symbol each. */
  readonly cost: readonly EnergyType[];
  readonly ability: '' | 'yes' | 'no';
  readonly ruleBox: '' | 'yes' | 'no';
  readonly weakness: '' | EnergyType;
  readonly resistance: '' | EnergyType | 'none';
  /** Regulation marks, any of them. */
  readonly marks: readonly string[];
  /** Set codes (or ids, for a set without one), any of them. */
  readonly sets: readonly string[];
  /** Rarities as the catalog spells them, any of them. */
  readonly rarities: readonly string[];
  readonly artist: string;
  readonly evolvesFrom: string;
}

export type SearchFilterKey = keyof SearchFilters;

/** Each Energy type's letter in a typed cost: Fire is R, Fairy Y, Dragon N. */
export const ENERGY_LETTER: Readonly<Record<EnergyType, string>> = {
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

const TYPE_OF_LETTER = new Map(
  ENERGY_TYPES.map((type) => [ENERGY_LETTER[type].toLowerCase(), type])
);

const energyNamed = (value: string): EnergyType | undefined => {
  const folded = foldText(value);
  return (
    TYPE_OF_LETTER.get(folded) ??
    ENERGY_TYPES.find((type) => type.toLowerCase() === folded)
  );
};

/** Splits a query into its words, keeping quoted phrases whole. */
export const queryWords = (text: string): string[] => {
  const words: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (!quoted && /\s/u.test(character)) {
      if (current) words.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) words.push(current);
  return words;
};

/** A word's clause, read as the search reads it; none for a name word. */
const clauseOf = (word: string): QueryClause | undefined => {
  const { clauses } = parseCardQuery(word);
  const clause = clauses.length === 1 ? clauses[0] : undefined;
  return clause && clause.field !== 'name' ? clause : undefined;
};

const equals = (clause: QueryClause): boolean =>
  clause.operator === ':' || clause.operator === '=';

const number = (clause: QueryClause, strict: '<' | '>'): number | undefined => {
  const value = clause.values.length === 1 ? Number(clause.values[0]) : NaN;
  if (!Number.isInteger(value)) return undefined;
  if (clause.operator !== strict) return value;
  return strict === '>' ? value + 1 : value - 1;
};

/** Words with spaces keep together as underscores: `a:mitsuhiro_arita`. */
const spaced = (value: string): string =>
  value.trim().replaceAll('"', '').replaceAll(/\s+/gu, '_');

const unspaced = (value: string): string => value.replaceAll('_', ' ');

interface Slot<Value> {
  readonly owns: (clause: QueryClause) => boolean;
  readonly read: (clauses: readonly QueryClause[]) => Value;
  readonly word: (value: Value) => string | undefined;
}

const numberSlot = (
  field: QueryClause['field'],
  side: '<' | '>',
  alias: string
): Slot<number | undefined> => ({
  owns: (clause) =>
    clause.field === field &&
    !clause.negate &&
    (clause.operator === side || clause.operator === `${side}=`) &&
    number(clause, side) !== undefined,
  read: (clauses) => {
    const last = clauses.at(-1);
    return last ? number(last, side) : undefined;
  },
  word: (value) =>
    value === undefined ? undefined : `${alias}${side}=${value}`,
});

const hasSlot = (
  thing: 'ability' | 'rulebox',
  alias: string
): Slot<'' | 'yes' | 'no'> => ({
  owns: (clause) =>
    clause.field === 'has' &&
    equals(clause) &&
    clause.values.length === 1 &&
    foldText(clause.values[0]!).replaceAll(' ', '') === thing,
  read: (clauses) => {
    const last = clauses.at(-1);
    if (!last) return '';
    return last.negate ? 'no' : 'yes';
  },
  word: (value) =>
    value === 'yes' ? alias : value === 'no' ? `-${alias}` : undefined,
});

const listOf = (clauses: readonly QueryClause[]): string[] => [
  ...new Set(clauses.flatMap((clause) => clause.values)),
];

const SLOTS: {
  readonly [Key in SearchFilterKey]: Slot<SearchFilters[Key]>;
} = {
  hpMin: numberSlot('hp', '>', 'hp'),
  hpMax: numberSlot('hp', '<', 'hp'),
  retreatMax: numberSlot('retreat', '<', 'rc'),
  damageMin: numberSlot('damage', '>', 'dmg'),
  cost: {
    owns: (clause) =>
      clause.field === 'cost' &&
      !clause.negate &&
      clause.operator === '<=' &&
      clause.values.length === 1 &&
      [...clause.values[0]!.toLowerCase()].every((letter) =>
        TYPE_OF_LETTER.has(letter)
      ),
    read: (clauses) =>
      [...(clauses.at(-1)?.values[0]?.toLowerCase() ?? '')].map((letter) =>
        TYPE_OF_LETTER.get(letter)!
      ),
    word: (value) =>
      value.length === 0
        ? undefined
        : `ac<=${ENERGY_TYPES.flatMap((type) =>
            value
              .filter((symbol) => symbol === type)
              .map(() => ENERGY_LETTER[type])
          ).join('')}`,
  },
  ability: hasSlot('ability', 'has:ability'),
  ruleBox: hasSlot('rulebox', 'has:rulebox'),
  weakness: {
    owns: (clause) =>
      clause.field === 'weakness' &&
      !clause.negate &&
      equals(clause) &&
      clause.values.length === 1 &&
      energyNamed(clause.values[0]!) !== undefined,
    read: (clauses) => {
      const last = clauses.at(-1);
      return (last && energyNamed(last.values[0]!)) ?? '';
    },
    word: (value) => (value ? `w:${value.toLowerCase()}` : undefined),
  },
  resistance: {
    owns: (clause) =>
      clause.field === 'resistance' &&
      !clause.negate &&
      equals(clause) &&
      clause.values.length === 1 &&
      (foldText(clause.values[0]!) === 'none' ||
        energyNamed(clause.values[0]!) !== undefined),
    read: (clauses) => {
      const value = clauses.at(-1)?.values[0];
      if (value === undefined) return '';
      return foldText(value) === 'none' ? 'none' : energyNamed(value)!;
    },
    word: (value) => (value ? `rs:${value.toLowerCase()}` : undefined),
  },
  marks: {
    owns: (clause) =>
      clause.field === 'regulation' &&
      !clause.negate &&
      equals(clause) &&
      clause.values.every((value) => /^[a-z]$/iu.test(value)),
    read: (clauses) =>
      listOf(clauses)
        .map((mark) => mark.toUpperCase())
        .filter((mark, index, all) => all.indexOf(mark) === index)
        .sort(),
    word: (value) =>
      value.length === 0 ? undefined : `reg:${[...value].sort().join(',')}`,
  },
  sets: {
    owns: (clause) =>
      clause.field === 'set' && !clause.negate && equals(clause),
    read: listOf,
    // Exactly the set, not every set whose name starts so ("PAL" is not
    // Paldean Fates).
    word: (value) =>
      value.length === 0 ? undefined : `!e:${value.map(spaced).join(',')}`,
  },
  rarities: {
    owns: (clause) =>
      clause.field === 'rarity' && !clause.negate && equals(clause),
    read: (clauses) => listOf(clauses).map(unspaced),
    // Exactly the rarity: "Illustration Rare" is not Special Illustration Rare.
    word: (value) =>
      value.length === 0 ? undefined : `!r:${value.map(spaced).join(',')}`,
  },
  artist: {
    owns: (clause) =>
      clause.field === 'artist' && !clause.negate && equals(clause),
    read: (clauses) => listOf(clauses).map(unspaced).join(', '),
    word: (value) => (spaced(value) ? `a:${spaced(value)}` : undefined),
  },
  evolvesFrom: {
    owns: (clause) =>
      clause.field === 'evolves' && !clause.negate && equals(clause),
    read: (clauses) => listOf(clauses).map(unspaced).join(', '),
    word: (value) => (spaced(value) ? `from:${spaced(value)}` : undefined),
  },
};

const KEYS = Object.keys(SLOTS) as SearchFilterKey[];

const ownerOf = (word: string): SearchFilterKey | undefined => {
  const clause = clauseOf(word);
  return clause && KEYS.find((key) => SLOTS[key].owns(clause));
};

/** The drawer's controls as the query sets them. */
export const readSearchFilters = (text: string): SearchFilters => {
  const owned = new Map<SearchFilterKey, QueryClause[]>();
  for (const word of queryWords(text)) {
    const clause = clauseOf(word);
    const key =
      clause && KEYS.find((candidate) => SLOTS[candidate].owns(clause));
    if (key) owned.set(key, [...(owned.get(key) ?? []), clause]);
  }
  return Object.fromEntries(
    KEYS.map((key) => [key, SLOTS[key].read(owned.get(key) ?? [])])
  ) as unknown as SearchFilters;
};

/** How many of the drawer's controls the query sets. */
export const searchFilterCount = (text: string): number =>
  new Set(queryWords(text).map(ownerOf).filter(Boolean)).size;

/**
 * The query with one control changed: its words go, and its new word takes
 * the first one's place (or ends the query). A query ending in its word, or
 * in a space, ends in a space, to type on after.
 */
export const withSearchFilter = <Key extends SearchFilterKey>(
  text: string,
  key: Key,
  value: SearchFilters[Key]
): string => {
  const words = queryWords(text);
  const at = words.findIndex((word) => ownerOf(word) === key);
  const kept = words.filter((word) => ownerOf(word) !== key);
  const word = SLOTS[key].word(value);
  if (word) kept.splice(at >= 0 ? at : kept.length, 0, word);
  const next = kept.join(' ');
  const typingOn =
    /\s$/u.test(text) || (word !== undefined && kept.at(-1) === word);
  return next && typingOn ? `${next} ` : next;
};

/** The query without any of the drawer's words. */
export const withoutSearchFilters = (text: string): string =>
  queryWords(text)
    .filter((word) => !ownerOf(word))
    .join(' ');
