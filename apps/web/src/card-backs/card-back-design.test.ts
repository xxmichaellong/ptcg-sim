import {
  CARD_BACK_COLOURS,
  CARD_BACK_EMBLEMS,
  CARD_BACK_PATTERNS,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  CARD_BACK_COLOUR_HEX,
  cardBackDesignImage,
  cardBackDesignSvg,
} from './card-back-design.js';

describe('designed card backs', () => {
  it('draws every pattern and emblem as one SVG in the card’s shape, the same each time', () => {
    for (const pattern of CARD_BACK_PATTERNS) {
      for (const emblem of CARD_BACK_EMBLEMS) {
        const design = {
          base: 'navy',
          pattern,
          accent: 'gold',
          emblem,
        } as const;
        const svg = cardBackDesignSvg(design);
        expect(
          svg.startsWith(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 630 880">'
          ),
          `${pattern} ${emblem}`
        ).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).toContain(CARD_BACK_COLOUR_HEX.navy);
        expect(svg).not.toMatch(/<script|on\w+=|href=/u);
        expect(cardBackDesignSvg(design)).toBe(svg);
      }
    }
  });

  it('has a colour for every colour a reference may name', () => {
    for (const colour of CARD_BACK_COLOURS) {
      expect(CARD_BACK_COLOUR_HEX[colour]).toMatch(/^#[0-9a-f]{6}$/u);
    }
    expect(
      cardBackDesignImage({
        base: 'ink',
        pattern: 'plain',
        accent: 'snow',
        emblem: 'none',
      })
    ).toMatch(/^data:image\/svg\+xml,%3Csvg/u);
  });
});
