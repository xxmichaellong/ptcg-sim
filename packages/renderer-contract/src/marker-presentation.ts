import type { MarkerSceneNode } from './model.js';

/**
 * The legacy marker appearance, transcribed once.
 *
 * Both board renderers previously carried their own copy of these values in
 * their own colour format, so a correction to one silently diverged from the
 * other. Colours are expressed as 8-bit channels plus alpha and converted at
 * the edge: CSS wants `rgb()`/`rgba()`, Pixi wants a packed integer and a
 * separate alpha.
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

const rgba = (
  r: number,
  g: number,
  b: number,
  alpha: number
): LegacyMarkerColor => ({ r, g, b, alpha });

export const legacyMarkerCssColor = (color: LegacyMarkerColor): string =>
  color.alpha === 1
    ? `rgb(${color.r}, ${color.g}, ${color.b})`
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${color.alpha})`;

export const legacyMarkerPackedColor = (color: LegacyMarkerColor): number =>
  (color.r << 16) | (color.g << 8) | color.b;

const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);

/** Special-condition swatches, keyed by the upper-cased marker value. */
const LEGACY_CONDITION_SWATCHES: ReadonlyMap<
  string,
  { readonly fill: LegacyMarkerColor; readonly text: LegacyMarkerColor }
> = new Map([
  ['P', { fill: rgb(0, 128, 0), text: WHITE }],
  ['B', { fill: rgb(255, 0, 0), text: WHITE }],
  ['A', { fill: rgb(0, 0, 255), text: WHITE }],
  ['PA', { fill: rgb(255, 255, 0), text: BLACK }],
  ['C', { fill: rgb(128, 0, 128), text: WHITE }],
]);

const LEGACY_CONDITION_FALLBACK = { fill: WHITE, text: BLACK } as const;

export interface LegacyMarkerAppearance {
  readonly fill: LegacyMarkerColor;
  readonly text: LegacyMarkerColor;
  /** Ability markers are a rounded tab with no glyph; the others are circles. */
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
 * Resolves one marker's legacy appearance. Callers must only use this for nodes
 * whose `presentation` is a legacy one; generic markers keep the neutral
 * renderer styling.
 */
export const legacyMarkerAppearance = (
  marker: Pick<MarkerSceneNode, 'kind' | 'value' | 'side' | 'bounds'>
): LegacyMarkerAppearance => {
  if (marker.kind === 'damage') {
    return {
      fill: rgb(255, 98, 0),
      text: WHITE,
      shape: 'circle',
      fontSizePx: marker.bounds.width / 2,
      label: marker.value,
    };
  }
  if (marker.kind === 'specialCondition') {
    const swatch =
      LEGACY_CONDITION_SWATCHES.get(marker.value.toUpperCase()) ??
      LEGACY_CONDITION_FALLBACK;
    return {
      fill: swatch.fill,
      text: swatch.text,
      shape: 'circle',
      fontSizePx: marker.bounds.width * 0.75,
      label: marker.value,
    };
  }
  return {
    fill:
      marker.side === 'local'
        ? rgba(59, 141, 173, 0.708)
        : rgba(255, 60, 0, 0.392),
    text: BLACK,
    shape: 'tab',
    label: '',
  };
};
