import {
  isCoinValue,
  parseCardBack,
  type CardBackDesign,
} from '@ptcgsim/game-core';
import { cardBackDesignImage } from './card-back-design.js';

export const STANDARD_COIN_HEADS = '/v2/assets/table/coin-heads.webp';
export const STANDARD_COIN_TAILS = '/v2/assets/table/coin-tails.webp';

const PRESETS: Readonly<Record<string, CardBackDesign>> = {
  crimson: {
    base: 'crimson',
    pattern: 'rays',
    accent: 'cream',
    emblem: 'ball-poke',
  },
  azure: {
    base: 'navy',
    pattern: 'waves',
    accent: 'sky',
    emblem: 'ball-great',
  },
  amber: { base: 'ink', pattern: 'rays', accent: 'gold', emblem: 'ball-ultra' },
  violet: {
    base: 'plum',
    pattern: 'swirl',
    accent: 'lavender',
    emblem: 'ball-master',
  },
  teal: { base: 'ocean', pattern: 'grid', accent: 'mint', emblem: 'ball-net' },
  jade: {
    base: 'forest',
    pattern: 'dots',
    accent: 'sand',
    emblem: 'ball-safari',
  },
  slate: {
    base: 'snow',
    pattern: 'plain',
    accent: 'crimson',
    emblem: 'ball-premier',
  },
};

/** Custom heads, with the same art struck in silver on the reverse. */
export const coinImage = (value: string | undefined): string => {
  if (!isCoinValue(value)) return STANDARD_COIN_HEADS;
  const parsed = parseCardBack(value)!;
  if (parsed.kind === 'image') return `/v2/images/${parsed.sha256}`;
  const design =
    parsed.kind === 'design'
      ? parsed.design
      : parsed.kind === 'preset'
        ? PRESETS[parsed.id]
        : undefined;
  return design ? cardBackDesignImage(design, 'coin') : STANDARD_COIN_HEADS;
};
