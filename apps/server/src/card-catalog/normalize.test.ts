import { describe, expect, it } from 'vitest';

import {
  SEEDED_SET_CODES,
  cardTags,
  catalogNumber,
  hasLimitlessScans,
  normalizeTcgdexCard,
  normalizeTcgdexSets,
  setCodeFromDetails,
  tcgdexCardsOf,
  tcgdexSetCardsQuery,
  wireSetJson,
  type TcgdexSetSummary,
} from './normalize.js';

const BASE = 'https://assets.tcgdex.net/en/sv/sv06/';

/** Dragapult ex (TWM 130) as TCGdex's GraphQL API answers it. */
const dragapult = {
  id: 'sv06-130',
  localId: '130',
  name: 'Dragapult ex',
  category: 'Pokemon',
  hp: 320,
  types: ['Dragon'],
  stage: 'Stage2',
  suffix: 'ex',
  evolveFrom: 'Drakloak',
  trainerType: null,
  energyType: null,
  effect: null,
  regulationMark: 'H',
  legal: { standard: true, expanded: true },
  image: `${BASE}130`,
  illustrator: '5ban Graphics',
  rarity: 'Double rare',
  retreat: 1,
  dexId: [887],
  abilities: null,
  attacks: [
    { name: 'Jet Headbutt', cost: ['Colorless'], damage: '70', effect: null },
    {
      name: 'Phantom Dive',
      cost: ['Fire', 'Psychic'],
      damage: '200',
      effect: "Put 6 damage counters on your opponent's Benched Pokémon.",
    },
  ],
  weaknesses: null,
  resistances: null,
};

const twm: TcgdexSetSummary = {
  id: 'sv06',
  name: 'Twilight Masquerade',
  released: '2024-05-24',
  seriesId: 'sv',
  series: 'Scarlet & Violet',
  official: 167,
  total: 226,
};

