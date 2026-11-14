/**
 * What a card says: a Pokémon's HP, Abilities, attacks, Weakness and so
 * on, or a Trainer's effect. The table only shows it and announces the
 * move a player picks (ADR-043); nothing reads it to enforce a rule, as
 * ADR-001 keeps the table manual.
 *
 * A catalogued card's text is the catalog's, looked up by its print
 * (`CardDefinition.print`), so it never travels with the deck. A card a
 * player made, or edited to play differently, carries its own: that is
 * this. Every field is bounded, so a deck of such cards still fits in one
 * message.
 */

export const CARD_TEXT_ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
  'Dragon',
  'Colorless',
] as const;
export type CardTextEnergyType = (typeof CARD_TEXT_ENERGY_TYPES)[number];

export interface CardTextAbility {
  readonly name: string;
  /** "Ability", "Poké-Power", "Poké-Body", "Ancient Trait", … */
  readonly kind: string;
  readonly text: string;
}

export interface CardTextAttack {
  readonly name: string;
  readonly cost: readonly CardTextEnergyType[];
  /** As printed: "120", "30+", "60×", or "" for none. */
  readonly damage: string;
  readonly text?: string;
}

export interface CardText {
  readonly hp?: number;
  readonly types?: readonly CardTextEnergyType[];
  /** "Basic", "Stage 1", "Stage 2", "VMAX", … */
  readonly stage?: string;
  readonly evolvesFrom?: string;
  readonly abilities?: readonly CardTextAbility[];
  readonly attacks?: readonly CardTextAttack[];
  readonly weakness?: CardTextEnergyType;
  /** As printed: "×2", "+20". */
  readonly weaknessValue?: string;
  readonly resistance?: CardTextEnergyType;
  /** As printed: "-30". */
  readonly resistanceValue?: string;
  readonly retreat?: number;
  /** A Trainer's or Special Energy's effect, and any rule box lines. */
  readonly rules?: string;
}

/** The most each field may hold, in UTF-16 code units or entries. */
export const CARD_TEXT_LIMITS = Object.freeze({
  name: 64,
  kind: 32,
  stage: 32,
  damage: 8,
  modifier: 8,
  moveText: 600,
  rules: 1_000,
  abilities: 4,
  attacks: 4,
  cost: 8,
  types: 3,
  hp: 2_000,
  retreat: 8,
});

const ENERGY: ReadonlySet<unknown> = new Set(CARD_TEXT_ENERGY_TYPES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, maximum: number, empty = false): boolean =>
  typeof value === 'string' &&
  value.length <= maximum &&
  (empty || value.trim().length > 0);

const optionalText = (value: unknown, maximum: number): boolean =>
  value === undefined || isText(value, maximum);

const isCount = (value: unknown, maximum: number): boolean =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= maximum;

const onlyKeys = (
  value: Record<string, unknown>,
  keys: ReadonlySet<string>
): boolean => Object.keys(value).every((key) => keys.has(key));

const ABILITY_KEYS = new Set(['name', 'kind', 'text']);
const ATTACK_KEYS = new Set(['name', 'cost', 'damage', 'text']);
const TEXT_KEYS = new Set([
  'hp',
  'types',
  'stage',
  'evolvesFrom',
  'abilities',
  'attacks',
  'weakness',
  'weaknessValue',
  'resistance',
  'resistanceValue',
  'retreat',
  'rules',
]);

const isAbility = (value: unknown): value is CardTextAbility =>
  isRecord(value) &&
  onlyKeys(value, ABILITY_KEYS) &&
  isText(value.name, CARD_TEXT_LIMITS.name) &&
  isText(value.kind, CARD_TEXT_LIMITS.kind) &&
  isText(value.text, CARD_TEXT_LIMITS.moveText, true);

const isAttack = (value: unknown): value is CardTextAttack =>
  isRecord(value) &&
  onlyKeys(value, ATTACK_KEYS) &&
  isText(value.name, CARD_TEXT_LIMITS.name) &&
  Array.isArray(value.cost) &&
  value.cost.length <= CARD_TEXT_LIMITS.cost &&
  value.cost.every((type) => ENERGY.has(type)) &&
  isText(value.damage, CARD_TEXT_LIMITS.damage, true) &&
  optionalText(value.text, CARD_TEXT_LIMITS.moveText);

/**
 * Whether a value is card text the table takes: only its fields, each in
 * bounds, and something in it.
 */
export const isCardText = (value: unknown): value is CardText => {
  if (!isRecord(value) || !onlyKeys(value, TEXT_KEYS)) return false;
  if (Object.keys(value).length === 0) return false;
  if (value.hp !== undefined && !isCount(value.hp, CARD_TEXT_LIMITS.hp))
    return false;
  if (
    value.types !== undefined &&
    !(
      Array.isArray(value.types) &&
      value.types.length <= CARD_TEXT_LIMITS.types &&
      value.types.every((type) => ENERGY.has(type))
    )
  )
    return false;
  if (!optionalText(value.stage, CARD_TEXT_LIMITS.stage)) return false;
  if (!optionalText(value.evolvesFrom, CARD_TEXT_LIMITS.name)) return false;
  if (
    value.abilities !== undefined &&
    !(
      Array.isArray(value.abilities) &&
      value.abilities.length <= CARD_TEXT_LIMITS.abilities &&
      value.abilities.every(isAbility)
    )
  )
    return false;
  if (
    value.attacks !== undefined &&
    !(
      Array.isArray(value.attacks) &&
      value.attacks.length <= CARD_TEXT_LIMITS.attacks &&
      value.attacks.every(isAttack)
    )
  )
    return false;
  if (value.weakness !== undefined && !ENERGY.has(value.weakness)) return false;
  if (value.resistance !== undefined && !ENERGY.has(value.resistance))
    return false;
  if (!optionalText(value.weaknessValue, CARD_TEXT_LIMITS.modifier))
    return false;
  if (!optionalText(value.resistanceValue, CARD_TEXT_LIMITS.modifier))
    return false;
  if (
    value.retreat !== undefined &&
    !isCount(value.retreat, CARD_TEXT_LIMITS.retreat)
  )
    return false;
  return optionalText(value.rules, CARD_TEXT_LIMITS.rules);
};

/** A move's name as an announcement carries it: one line, bounded. */
export const isMoveName = (value: unknown): value is string =>
  isText(value, CARD_TEXT_LIMITS.name) && !/[\r\n]/u.test(value as string);

/**
 * The text in one canonical form (fields in a fixed order, absent ones
 * left out), so two definitions saying the same compare equal.
 */
export const canonicalCardText = (text: CardText): string =>
  JSON.stringify(text, [
    ...TEXT_KEYS,
    ...ABILITY_KEYS,
    ...ATTACK_KEYS,
  ] as string[]);

export const sameCardText = (
  left: CardText | undefined,
  right: CardText | undefined
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    canonicalCardText(left) === canonicalCardText(right));

/**
 * A print id as the catalog keys it ("PAL 185"): a set code and a number,
 * one space apart.
 */
export const isCardPrint = (value: unknown): value is string =>
  typeof value === 'string' && /^\S{1,32} \S{1,24}$/u.test(value);
