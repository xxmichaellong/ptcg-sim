import { describe, expect, it } from 'vitest';

import {
  getLegacyCurrentCardType,
  getLegacyOldCardType,
} from './legacy-card-type-lookup.js';
import {
  MAX_PASTED_DECKLIST_CODE_UNITS,
  MAX_PASTED_DECKLIST_LINE_CODE_UNITS,
  MAX_PASTED_DECKLIST_LINES,
  isPastedDecklistPocketSet,
  parsePastedDecklist,
  resolvePastedDecklistImageUrl,
} from './pasted-decklist.js';

const rows = (source: string, language?: 'English' | 'French') => {
  const parsed = parsePastedDecklist(source, {
    ...(language ? { language } : {}),
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Expected a parsed decklist.');
  return parsed;
};

describe('legacy card-type table copies', () => {
  it('retains current-set aliases, prefixed numbers, thresholds, and fallback', () => {
    expect(getLegacyCurrentCardType('BRS', '1')).toBe('Pokémon');
    expect(getLegacyCurrentCardType('BRS', '150')).toBe('Trainer');
    expect(getLegacyCurrentCardType('PR-SV', '85')).toBe('Pokémon');
    expect(getLegacyCurrentCardType('ASR', 'TG01')).toBe('Pokémon');
    expect(getLegacyCurrentCardType('NOPE', '1')).toBe('Unknown');
    expect(getLegacyCurrentCardType('', '')).toBe('Unknown');
  });

  it('retains old catalog-ID prefix/suffix thresholds and contains malformed IDs', () => {
    expect(getLegacyOldCardType('base1-1')).toBe('Pokémon');
    expect(getLegacyOldCardType('base1-70')).toBe('Trainer');
    expect(getLegacyOldCardType('base1-96')).toBe('Energy');
    expect(getLegacyOldCardType('sm3-112a')).toBe('Trainer');
    expect(getLegacyOldCardType('dpp-DP01')).toBe('Pokémon');
    expect(getLegacyOldCardType('bogus-1')).toBe('Unknown');
    expect(getLegacyOldCardType('malformed')).toBe('Unknown');
  });
});

describe('parsePastedDecklist', () => {
  it('reads a long line that almost names a set at once, never stalling the page', () => {
    // Thirty-six words: v1's pattern took seconds here, and doubled about
    // every word and a half after.
    const line = `1 x ${'ab1 '.repeat(34)}1!`;
    const started = performance.now();
    const parsed = rows(line);
    expect(performance.now() - started).toBeLessThan(250);
    expect(parsed.rows).toHaveLength(1);
  }, 2_000);

  it('reads a pasted file of lines ending in long runs of digits after a hyphen at once', () => {
    // v1's old-id pattern tried every split of the digits: a megabyte of
    // such lines froze the page for seconds.
    const line = `1 a -${'1'.repeat(8_180)}!`;
    const source = Array.from({ length: 120 }, () => line).join('\n');
    const started = performance.now();
    parsePastedDecklist(source);
    expect(performance.now() - started).toBeLessThan(500);
    expect(rows('4 Yanma hgss4-84').rows[0]).toMatchObject({
      name: 'Yanma',
      catalogId: 'hgss4-84',
    });
  }, 30_000);

  it('reads a short line with runs of spaces or tabs between its words at once, and as one spaced singly', () => {
    // Sixteen words, but each gap one more way to split it: v1's pattern
    // took seconds on four spaces a gap.
    for (const gap of ['    ', '\t\t\t\t', ' '.repeat(8)]) {
      const line = `1 x ${`ab1${gap}`.repeat(13)}1!`;
      const started = performance.now();
      const parsed = rows(line);
      expect(performance.now() - started, JSON.stringify(gap)).toBeLessThan(
        250
      );
      expect(parsed.rows).toHaveLength(1);
    }
    expect(
      rows('4  Iono   PAL  185\n2\tBoss’s Orders\tPAL\t172').rows.map(
        ({ quantity, name, setCode, number }) => ({
          quantity,
          name,
          setCode,
          number,
        })
      )
    ).toEqual([
      { quantity: 4, name: 'Iono', setCode: 'PAL', number: '185' },
      { quantity: 2, name: 'Boss’s Orders', setCode: 'PAL', number: '172' },
    ]);
  }, 30_000);

  it('ignores source section headings and resolves current, old-code, and catalog-ID rows', () => {
    const parsed = rows(
      `Pokémon (3)\r\n1 Arceus V BRS 122\r\n1 Base Pikachu BS 58\r\n1 Pikachu base1-58`
    );

    expect(parsed.format).toBe('legacy');
    expect(parsed.rows).toEqual([
      {
        quantity: 1,
        name: 'Arceus V',
        setCode: 'BRS',
        number: '122',
        imageUrl:
          'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_122_R_EN.png',
        cardType: 'Pokémon',
      },
      {
        quantity: 1,
        name: 'Base Pikachu',
        setCode: 'BS',
        number: '58',
        catalogId: 'base1-58',
        imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
        cardType: 'Pokémon',
      },
      {
        quantity: 1,
        name: 'Pikachu',
        catalogId: 'base1-58',
        imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
        cardType: 'Pokémon',
      },
    ]);
  });

  it('reads a name ending in a hyphenated word as the name, and an old id only when it is one', () => {
    const parsed = rows(
      [
        '4 Tapu Lele-GX',
        '2 Pikachu & Zekrom-GX',
        '1 Dawn Wings Necrozma-GX',
        '3 Shaymin-EX',
        '4 Pikachu base1-58',
        '1 Yanma hgss4-84',
        '1 Pikachu dpp-DP20',
        '1 Charizard ex sv3pt5-6',
        '1 Lugia V cel25c-15_A1',
        '1 Unown ex10-A',
        '1 Unown ex10-!',
        '1 Unown ex10-?',
      ].join('\n')
    );
    expect(parsed.rows.map(({ name, catalogId }) => [name, catalogId])).toEqual(
      [
        ['Tapu Lele-GX', undefined],
        ['Pikachu & Zekrom-GX', undefined],
        ['Dawn Wings Necrozma-GX', undefined],
        ['Shaymin-EX', undefined],
        ['Pikachu', 'base1-58'],
        ['Yanma', 'hgss4-84'],
        ['Pikachu', 'dpp-DP20'],
        ['Charizard ex', 'sv3pt5-6'],
        ['Lugia V', 'cel25c-15_A1'],
        ['Unown', 'ex10-A'],
        ['Unown', 'ex10-!'],
        ['Unown', 'ex10-?'],
      ]
    );
    expect(parsed.rows[0]).not.toHaveProperty('imageUrl');
    const unown = parsed.rows.at(-1)!;
    expect(unown.imageUrl).toBe(
      'https://images.pokemontcg.io/ex10/question_hires.png'
    );
    expect(new URL(unown.imageUrl!).search).toBe('');
  });

  it("reads a PTCGO export's bulleted card lines, and none of its headers", () => {
    const parsed = parsePastedDecklist(
      [
        '****** Pokémon Trading Card Game Deck List ******',
        '',
        '##Pokémon - 4',
        '',
        '* 4 Arceus V BRS 122',
        '',
        '##Trainer Cards - 2',
        '',
        "* 2 Professor's Research SVI 189",
        '',
        '##Energy - 1',
        '',
        '* 1 Double Turbo Energy BRS 151',
        '',
        'Total Cards - 7',
        '',
        '****** Deck List Generated by the Pokémon TCG Online www.pokemon.com/TCGO ******',
      ].join('\n')
    );
    expect(parsed.ok).toBe(true);
    expect(
      parsed.ok &&
        parsed.rows.map(({ quantity, name, setCode, number }) => ({
          quantity,
          name,
          setCode,
          number,
        }))
    ).toEqual([
      { quantity: 4, name: 'Arceus V', setCode: 'BRS', number: '122' },
      {
        quantity: 2,
        name: "Professor's Research",
        setCode: 'SVI',
        number: '189',
      },
      {
        quantity: 1,
        name: 'Double Turbo Energy',
        setCode: 'BRS',
        number: '151',
      },
    ]);
  });

  it('retains promo, gallery, Double Crisis, DPP, and no-image catalog mappings', () => {
    const parsed = rows(`1 Promo Mew PR-SV 53
1 Gallery Card BRS-TG 17
1 Double Crisis Card xy5-5 1
1 DPP Card DPP 1
1 Alternate BUS 112a`);

    expect(parsed.rows.map((row) => row.imageUrl)).toEqual([
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/SVP/SVP_053_R_EN.png',
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_TG17_R_EN.png',
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/DCR/DCR_001_R_EN.png',
      'https://images.pokemontcg.io/dpp/DP01_hires.png',
      'https://images.pokemontcg.io/sm3/112a_hires.png',
    ]);
    expect(parsed.rows[0]?.setCode).toBe('PR-SV');
    expect(parsed.rows[1]?.number).toBe('TG17');
    expect(parsed.rows[2]?.setCode).toBe('DCR');
    expect(parsed.rows[3]?.catalogId).toBe('dpp-DP01');
    expect(parsed.rows[4]?.catalogId).toBe('sm3-112a');
  });

  it('detects Pocket decks and disambiguates B2 with surrounding context', () => {
    const pocket = rows('2 Pikachu A1 96\n2 X Speed B2 2');
    expect(pocket.format).toBe('pocket');
    expect(pocket.rows[1]?.imageUrl).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/B2/B2_002_EN_SM.webp'
    );

    const legacy = rows('1 Base Pikachu BS 58\n1 Base Set 2 Card B2 17');
    expect(legacy.format).toBe('legacy');
    expect(legacy.rows[1]?.catalogId).toBe('base4-17');
    expect(legacy.rows[1]?.imageUrl).toBe(
      'https://images.pokemontcg.io/base4/17_hires.png'
    );
    expect(legacy.rows[1]?.name).toBe('Base Set 2 Card');

    const ambiguous = rows('1 B2 Card B2 1');
    expect(ambiguous.format).toBe('unknown');
    expect(ambiguous.rows[0]?.imageUrl).toContain('/pocket/B2/');
    expect(isPastedDecklistPocketSet('N1')).toBe(false);
    expect(isPastedDecklistPocketSet('P-A')).toBe(true);
  });

  it('retains TPC routing and language-specific TPCI/basic-Energy images', () => {
    const parsed = rows(
      '1 Japanese Card SV11W 1\n1 French Card BRS 2\n10 Basic Fire Energy',
      'French'
    );

    expect(parsed.rows[0]?.imageUrl).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SV11W/SV11W_1_R_JP_LG.png'
    );
    expect(parsed.rows[1]?.imageUrl).toBe(
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_002_R_FR.png'
    );
    expect(parsed.rows[2]).toEqual({
      quantity: 10,
      name: 'Basic Fire Energy',
      imageUrl:
        'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_FR.png',
      cardType: 'Energy',
    });
  });

  it('falls back to English when an untyped runtime supplies an invalid language', () => {
    const parsed = parsePastedDecklist('1 Arceus V BRS 122', {
      language: 'Klingon',
    } as never);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected a parsed decklist.');
    expect(parsed.rows[0]?.imageUrl).toBe(
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_122_R_EN.png'
    );
  });

  it('resolves provider-declared Japanese regions without a hard-coded set entry', () => {
    expect(
      resolvePastedDecklistImageUrl({
        name: 'Japanese Card',
        setCode: 'XYZZY',
        number: '7',
        region: 'tpc',
      })
    ).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/XYZZY/XYZZY_7_R_JP_LG.png'
    );
  });

  it('keeps incomplete name-only cards as editable rows without guessing metadata', () => {
    const parsed = rows(
      '\uFEFF2 Mystery Card\r\nSection 18 cards\r\n   1 Another Custom Card'
    );
    expect(parsed.format).toBe('unknown');
    expect(parsed.rows).toEqual([
      { quantity: 2, name: 'Mystery Card', cardType: 'Unknown' },
      { quantity: 1, name: 'Another Custom Card', cardType: 'Unknown' },
    ]);
    expect(Object.isFrozen(parsed.rows)).toBe(true);
    expect(Object.isFrozen(parsed.rows[0])).toBe(true);
  });

  it('fails transactionally on quantity, total, name, and token bounds', () => {
    const invalidQuantity = parsePastedDecklist('0 Missing');
    expect(invalidQuantity).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_quantity', line: 1 }],
    });

    const tooManyCards = parsePastedDecklist(
      Array.from({ length: 101 }, (_, index) => `999 Card ${index}`).join('\n')
    );
    expect(tooManyCards.ok).toBe(false);
    if (tooManyCards.ok) throw new Error('Expected an oversized deck failure.');
    expect(
      tooManyCards.issues.some(({ code }) => code === 'deck_too_large')
    ).toBe(true);

    const longName = parsePastedDecklist(`1 ${'n'.repeat(257)}`);
    expect(longName).toMatchObject({
      ok: false,
      issues: [{ code: 'name_too_long', line: 1 }],
    });

    const longToken = parsePastedDecklist(`1 Card ${'a'.repeat(129)}-1`);
    expect(longToken).toMatchObject({
      ok: false,
      issues: [{ code: 'token_too_long', line: 1 }],
    });
  });

  it('rejects oversized source, individual lines, and line counts before parsing', () => {
    expect(
      parsePastedDecklist('x'.repeat(MAX_PASTED_DECKLIST_CODE_UNITS + 1))
    ).toMatchObject({ ok: false, issues: [{ code: 'input_too_large' }] });
    expect(
      parsePastedDecklist('\n'.repeat(MAX_PASTED_DECKLIST_LINES))
    ).toMatchObject({ ok: false, issues: [{ code: 'too_many_lines' }] });
    expect(
      parsePastedDecklist(
        `Ignored heading ${'x'.repeat(MAX_PASTED_DECKLIST_LINE_CODE_UNITS)}`
      )
    ).toMatchObject({
      ok: false,
      issues: [{ code: 'line_too_long', line: 1 }],
    });
  });
});
