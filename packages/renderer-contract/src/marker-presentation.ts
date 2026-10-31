import { t } from '@lingui/core/macro';
import type { MarkerSceneNode } from './model.js';

/**
 * How board markers look: the real accessories (ADR-027). Damage is a counter
 * disc in the colour of the physical counter for its band -- yellow 10,
 * orange 50, red 100 -- and special conditions are the official chips: the
 * current Burn and Poison markers' art, and the same set's Zzz, jolt and
 * swirl for the three conditions the table shows by turning the card.
 *
 * The board renderer reads this one description. Colours are 8-bit channels
 * plus alpha, converted to `rgb()`/`rgba()` at the edge. The DOM renderer
 * paints them through `var()` with these values as fallbacks, so the app's
 * tokens can retune them.
 */
export interface LegacyMarkerColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

const rgb = (r: number, g: number, b: number): LegacyMarkerColor => ({
  r,
  g,
  b,
  alpha: 1,
});

export const legacyMarkerCssColor = (color: LegacyMarkerColor): string =>
  color.alpha === 1
    ? `rgb(${color.r}, ${color.g}, ${color.b})`
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${color.alpha})`;

/** The three physical damage counters; a total is shown on the largest it reaches. */
export type DamageCounterBand = 10 | 50 | 100;

/** Conditions with a chip of their own; anything else typed is shown as text. */
export type SpecialConditionKind =
  'poisoned' | 'burned' | 'asleep' | 'paralyzed' | 'confused';

export type MarkerFaceKind =
  | 'damage-10'
  | 'damage-50'
  | 'damage-100'
  | SpecialConditionKind
  | 'condition-note'
  | 'ability-used'
  | 'reminder';

export interface MarkerFace {
  readonly face: MarkerFaceKind;
  /** The token's face colour. */
  readonly fill: LegacyMarkerColor;
  /** The darker edge that makes it read as a physical disc. */
  readonly rim: LegacyMarkerColor;
  /** Text or glyph colour; at least 4.5:1 against `fill` (WCAG AA). */
  readonly ink: LegacyMarkerColor;
  /** The printed artwork colour (flame, goo), when the chip has artwork. */
  readonly art?: LegacyMarkerColor;
  /** Text painted on the token; empty when the artwork carries the meaning. */
  readonly label: string;
  /** Painted diameter relative to the marker's bounds. */
  readonly scale: number;
  /** Design token the DOM renderer lets override `fill`. */
  readonly fillToken?: string;
}

const INK = rgb(23, 18, 10);
const WHITE = rgb(255, 255, 255);

/**
 * The real counters' colours (the Japanese how-to-play sheet). Contrast of
 * the ink: 16:1 on yellow, 7.5:1 on orange, and white on red 4.8:1 -- black
 * on that red would only reach 4.4:1.
 */
const DAMAGE_FACES: Readonly<
  Record<DamageCounterBand, Omit<MarkerFace, 'label'>>
> = {
  10: {
    face: 'damage-10',
    fill: rgb(255, 225, 0),
    rim: rgb(214, 182, 0),
    ink: INK,
    scale: 0.84,
    fillToken: '--ptcgsim-counter-10',
  },
  50: {
    face: 'damage-50',
    fill: rgb(239, 122, 0),
    rim: rgb(190, 92, 0),
    ink: INK,
    scale: 0.92,
    fillToken: '--ptcgsim-counter-50',
  },
  100: {
    face: 'damage-100',
    fill: rgb(231, 0, 18),
    rim: rgb(150, 0, 12),
    ink: WHITE,
    scale: 1,
    fillToken: '--ptcgsim-counter-100',
  },
};

const CONDITION_FACES: Readonly<
  Record<SpecialConditionKind | 'condition-note', Omit<MarkerFace, 'label'>>
> = {
  // The official chips (the Pokémon TCG Pocket icons, the art of the current
  // physical markers), each with the gold rim the physical ones have. The
  // DOM renderer paints the art itself when the app supplies it; these are
  // the colours for anything that draws them.
  // Pink with purple goo rising from the bottom.
  poisoned: {
    face: 'poisoned',
    fill: rgb(212, 128, 177),
    rim: rgb(196, 160, 82),
    ink: INK,
    art: rgb(105, 48, 141),
    scale: 1,
  },
  // Orange with a red flame.
  burned: {
    face: 'burned',
    fill: rgb(245, 173, 84),
    rim: rgb(196, 160, 82),
    ink: INK,
    // A shade deeper than the art's red, to read on the orange (3:1).
    art: rgb(190, 0, 16),
    scale: 1,
  },
  // Sky blue, Zzz over a blue wave.
  asleep: {
    face: 'asleep',
    fill: rgb(135, 206, 228),
    rim: rgb(196, 160, 82),
    ink: rgb(0, 74, 135),
    scale: 1,
  },
  // Yellow with an amber jolt.
  paralyzed: {
    face: 'paralyzed',
    fill: rgb(250, 238, 66),
    rim: rgb(196, 160, 82),
    ink: rgb(150, 92, 0),
    scale: 1,
  },
  // Pale green with a green swirl.
  confused: {
    face: 'confused',
    fill: rgb(180, 213, 128),
    rim: rgb(196, 160, 82),
    ink: rgb(10, 90, 40),
    scale: 1,
  },
  // Whatever else a player typed, on a plain ivory chip.
  'condition-note': {
    face: 'condition-note',
    fill: rgb(243, 239, 228),
    rim: rgb(138, 131, 112),
    ink: rgb(26, 24, 20),
    scale: 1,
  },
};

/** The red "Ability" lozenge printed on cards, with a check for "used". */
const ABILITY_FACE: Omit<MarkerFace, 'label'> = {
  face: 'ability-used',
  fill: rgb(200, 23, 30),
  rim: WHITE,
  ink: WHITE,
  scale: 1,
};

/**
 * A reminder a player put on a Pokémon (game-core STACK_REMINDERS): a slate
 * chip with a navy rim, its glyph (MarkerNode) in navy ink, 11:1 on the
 * fill -- set apart from the official condition chips' gold rims.
 */
const REMINDER_FACE: Omit<MarkerFace, 'label'> = {
  face: 'reminder',
  fill: rgb(228, 234, 244),
  rim: rgb(58, 80, 122),
  ink: rgb(22, 38, 70),
  scale: 1,
};

/** What a reminder says, by its key (game-core STACK_REMINDERS). */
export const reminderName = (reminder: string): string => {
  switch (reminder) {
    case 'cantAttack':
      return t({
        message: "Can't attack",
        comment: 'A reminder on a Pokémon: an effect stops it attacking.',
      });
    case 'cantRetreat':
      return t({
        message: "Can't retreat",
        comment: 'A reminder on a Pokémon: an effect stops it retreating.',
      });
    case 'takesLess':
      return t({
        message: 'Takes less damage',
        comment:
          'A reminder on a Pokémon: an effect reduces the damage it takes.',
      });
    case 'hitsHarder':
      return t({
        message: 'Attacks do more',
        comment:
          "A reminder on a Pokémon: an effect raises its attacks' damage.",
      });
    case 'noAbilities':
      return t({
        message: 'No Abilities',
        comment: 'A reminder on a Pokémon: an effect stops its Abilities.',
      });
    default:
      return reminder;
  }
};

/**
 * The counter a damage total is painted on: the biggest physical counter it
 * reaches. A value that is not a number keeps the smallest counter.
 */
export const damageCounterBand = (value: string): DamageCounterBand => {
  const damage = Number.parseInt(value, 10);
  if (!Number.isFinite(damage)) return 10;
  if (damage >= 100) return 100;
  if (damage >= 50) return 50;
  return 10;
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
 * Reads a typed special condition. v1's letters (P, B, A, PA, C) and the
 * words are recognised whatever their case; anything else has no chip.
 */
export const specialConditionKind = (
  value: string
): SpecialConditionKind | null =>
  CONDITION_ALIASES.get(value.trim().toLowerCase()) ?? null;

/** Resolves the token a marker is painted as. */
export const markerFace = (
  marker: Pick<MarkerSceneNode, 'kind' | 'value'>
): MarkerFace => {
  if (marker.kind === 'damage') {
    return {
      ...DAMAGE_FACES[damageCounterBand(marker.value)],
      label: marker.value,
    };
  }
  if (marker.kind === 'specialCondition') {
    const kind = specialConditionKind(marker.value);
    return kind
      ? { ...CONDITION_FACES[kind], label: '' }
      : { ...CONDITION_FACES['condition-note'], label: marker.value.trim() };
  }
  if (marker.kind === 'reminder') return { ...REMINDER_FACE, label: '' };
  return {
    ...ABILITY_FACE,
    label: t({
      message: 'Ability',
      comment: 'Printed on the marker of a Pokémon whose Ability was used.',
    }),
  };
};

/**
 * What a marker's tooltip says: the damage on the Pokémon, the condition by
 * name (or the note a player typed), that its Ability was used, or what a
 * reminder reminds of.
 */
export const markerHint = (
  marker: Pick<MarkerSceneNode, 'kind' | 'value'>
): string => {
  if (marker.kind === 'damage') {
    return t({
      message: `${marker.value} damage`,
      comment: 'Tooltip of a damage counter on a Pokémon, e.g. "60 damage".',
    });
  }
  if (marker.kind === 'abilityUsed') {
    return t({
      message: 'Ability used',
      comment: 'Tooltip of the marker on a Pokémon whose Ability was used.',
    });
  }
  if (marker.kind === 'reminder') {
    const name = reminderName(marker.value);
    return t({
      message: `Reminder: ${name}`,
      comment:
        'Tooltip of a reminder chip on a Pokémon, e.g. "Reminder: Can\'t attack". {name} is what it reminds of.',
    });
  }
  switch (specialConditionKind(marker.value)) {
    case 'poisoned':
      return t({ message: 'Poisoned', context: 'special condition' });
    case 'burned':
      return t({ message: 'Burned', context: 'special condition' });
    case 'asleep':
      return t({ message: 'Asleep', context: 'special condition' });
    case 'paralyzed':
      return t({ message: 'Paralyzed', context: 'special condition' });
    case 'confused':
      return t({ message: 'Confused', context: 'special condition' });
    case null:
      return marker.value.trim();
  }
};

/**
 * Label size for a token of `diameter` pixels: two digits fill the disc, and
 * longer labels shrink so that up to four digits ("9990") still fit inside it.
 */
export const markerLabelFontSizePx = (
  diameter: number,
  label: string
): number => {
  const length = [...label].length;
  const ratio =
    length <= 2
      ? 0.46
      : length === 3
        ? 0.38
        : length === 4
          ? 0.3
          : Math.max(0.16, 1.2 / length);
  return diameter * ratio;
};
