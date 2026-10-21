import { describe, expect, it } from 'vitest';

import { limitlessScanOf } from './CardImage.js';

describe('card image fallback', () => {
  it("names an alternate printing's scan as Limitless does", () => {
    expect(
      limitlessScanOf({
        name: 'Gardevoir-EX',
        image: 'https://assets.tcgdex.net/en/xy/xy9/24a/high.webp',
        set: 'PHF',
        number: '24A',
      })
    ).toBe(
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/PHF/PHF_024a_R_EN.png'
    );
  });

  it("falls a thumbnail back to Limitless's small scan, not its full one", () => {
    const card = {
      name: 'Dreepy',
      image: 'https://assets.tcgdex.net/en/sv/sv06/128/low.webp',
      set: 'TWM',
      number: '128',
    };
    expect(limitlessScanOf(card, 'small')).toBe(
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_128_R_EN_SM.png'
    );
    expect(limitlessScanOf(card)).toBe(
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_128_R_EN.png'
    );
  });
});
