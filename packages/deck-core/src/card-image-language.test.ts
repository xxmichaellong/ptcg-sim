import { describe, expect, it } from 'vitest';

import {
  cardImageCandidates,
  cardImageInLanguage,
  isCardImageLanguage,
  localizeCardImageUrl,
} from './card-image-language.js';

const HOST = 'https://limitlesstcg.nyc3.digitaloceanspaces.com';
const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';

describe('localizeCardImageUrl', () => {
  it("swaps a TCGdex scan's language, at whatever size it was", () => {
    expect(
      localizeCardImageUrl(
        'https://assets.tcgdex.net/en/sv/sv06/130/high.webp',
        'fr'
      )
    ).toBe('https://assets.tcgdex.net/fr/sv/sv06/130/high.webp');
    expect(
      localizeCardImageUrl(
        'https://assets.tcgdex.net/de/me/me01/001/low.webp',
        'pt'
      )
    ).toBe('https://assets.tcgdex.net/pt/me/me01/001/low.webp');
    expect(
      localizeCardImageUrl(
        'https://assets.tcgdex.net/fr/sv/sv06/130/high.webp',
        'en'
      )
    ).toBe('https://assets.tcgdex.net/en/sv/sv06/130/high.webp');
  });

  it("swaps a Limitless international scan's language, keeping its size", () => {
    expect(
      localizeCardImageUrl(`${CDN}/tpci/TWM/TWM_130_R_EN_LG.png`, 'de')
    ).toBe(`${CDN}/tpci/TWM/TWM_130_R_DE_LG.png`);
    expect(
      localizeCardImageUrl(`${CDN}/tpci/PHF/PHF_024a_R_EN_SM.png`, 'it')
    ).toBe(`${CDN}/tpci/PHF/PHF_024a_R_IT_SM.png`);
  });

  it("takes a size-less original from Limitless's CDN at the large size", () => {
    expect(
      localizeCardImageUrl(`${HOST}/tpci/TWM/TWM_130_R_FR.png`, 'es')
    ).toBe(`${CDN}/tpci/TWM/TWM_130_R_ES_LG.png`);
    // Basic Energy: the number is the type's letter.
    expect(localizeCardImageUrl(`${HOST}/tpci/BRS/BRS_R_R_EN.png`, 'fr')).toBe(
      `${CDN}/tpci/BRS/BRS_R_R_FR_LG.png`
    );
  });

  it('leaves an address already in the language untouched', () => {
    for (const url of [
      `${HOST}/tpci/TWM/TWM_130_R_EN.png`,
      `${CDN}/tpci/TWM/TWM_130_R_EN_LG.png`,
      'https://assets.tcgdex.net/en/sv/sv06/130/high.webp',
    ])
      expect(localizeCardImageUrl(url, 'en')).toBe(url);
  });

  it('leaves every other address alone', () => {
    for (const url of [
      `${CDN}/tpc/SV6/SV6_1_R_JP_LG.png`,
      `${CDN}/pocket/A1/A1_001_EN_SM.webp`,
      'https://images.pokemontcg.io/dp1/1_hires.png',
      'https://assets.tcgdex.net/ja/SV/SV6/001/high.webp',
      '/v2/assets/cardback.png',
      'data:image/png;base64,AAAA',
      'https://example.com/en/card_R_EN.png',
      `${CDN}/tpci/TWM/TWM_130_R_EN_LG.png?signed=1`,
      '',
    ])
      expect(localizeCardImageUrl(url, 'fr')).toBe(url);
  });
});

describe('cardImageInLanguage', () => {
  it('falls back to the address as given', () => {
    expect(
      cardImageInLanguage(
        'https://assets.tcgdex.net/en/dp/dp1/1/high.webp',
        'de'
      )
    ).toEqual({
      url: 'https://assets.tcgdex.net/de/dp/dp1/1/high.webp',
      fallbackUrl: 'https://assets.tcgdex.net/en/dp/dp1/1/high.webp',
    });
    expect(cardImageInLanguage('/v2/assets/cardback.png', 'de')).toEqual({
      url: '/v2/assets/cardback.png',
    });
  });
});

describe('cardImageCandidates', () => {
  it("tries the language first, then each source's own address, once each", () => {
    expect(
      cardImageCandidates(
        'https://assets.tcgdex.net/en/sv/sv06/130/low.webp',
        `${HOST}/tpci/TWM/TWM_130_R_EN.png`,
        'fr'
      )
    ).toEqual([
      'https://assets.tcgdex.net/fr/sv/sv06/130/low.webp',
      `${CDN}/tpci/TWM/TWM_130_R_FR_LG.png`,
      'https://assets.tcgdex.net/en/sv/sv06/130/low.webp',
      `${HOST}/tpci/TWM/TWM_130_R_EN.png`,
    ]);
    expect(
      cardImageCandidates(
        'https://assets.tcgdex.net/en/sv/sv06/130/low.webp',
        undefined,
        'en'
      )
    ).toEqual(['https://assets.tcgdex.net/en/sv/sv06/130/low.webp']);
  });
});

describe('isCardImageLanguage', () => {
  it('knows the six languages', () => {
    expect(
      ['en', 'fr', 'de', 'it', 'es', 'pt'].every(isCardImageLanguage)
    ).toBe(true);
    expect(isCardImageLanguage('ja')).toBe(false);
    expect(isCardImageLanguage(undefined)).toBe(false);
  });
});