describe('TCGdex cards in wire form', () => {
  it('keeps every field the builder searches by, in short keys', () => {
    expect(normalizeTcgdexCard(dragapult, 'sv06', BASE)).toEqual({
      n: '130',
      nm: 'Dragapult ex',
      c: 'P',
      st: 'Stage 2',
      hp: 320,
      ty: 'N',
      ef: 'Drakloak',
      rm: 'H',
      il: '5ban Graphics',
      ra: 'Double rare',
      rt: 1,
      dx: [887],
      at: [
        ['Jet Headbutt', 'C', '70'],
        [
          'Phantom Dive',
          'RP',
          '200',
          "Put 6 damage counters on your opponent's Benched Pokémon.",
        ],
      ],
      tg: ['ex', 'Tera'],
      lg: 3,
    });
  });

  it('maps categories, stages, trainer and energy kinds', () => {
    const trainer = normalizeTcgdexCard(
      {
        id: 'sv06-153',
        localId: '153',
        name: 'Jamming Tower',
        category: 'Trainer',
        trainerType: 'Stadium',
        effect: 'Pokémon Tools have no effect.',
        image: `${BASE}153`,
        legal: { standard: false, expanded: true },
      },
      'sv06',
      BASE
    );
    expect(trainer).toMatchObject({ c: 'T', tt: 'Stadium', lg: 2 });
    expect(trainer).not.toHaveProperty('im');
    const energy = (energyType: string) =>
      normalizeTcgdexCard(
        {
          id: 'sv06-1',
          localId: '1',
          name: 'Energy',
          category: 'Energy',
          energyType,
          image: `${BASE}1`,
        },
        'sv06',
        BASE
      );
    expect(energy('Normal')?.et).toBe('B');
    expect(energy('Special')?.et).toBe('S');
    for (const [stage, expected] of [
      ['Basic', 'Basic'],
      ['Stage1', 'Stage 1'],
      ['VMAX', 'VMAX'],
      ['VSTAR', 'VSTAR'],
      ['V-UNION', 'V-UNION'],
      ['MEGA', 'Mega'],
      ['BREAK', 'BREAK'],
      ['LEVEL-UP', 'Level-Up'],
      ['RESTORED', 'Restored'],
      ['Baby', 'Baby'],
    ] as const) {
      expect(
        normalizeTcgdexCard({ ...dragapult, stage }, 'sv06', BASE)?.st
      ).toBe(expected);
    }
    expect(
      normalizeTcgdexCard({ ...dragapult, stage: 'Stage9' }, 'sv06', BASE)
    ).not.toHaveProperty('st');
  });

  it('leaves out what a Trainer or Energy cannot have', () => {
    const odd = normalizeTcgdexCard(
      {
        id: 'sv06-2',
        localId: '2',
        name: 'Odd Item',
        category: 'Trainer',
        hp: 70,
        retreat: 2,
        trainerType: 'Spell',
        image: `${BASE}2`,
      },
      'sv06',
      BASE
    );
    expect(odd).toEqual({ n: '2', nm: 'Odd Item', c: 'T' });
  });

  it('records an image only when it is not where the set says', () => {
    expect(
      normalizeTcgdexCard(
        { ...dragapult, image: 'https://assets.tcgdex.net/en/sv/other/130' },
        'sv06',
        BASE
      )?.im
    ).toBe('https://assets.tcgdex.net/en/sv/other/130');
    expect(
      normalizeTcgdexCard({ ...dragapult, image: null }, 'sv06', BASE, true)?.im
    ).toBe('');
    // No TCGdex image and no Limitless scan: nothing to play it with.
    expect(
      normalizeTcgdexCard({ ...dragapult, image: null }, 'sv06', BASE, false)
    ).toBeUndefined();
  });

  it('refuses cards that are not this set or not cards', () => {
    expect(normalizeTcgdexCard(dragapult, 'sv06.5', BASE)).toBeUndefined();
    expect(normalizeTcgdexCard(null, 'sv06', BASE)).toBeUndefined();
    expect(
      normalizeTcgdexCard({ ...dragapult, name: '' }, 'sv06', BASE)
    ).toBeUndefined();
    expect(
      normalizeTcgdexCard({ ...dragapult, category: 'Spell' }, 'sv06', BASE)
    ).toBeUndefined();
    expect(
      normalizeTcgdexCard({ ...dragapult, name: 'x'.repeat(161) }, 'sv06', BASE)
    ).toBeUndefined();
  });

  it('skips broken attacks and abilities, keeps the rest', () => {
    const card = normalizeTcgdexCard(
      {
        ...dragapult,
        attacks: [
          null,
          { name: null },
          { name: 'Bite', cost: ['Free'], damage: 30 },
        ],
        abilities: [{ type: 'Ability', name: 'Flare', effect: null }, 'x'],
        weaknesses: [{ type: 'Unknown' }, { type: 'Metal', value: '×2' }],
        resistances: [{ type: 'Grass', value: '-30' }],
      },
      'sv06',
      BASE
    );
    expect(card?.at).toEqual([['Bite', '', '30']]);
    expect(card?.ab).toEqual([['Ability', 'Flare', '']]);
    expect(card?.wk).toBe('M');
    expect(card?.wv).toBe('×2');
    expect(card?.rs).toBe('G');
    expect(card?.rv).toBe('-30');
  });

  it('keeps Weakness and Resistance modifiers as printed, one spelling each', () => {
    const modifiers = (weakness: unknown, resistance: unknown) => {
      const card = normalizeTcgdexCard(
        {
          ...dragapult,
          weaknesses: [{ type: 'Fighting', value: weakness }],
          resistances: [{ type: 'Metal', value: resistance }],
        },
        'sv06',
        BASE
      );
      return [card?.wv, card?.rv];
    };
    expect(modifiers('+10', '−20')).toEqual(['+10', '-20']);
    expect(modifiers('x2', '-30')).toEqual(['×2', '-30']);
    // Missing or unreadable: the type alone.
    expect(modifiers(null, 'lots')).toEqual([undefined, undefined]);
  });
});

