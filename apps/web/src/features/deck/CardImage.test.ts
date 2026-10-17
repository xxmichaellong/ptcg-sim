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
});
