import { STANDARD_CARD_BACK_ID } from '@ptcgsim/game-core';

/**
 * The backs shipped with the app (ADR-041 §6): the shipped back's artwork
 * recolored as duotones -- each pixel's lightness picks a color between a
 * dark field and a light swirl, so the texture stays and nothing is neon --
 * WebP at card size, named by their content so they are cached for a year
 * (`public/_headers`). Standard is a card back's deep blue, which reads on
 * every mat by day and by night; Black is the artwork as it was (the
 * standard back until 2026-11-05). Exactly a card's shape (504x704, 63:88),
 * as the table draws every card.
 */
export interface CardBackPreset {
  readonly id: string;
  readonly file: string;
}

export const CARD_BACK_PRESETS: readonly CardBackPreset[] = [
  { id: STANDARD_CARD_BACK_ID, file: 'standard.a3f807b541.webp' },
  { id: 'black', file: 'black.6261f7f137.webp' },
  { id: 'azure', file: 'azure.618b7440ba.webp' },
  { id: 'teal', file: 'teal.10dff3b302.webp' },
  { id: 'jade', file: 'jade.94c82cf8a1.webp' },
  { id: 'amber', file: 'amber.b0a6cae968.webp' },
  { id: 'crimson', file: 'crimson.935d160a6d.webp' },
  { id: 'violet', file: 'violet.933001c8df.webp' },
  { id: 'slate', file: 'slate.694165cf99.webp' },
];

const BACKS_PATH = '/v2/assets/backs/';

const presetFiles = new Map(
  CARD_BACK_PRESETS.map((preset) => [preset.id, preset.file])
);

/** A preset's image; an unknown one (a newer client's) is the standard. */
export const presetCardBackImage = (id: string): string =>
  `${BACKS_PATH}${presetFiles.get(id) ?? presetFiles.get(STANDARD_CARD_BACK_ID)!}`;

/** The standard back, which any back falls back to. */
export const STANDARD_CARD_BACK_IMAGE = presetCardBackImage(
  STANDARD_CARD_BACK_ID
);
