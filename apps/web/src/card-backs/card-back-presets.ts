import { STANDARD_CARD_BACK_ID } from '@ptcgsim/game-core';

/**
 * The backs shipped with the app (ADR-041): the standard back and recolours
 * of it, WebP at card size, named by their content so they are cached for a
 * year (`public/_headers`). Made from `cardback.png` with a canvas `color`
 * blend of the tint; the standard one is the PNG re-encoded.
 */
export interface CardBackPreset {
  readonly id: string;
  readonly file: string;
  /** The tint, for a swatch; the standard back has none. */
  readonly tint?: string;
}

export const CARD_BACK_PRESETS: readonly CardBackPreset[] = [
  { id: STANDARD_CARD_BACK_ID, file: 'standard.7f6de56f44.webp' },
  { id: 'crimson', file: 'crimson.ded5ececb4.webp', tint: '#c8283c' },
  { id: 'azure', file: 'azure.2af4a6791c.webp', tint: '#2f6fd6' },
  { id: 'jade', file: 'jade.8c806b4d5a.webp', tint: '#1f9a64' },
  { id: 'amber', file: 'amber.f1a4893c5a.webp', tint: '#e08a1c' },
  { id: 'violet', file: 'violet.90a0ca81d4.webp', tint: '#7a44cf' },
];

const BACKS_PATH = '/v2/assets/backs/';

const presetFiles = new Map(
  CARD_BACK_PRESETS.map((preset) => [preset.id, preset.file])
);

/** A preset's picture; an unknown one (a newer client's) is the standard. */
export const presetCardBackImage = (id: string): string =>
  `${BACKS_PATH}${presetFiles.get(id) ?? presetFiles.get(STANDARD_CARD_BACK_ID)!}`;

/** The standard back, which any back falls back to. */
export const STANDARD_CARD_BACK_IMAGE = presetCardBackImage(
  STANDARD_CARD_BACK_ID
);
