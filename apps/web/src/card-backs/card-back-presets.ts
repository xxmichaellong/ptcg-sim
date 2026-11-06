import { STANDARD_CARD_BACK_ID } from '@ptcgsim/game-core';

/**
 * The backs shipped with the app (ADR-041 §6). Standard is the shipped
 * artwork as it is, black and silver. Each other is drawn from it part by
 * part, not tinted: its own frame with a keyline, a deep field lit behind
 * the ball with the brush strokes kept, bright swirls with a soft glow, and
 * a shaded Poké Ball that names it -- the classic, Great, Ultra, Master,
 * Net, Safari and Premier Balls, their markings following the ball's curve.
 * WebP at card size, named by their content so they are cached for a year
 * (`public/_headers`); exactly a card's shape (504x704, 63:88), as the
 * table draws every card.
 */
export interface CardBackPreset {
  readonly id: string;
  readonly file: string;
}

/** In the order the chooser shows them. Ids are stored in decks: keep them. */
export const CARD_BACK_PRESETS: readonly CardBackPreset[] = [
  { id: STANDARD_CARD_BACK_ID, file: 'standard.6261f7f137.webp' },
  { id: 'crimson', file: 'crimson.c73bf91458.webp' },
  { id: 'azure', file: 'azure.c6655e424c.webp' },
  { id: 'amber', file: 'amber.0d71401966.webp' },
  { id: 'violet', file: 'violet.4bf6a9c20f.webp' },
  { id: 'teal', file: 'teal.b82e9b2ad7.webp' },
  { id: 'jade', file: 'jade.08cc105263.webp' },
  { id: 'slate', file: 'slate.ccaedb994f.webp' },
];

/**
 * Presets that are another now: Black was the shipped artwork beside a blue
 * Standard (2026-11-05), and is Standard again since 2026-11-06.
 */
const PRESET_ALIASES: Readonly<Record<string, string>> = {
  black: STANDARD_CARD_BACK_ID,
};

/** The preset an id stands for now (an alias's, else its own). */
export const canonicalPresetId = (id: string): string =>
  PRESET_ALIASES[id] ?? id;

const BACKS_PATH = '/v2/assets/backs/';

const presetFiles = new Map(
  CARD_BACK_PRESETS.map((preset) => [preset.id, preset.file])
);

/** A preset's image; an unknown one (a newer client's) is the standard. */
export const presetCardBackImage = (id: string): string =>
  `${BACKS_PATH}${presetFiles.get(canonicalPresetId(id)) ?? presetFiles.get(STANDARD_CARD_BACK_ID)!}`;

/** The standard back, which any back falls back to. */
export const STANDARD_CARD_BACK_IMAGE = presetCardBackImage(
  STANDARD_CARD_BACK_ID
);
