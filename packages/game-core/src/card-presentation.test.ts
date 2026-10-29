import { describe, expect, it } from 'vitest';
import {
  isCardPresentation,
  resolveCardPresentation,
} from './card-presentation.js';

describe('card artwork metadata', () => {
  it('recognizes documented printings without guessing positions from card names', () => {
    expect(
      resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: 'https://images.pokemontcg.io/swshp/SWSH162_hires.png',
      })?.join
    ).toMatchObject({ part: 3, rows: 2, columns: 2 });
    expect(
      resolveCardPresentation({
        name: 'Lugia LEGEND',
        imageUrl: 'https://assets.tcgdex.net/en/hgss/hgss1/114/high.webp',
      })
    ).toMatchObject({
      readingQuarterTurns: 1,
      join: { part: 1, columns: 1, rows: 2 },
    });
    // Limitless's scans, as v1 files and pasted lists carry them, join the
    // same way, with the same key.
    const union = (number: string) =>
      resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/SP/SP_${number}_R_EN.png`,
      })?.join;
    expect(union('159')).toMatchObject({ part: 0, rows: 2, columns: 2 });
    expect(union('162')).toEqual({
      ...resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: 'https://images.pokemontcg.io/swshp/SWSH162_hires.png',
      })?.join,
    });
    expect(
      resolveCardPresentation({
        name: 'Lugia LEGEND',
        imageUrl:
          'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/HS/HS_114_R_EN_LG.png',
      })?.join
    ).toMatchObject({ key: 'hgss1:113:Lugia LEGEND', part: 1 });
    expect(resolveCardPresentation({ name: 'Greninja BREAK' })).toEqual({
      readingQuarterTurns: 1,
      overlay: 'upper-half',
    });
    expect(
      resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: '/unknown-print.png',
      })
    ).toBeUndefined();
    expect(resolveCardPresentation({ name: 'Legend Box' })).toBeUndefined();
  });
  it('bounds custom layouts, rejects conflicting descriptors, and permits three pieces', () => {
    expect(
      isCardPresentation({
        readingQuarterTurns: 0,
        join: { key: 'custom', columns: 3, rows: 1, part: 2 },
      })
    ).toBe(true);
    for (const join of [
      { key: ' ', columns: 2, rows: 2, part: 0 },
      { key: 'x', columns: 2, rows: 2, part: 4 },
      { key: 'x', columns: 4, rows: 4, part: 0 },
    ])
      expect(isCardPresentation({ readingQuarterTurns: 0, join })).toBe(false);
    expect(
      isCardPresentation({
        readingQuarterTurns: 0,
        overlay: 'upper-half',
        join: { key: 'x', columns: 2, rows: 1, part: 0 },
      })
    ).toBe(false);
    expect(
      resolveCardPresentation({
        name: 'Greninja BREAK',
        presentation: { readingQuarterTurns: 0 },
      })
    ).toEqual({ readingQuarterTurns: 0 });
  });
  it("joins Storm Emeralda's split Stadiums by their left and right numbers", () => {
    // TCGdex's Japanese M6 (2026-10-29): 伝説の海溝 71/72, 伝説の山頂 73/74.
    const half = (name: string, number: string) =>
      resolveCardPresentation({
        name,
        imageUrl: `https://assets.tcgdex.net/ja/m/m6/${number}/high.webp`,
      })?.join;
    expect(half('伝説の海溝', '071')).toEqual({
      key: 'm6:71:伝説の海溝',
      columns: 2,
      rows: 1,
      part: 0,
    });
    expect(half('伝説の海溝', '072')?.part).toBe(1);
    expect(half('伝説の山頂', '073')?.key).toBe('m6:73:伝説の山頂');
    expect(half('伝説の山頂', '074')?.part).toBe(1);
    // 伝説の溶岩洞 75/76 is a third pair, not yet in the fallback; the
    // catalog's English halves come from their printed rule instead.
    expect(half('伝説の溶岩洞', '075')).toBeUndefined();
    expect(half('ポケモン', '071')).toBeUndefined();
  });
});