describe('card tags', () => {
  const tags = (card: Partial<Parameters<typeof cardTags>[0]>) =>
    cardTags({ id: 'x-1', name: 'Card', category: 'P', ...card });

  it('reads mechanics from suffix, stage, rarity and name', () => {
    expect(tags({ suffix: 'EX', name: 'Shaymin EX' })).toEqual(['EX']);
    expect(tags({ suffix: 'EX', name: 'Pikachu ex' })).toEqual(['ex']);
    expect(tags({ suffix: 'V' })).toEqual(['V']);
    expect(tags({ suffix: 'GX' })).toEqual(['GX']);
    expect(tags({ suffix: 'TAG TEAM-GX' })).toEqual(['TAG TEAM', 'GX']);
    expect(tags({ suffix: 'Legend' })).toEqual(['LEGEND']);
    expect(tags({ suffix: 'Prime' })).toEqual(['Prime']);
    expect(tags({ suffix: 'SP' })).toEqual(['SP']);
    expect(tags({ suffix: 'V', stage: 'VSTAR' })).toEqual(['V', 'VSTAR']);
    expect(tags({ stage: 'VMAX' })).toEqual(['VMAX']);
    expect(tags({ stage: 'Level-Up' })).toEqual(['Level-Up']);
    expect(tags({ category: 'T', rarity: 'ACE SPEC Rare' })).toEqual([
      'ACE SPEC',
    ]);
    expect(tags({ name: 'Radiant Charizard' })).toEqual(['Radiant']);
    expect(tags({ name: 'Tapu Koko ◇' })).toEqual(['Prism Star']);
    expect(tags({ name: 'Pikachu ☆' })).toEqual(['Star']);
    expect(tags({ name: 'Flygon δ' })).toEqual(['Delta Species']);
    expect(tags({ name: 'M Rayquaza EX', suffix: 'EX' })).toEqual([
      'EX',
      'Mega',
    ]);
    expect(tags({ name: 'Mega Lucario ex', suffix: 'ex' })).toEqual([
      'ex',
      'Mega',
    ]);
    expect(tags({ name: 'Dark Gyarados' })).toEqual(['Dark']);
    expect(tags({ name: 'Light Dragonite' })).toEqual(['Light']);
    expect(tags({ name: 'Shining Mew' })).toEqual(['Shining']);
    expect(tags({ name: "Team Rocket's Mewtwo ex", suffix: 'ex' })).toEqual([
      'ex',
      "Team Rocket's",
    ]);
    expect(tags({ name: 'N’s Zoroark ex', suffix: 'ex' })).toEqual([
      'ex',
      "Owner's",
    ]);
    expect(tags({ name: "Lt. Surge's Raichu" })).toEqual(["Owner's"]);
    // Only Pokémon have owners.
    expect(tags({ name: "Boss's Orders", category: 'T' })).toEqual([]);
  });

  it('adds what the tag table knows', () => {
    expect(
      cardTags({
        id: 'sv05-123',
        name: 'Raging Bolt ex',
        category: 'P',
        suffix: 'ex',
      })
    ).toEqual(['ex', 'Ancient']);
    expect(
      cardTags({ id: 'bw7-137', name: 'Computer Search', category: 'T' })
    ).toEqual(['ACE SPEC']);
  });
});

