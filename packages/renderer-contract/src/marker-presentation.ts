import type { MarkerSceneNode } from './model.js';

/**
 * How board markers look: the real accessories (ADR-027). Damage is a counter
 * disc in the colour of the physical counter for its band -- yellow 10,
 * orange 50, red 100 -- and special conditions are chips: the current-era
 * Burn and Poison markers, and Zzz, lightning and swirl chips for the three
 * conditions the table shows by turning the card.
 *
 * Both board renderers read this one description. Colours are 8-bit channels
 * plus alpha, converted at the edge: CSS wants `rgb()`/`rgba()`, Pixi wants a
 * packed integer and a separate alpha. The DOM renderer paints them through
 * `var()` with these values as fallbacks, so the app's tokens can retune them.
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

export const legacyMarkerPackedColor = (color: LegacyMarkerColor): number =>
  (color.r << 16) | (color.g << 8) | color.b;

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
  | 'ability-used';

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
  // Orchid with navy goo rising from the bottom, after the rulebook marker.
  poisoned: {
    face: 'poisoned',
    fill: rgb(178, 120, 180),
    rim: rgb(42, 43, 85),
    ink: INK,
    art: rgb(49, 48, 94),
    scale: 1,
  },
  // Tan with a crimson three-tongued flame.
  burned: {
    face: 'burned',
    fill: rgb(211, 167, 87),
    rim: rgb(168, 50, 58),
    ink: INK,
    art: rgb(163, 44, 55),
    scale: 1,
  },
  asleep: {
    face: 'asleep',
    fill: rgb(47, 63, 158),
    rim: rgb(28, 38, 104),
    ink: rgb(244, 239, 207),
    scale: 1,
  },
  // Charcoal, so it never reads as a yellow 10 counter.
  paralyzed: {
    face: 'paralyzed',
    fill: rgb(43, 43, 48),
    rim: rgb(17, 17, 20),
    ink: rgb(255, 214, 10),
    scale: 1,
  },
  confused: {
    face: 'confused',
    fill: rgb(15, 124, 120),
    rim: rgb(11, 80, 78),
    ink: WHITE,
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
  return { ...ABILITY_FACE, label: 'Ability' };
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

export interface LegacyMarkerAppearance {
  readonly fill: LegacyMarkerColor;
  readonly text: LegacyMarkerColor;
  /** Ability markers are a rounded tab; the others are circles. */
  readonly shape: 'circle' | 'tab';
  /** Omitted when the marker draws no text. */
  readonly fontSizePx?: number;
  readonly label: string;
}

export const isLegacyMarkerPresentation = (
  presentation: MarkerSceneNode['presentation']
): boolean =>
  presentation === 'legacyActiveQ0' || presentation === 'legacyBenchQ0';

/**
 * A marker as one flat colour and its typed text: what a renderer without the
 * token artwork paints (the Pixi spike), and what the in-place marker editor
 * previews while a value is typed. Callers must only use this for nodes whose
 * `presentation` is a legacy one.
 */
export const legacyMarkerAppearance = (
  marker: Pick<MarkerSceneNode, 'kind' | 'value' | 'side' | 'bounds'>
): LegacyMarkerAppearance => {
  const face = markerFace(marker);
  if (marker.kind === 'abilityUsed') {
    return { fill: face.fill, text: face.ink, shape: 'tab', label: '' };
  }
  return {
    fill: face.fill,
    text: face.ink,
    shape: 'circle',
    fontSizePx: markerLabelFontSizePx(
      marker.bounds.width * face.scale,
      marker.value
    ),
    label: marker.value,
  };
};
