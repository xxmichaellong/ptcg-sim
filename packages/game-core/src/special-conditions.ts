import type { SpecialCondition } from './model.js';

/**
 * Special Conditions on the Active Pokémon (ADR-043 §14). The game's rules: Asleep,
 * Confused and Paralyzed are shown by turning the card, so a Pokémon has at
 * most one of them and a new one replaces the old; Burned and Poisoned are
 * markers, and either or both can be on beside one of the three. Moving to
 * the Bench, evolving and devolving take them all off (the stack's marker is
 * cleared there, as before).
 *
 * The stack keeps them in its one marker string, as it always has: v1's typed
 * marker (a letter such as P, a word such as Poisoned, or anything else
 * typed), and now several conditions written as their codes in checkup order
 * ("P B Pa"). So stored games, replays and saves read as they were, and a
 * client from before reads several as one typed marker. A marker names
 * conditions only when every part names one and together they are legal;
 * anything else is a typed note, which stands alone.
 */

export type SpecialConditionKind =
  'poisoned' | 'burned' | 'asleep' | 'paralyzed' | 'confused';

/** In checkup order (Poisoned, Burned, Asleep, Paralyzed), Confused last. */
export const SPECIAL_CONDITIONS: readonly SpecialConditionKind[] = [
  'poisoned',
  'burned',
  'asleep',
  'paralyzed',
  'confused',
];

/** The three shown by turning the card: one at a time. */
export const ROTATION_CONDITIONS: readonly SpecialConditionKind[] = [
  'asleep',
  'paralyzed',
  'confused',
];

/** v1's letters, as the keys' cycle and the typed editor write them. */
export const SPECIAL_CONDITION_CODES: Readonly<
  Record<SpecialConditionKind, string>
> = {
  poisoned: 'P',
  burned: 'B',
  asleep: 'A',
  paralyzed: 'Pa',
  confused: 'C',
};

const CONDITION_ALIASES: ReadonlyMap<string, SpecialConditionKind> = new Map(
  (
    [
      ['poisoned', ['p', 'psn', 'poison', 'poisoned']],
      ['burned', ['b', 'brn', 'burn', 'burned', 'burnt']],
      ['asleep', ['a', 's', 'z', 'zz', 'zzz', 'slp', 'sleep', 'asleep']],
      [
        'paralyzed',
        ['pa', 'par', 'prz', 'para', 'paralyzed', 'paralysed', 'paralysis'],
      ],
      ['confused', ['c', 'cnf', 'conf', 'confused', 'confusion']],
    ] as const
  ).flatMap(([kind, aliases]) => aliases.map((alias) => [alias, kind] as const))
);

/**
 * Reads one typed condition. v1's letters (P, B, A, PA, C) and the words are
 * recognised whatever their case; anything else is no condition.
 */
export const specialConditionKind = (
  value: string
): SpecialConditionKind | null =>
  CONDITION_ALIASES.get(value.trim().toLowerCase()) ?? null;

const tokensOf = (value: string): string[] =>
  value
    .trim()
    .split(/[\s,+/&]+/u)
    .filter((token) => token !== '');

const isRotation = (kind: SpecialConditionKind): boolean =>
  ROTATION_CONDITIONS.includes(kind);

/** Whether conditions may stand together: none twice, one turning at most. */
const legalTogether = (kinds: readonly SpecialConditionKind[]): boolean =>
  new Set(kinds).size === kinds.length && kinds.filter(isRotation).length <= 1;

/**
 * Each part of a marker as written: none for no marker; each condition's
 * token when every part names one and they may stand together; otherwise the
 * whole marker, a typed note.
 */
export const specialConditionParts = (
  value: SpecialCondition | null | undefined
): readonly string[] => {
  if (!value || value.trim() === '') return [];
  const tokens = tokensOf(value);
  if (tokens.length < 2) return [value.trim()];
  const kinds = tokens.map(specialConditionKind);
  return kinds.every((kind) => kind !== null) &&
    legalTogether(kinds as SpecialConditionKind[])
    ? tokens
    : [value.trim()];
};

/** The conditions a marker names, in checkup order; none for a note. */
export const specialConditionKinds = (
  value: SpecialCondition | null | undefined
): readonly SpecialConditionKind[] => {
  const parts = specialConditionParts(value);
  const kinds = parts.map(specialConditionKind);
  if (kinds.length === 0 || kinds.some((kind) => kind === null)) return [];
  return SPECIAL_CONDITIONS.filter((kind) => kinds.includes(kind));
};

/**
 * Whether a marker breaks the rules: every part names a condition but they
 * may not stand together (two of the turning three, one twice). Anything else
 * typed is a note and may stand.
 */
export const breaksSpecialConditionRules = (value: string): boolean => {
  const tokens = tokensOf(value);
  if (tokens.length < 2) return false;
  const kinds = tokens.map(specialConditionKind);
  return (
    kinds.every((kind) => kind !== null) &&
    !legalTogether(kinds as SpecialConditionKind[])
  );
};

/** Conditions written as a marker: codes in checkup order; none: null. */
export const writeSpecialConditions = (
  kinds: Iterable<SpecialConditionKind>
): SpecialCondition | null => {
  const chosen = new Set(kinds);
  const written = SPECIAL_CONDITIONS.filter((kind) => chosen.has(kind)).map(
    (kind) => SPECIAL_CONDITION_CODES[kind]
  );
  return written.length === 0 ? null : written.join(' ');
};

/**
 * The marker with `kind` turned on or off. On, it takes off a typed note and
 * whichever other of the turning three is on; off, it leaves the rest.
 */
export const toggleSpecialCondition = (
  value: SpecialCondition | null | undefined,
  kind: SpecialConditionKind,
  on: boolean
): SpecialCondition | null => {
  const current = specialConditionKinds(value);
  const kept = current.filter(
    (other) => other !== kind && !(on && isRotation(kind) && isRotation(other))
  );
  return writeSpecialConditions(on ? [...kept, kind] : kept);
};

/**
 * A marker as the table keeps it: several conditions in their canonical
 * order and spelling; one condition or a note as typed.
 */
export const normalizeSpecialCondition = (
  value: SpecialCondition
): SpecialCondition => {
  const parts = specialConditionParts(value);
  if (parts.length < 2) return value.trim();
  return writeSpecialConditions(specialConditionKinds(value)) ?? value.trim();
};