describe('sets', () => {
  it('reads the sets query, skipping what does not fit', () => {
    const sets = normalizeTcgdexSets({
      data: {
        sets: [
          {
            id: 'sv06',
            name: 'Twilight Masquerade',
            releaseDate: '2024-05-24',
            serie: { id: 'sv', name: 'Scarlet & Violet' },
            cardCount: { official: 167, total: 226 },
            logo: 'https://assets.tcgdex.net/en/sv/sv06/logo',
            symbol: null,
          },
          {
            id: 'sv06',
            name: 'Again',
            releaseDate: '2024-05-24',
            serie: { id: 'sv', name: 'SV' },
            cardCount: { total: 1 },
          },
          {
            id: 'bad id!',
            name: 'x',
            releaseDate: '2024-05-24',
            serie: { id: 'sv', name: 'SV' },
            cardCount: { total: 1 },
          },
          {
            id: 'nodate',
            name: 'x',
            releaseDate: null,
            serie: { id: 'sv', name: 'SV' },
            cardCount: { total: 1 },
          },
        ],
      },
    });
    expect(sets).toEqual([
      { ...twm, logo: 'https://assets.tcgdex.net/en/sv/sv06/logo' },
    ]);
    expect(normalizeTcgdexSets(null)).toEqual([]);
    expect(normalizeTcgdexSets({ data: { sets: 'no' } })).toEqual([]);
  });

  it('names each set the way Pokémon TCG Live and Limitless do', () => {
    expect(
      setCodeFromDetails('sv06', { abbreviation: { official: 'TWM' } })
    ).toBe('TWM');
    expect(
      setCodeFromDetails('bw2', {
        tcgOnline: 'EPO',
        abbreviation: { official: 'EP' },
      })
    ).toBe('EPO');
    expect(
      setCodeFromDetails('bwp', {
        tcgOnline: 'PR-BLW',
        abbreviation: { official: 'BWP' },
      })
    ).toBe('BWP');
    expect(
      setCodeFromDetails('swsh9tg', {
        tcgOnline: null,
        abbreviation: { official: 'BRS:TG' },
      })
    ).toBe('BRS');
    expect(setCodeFromDetails('A1', { serie: { id: 'tcgp' } })).toBe('A1');
    expect(setCodeFromDetails('swshp', {})).toBe('SP');
    expect(setCodeFromDetails('base4', { tcgOnline: 'B2' })).toBe('BS2');
    expect(setCodeFromDetails('jumbo', {})).toBeUndefined();
    expect(
      setCodeFromDetails('x', { abbreviation: { official: 'a b' } })
    ).toBeUndefined();
    expect(SEEDED_SET_CODES).toMatchObject({
      sv06: 'TWM',
      me05: 'PBL',
      swshp: 'SP',
      sma: 'HIF',
      A1: 'A1',
      base4: 'BS2',
    });
  });

  it('gives no two sets the same code, except subsets folded into theirs', () => {
    const bySetCode = new Map<string, string[]>();
    for (const [set, code] of Object.entries(SEEDED_SET_CODES)) {
      bySetCode.set(code, [...(bySetCode.get(code) ?? []), set]);
    }
    const shared = [...bySetCode.entries()]
      .filter(([, sets]) => sets.length > 1)
      .map(([code, sets]) => `${code}: ${[...sets].sort().join(' ')}`)
      .sort();
    expect(shared).toEqual([
      '30C: 30th 30th-c',
      'ASR: swsh10 swsh10tg',
      'BRS: swsh9 swsh9tg',
      'CEL: cel25 cel25cc',
      'CRZ: swsh12.5 swsh12.5gg',
      'HIF: sm115 sma',
      'LOR: swsh11 swsh11tg',
      'LTR: bw11 rc',
      'SHF: swsh4.5 swsh4.5sv',
      'SIT: swsh12 swsh12tg',
    ]);
  });

  it('writes promo and classic numbers the way Limitless does', () => {
    expect(catalogNumber('swshp', 'SWSH022')).toBe('022');
    expect(catalogNumber('smp', 'SM85')).toBe('85');
    expect(catalogNumber('xyp', 'XY124')).toBe('124');
    expect(catalogNumber('30th-c', '001')).toBe('CC001');
    expect(catalogNumber('sv06', '130')).toBe('130');
    expect(catalogNumber('swsh9tg', 'TG01')).toBe('TG01');
    // A promo set's subset-like number stays whole.
    expect(catalogNumber('swshp', 'SWSHxyz')).toBe('SWSHxyz');
  });

  it('knows which sets Limitless has scans of', () => {
    expect(hasLimitlessScans(twm)).toBe(true);
    expect(hasLimitlessScans({ ...twm, id: 'tk-xy-n', seriesId: 'xy' })).toBe(
      false
    );
    expect(
      hasLimitlessScans({ ...twm, id: '2021swsh', seriesId: 'swsh' })
    ).toBe(false);
    expect(hasLimitlessScans({ ...twm, id: 'mfb' })).toBe(false);
    expect(hasLimitlessScans({ ...twm, id: 'base1', seriesId: 'base' })).toBe(
      false
    );
  });

  it('builds one set as JSON for the catalog body', () => {
    const built = wireSetJson(twm, 'TWM', [
      dragapult,
      {
        ...dragapult,
        id: 'sv06-129',
        localId: '129',
        name: 'Drakloak',
        suffix: null,
        image: `${BASE}129`,
      },
      { ...dragapult, id: 'sv06-130', localId: '130' },
      { id: 'other-1', localId: '1', name: 'Not ours', category: 'Pokemon' },
    ]);
    expect(built.cards).toBe(2);
    expect(built.dropped).toBe(2);
    const set = JSON.parse(built.json) as Record<string, unknown>;
    expect(set).toMatchObject({
      id: 'sv06',
      code: 'TWM',
      name: 'Twilight Masquerade',
      series: 'Scarlet & Violet',
      released: '2024-05-24',
      official: 167,
      total: 226,
      img: BASE,
    });
    expect(set).not.toHaveProperty('pocket');
    expect((set.cards as unknown[]).length).toBe(2);
    const pocket = JSON.parse(
      wireSetJson({ ...twm, id: 'A1', seriesId: 'tcgp' }, 'A1', []).json
    ) as Record<string, unknown>;
    expect(pocket.pocket).toBe(true);
  });

  it('asks for exactly one set', () => {
    expect(tcgdexSetCardsQuery('sv06')).toContain('filters: { id: "sv06-" }');
    expect(tcgdexCardsOf({ data: { cards: [1] } })).toEqual([1]);
    expect(tcgdexCardsOf({ data: { cards: null } })).toBeUndefined();
    expect(tcgdexCardsOf('x')).toBeUndefined();
  });
});
