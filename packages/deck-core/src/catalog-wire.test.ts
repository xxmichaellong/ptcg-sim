import { describe, expect, it } from 'vitest';

import fixture from '../../../tests/fixtures/card-catalog.json';
import { foldText } from './card-query.js';
import {
  CatalogWireError,
  catalogCardId,
  decodeCatalog,
  limitlessImages,
  normalizeCollectorNumber,
  printGroupKey,
} from './catalog-wire.js';

const catalog = decodeCatalog(fixture);
const card = (id: string) => {
  const found = catalog.byId.get(id);
  if (!found) throw new Error(`${id} is not in the fixture`);
  return found;
};

/** A minimal valid body with one set, for malformed-input cases. */
const body = (cards: unknown[], set: Record<string, unknown> = {}) => ({
  v: 1,
  builtAt: '2026-10-15T00:00:00.000Z',
  source: 'TCGdex',
  sets: [
    {
      id: 'sv06',
      code: 'TWM',
      name: 'Twilight Masquerade',
      series: 'Scarlet & Violet',
      released: '2024-05-24',
      img: 'https://assets.tcgdex.net/en/sv/sv06/',
      cards,
      ...set,
    },
  ],
});

describe('collector numbers', () => {
  it('writes numbers the way Pokémon TCG Live and Limitless do', () => {
    expect(normalizeCollectorNumber('001')).toBe('1');
    expect(normalizeCollectorNumber('TG01')).toBe('TG1');
    expect(normalizeCollectorNumber('SV049')).toBe('SV49');
    expect(normalizeCollectorNumber('206a')).toBe('206A');
    expect(normalizeCollectorNumber('0')).toBe('0');
    expect(normalizeCollectorNumber('RC5')).toBe('RC5');
    expect(normalizeCollectorNumber('Museum')).toBe('MUSEUM');
    expect(catalogCardId('twm', '001')).toBe('TWM 1');
  });

  it('builds Limitless scan URLs from the set code and number', () => {
    expect(limitlessImages('SVE', '5', false)).toEqual({
      large:
        'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN_LG.png',
      small:
        'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN_SM.png',
    });
    expect(limitlessImages('BRS', 'TG1', false).large).toContain(
      '/tpci/BRS/BRS_TG1_R_EN_LG.png'
    );
    const pocket = limitlessImages('A1', '1', true);
    expect(pocket.large).toBe(pocket.small);
    expect(pocket.large).toContain('/pocket/A1/A1_001_EN_SM.webp');
  });
});

describe('decoding the catalog', () => {
  it('reads every card of the real-data fixture', () => {
    expect(catalog.builtAt).toBe('2026-10-15T00:00:00.000Z');
    expect(catalog.cards).toHaveLength(74);
    expect(catalog.sets).toHaveLength(28);
    expect(catalog.byId.size).toBe(74);
  });

  it('lists cards newest set first, then by collector number', () => {
    expect(catalog.sets[0]?.id).toBe('me03');
    expect(catalog.sets.at(-1)?.id).toBe('base1');
    const twm = catalog.cards.filter((entry) => entry.set.id === 'sv06');
    expect(twm.map((entry) => entry.number)).toEqual([
      '25',
      '95',
      '128',
      '129',
      '130',
      '153',
      '165',
      '200',
    ]);
    const releases = catalog.cards.map((entry) => entry.set.released);
    expect([...releases].sort().reverse()).toEqual(releases);
  });

  it('decodes a Pokémon with every field', () => {
    const dragapult = card('TWM 130');
    expect(dragapult).toMatchObject({
      name: 'Dragapult ex',
      category: 'Pokémon',
      number: '130',
      stage: 'Stage 2',
      hp: 320,
      types: ['Dragon'],
      evolvesFrom: 'Drakloak',
      retreat: 1,
      regulationMark: 'H',
      illustrator: '5ban Graphics',
      rarity: 'Double rare',
      dex: [887],
      legal: { standard: true, expanded: true },
      image: 'https://assets.tcgdex.net/en/sv/sv06/130/high.webp',
      imageSmall: 'https://assets.tcgdex.net/en/sv/sv06/130/low.webp',
    });
    expect(dragapult.set).toMatchObject({
      id: 'sv06',
      code: 'TWM',
      name: 'Twilight Masquerade',
      series: 'Scarlet & Violet',
      released: '2024-05-24',
    });
    expect(dragapult.tags).toEqual(expect.arrayContaining(['ex', 'Tera']));
    expect(dragapult.attacks).toEqual([
      { name: 'Jet Headbutt', cost: ['Colorless'], damage: '70' },
      {
        name: 'Phantom Dive',
        cost: ['Fire', 'Psychic'],
        damage: '200',
        text: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.",
      },
    ]);
  });

  it('decodes abilities, weakness and resistance', () => {
    const mew = card('MEW 151');
    expect(mew.abilities).toEqual([
      {
        kind: 'Ability',
        name: 'Restart',
        text: 'Once during your turn, you may draw cards until you have 3 cards in your hand.',
      },
    ]);
    expect(mew.weakness).toBe('Darkness');
    expect(mew.resistance).toBe('Fighting');
  });

  it('decodes Trainer and Energy kinds', () => {
    expect(card('MEG 114')).toMatchObject({
      category: 'Trainer',
      trainerType: 'Supporter',
    });
    expect(card('MEG 131').trainerType).toBe('Item');
    expect(card('TWM 153').trainerType).toBe('Stadium');
    expect(card('PAL 173').trainerType).toBe('Tool');
    expect(card('BRS 151')).toMatchObject({
      category: 'Energy',
      energyType: 'Special',
    });
    expect(card('SVE 5')).toMatchObject({
      category: 'Energy',
      energyType: 'Basic',
    });
    expect(card('PAL 190').text).toContain('Energy');
  });

  it('keeps every stage and mechanic the builder filters by', () => {
    expect(card('TWM 128').stage).toBe('Basic');
    expect(card('TWM 129').stage).toBe('Stage 1');
    expect(card('BRS 123')).toMatchObject({ stage: 'VSTAR' });
    expect(card('BRS 123').tags).toEqual(['V', 'VSTAR']);
    expect(card('MEG 77').tags).toEqual(expect.arrayContaining(['ex', 'Mega']));
    expect(card('TEF 123').tags).toContain('Ancient');
    expect(card('TEF 81').tags).toContain('Future');
    expect(card('PGO 11').tags).toContain('Radiant');
    expect(card('TEU 51').tags).toContain('Prism Star');
    expect(card('TWM 165').tags).toContain('ACE SPEC');
    expect(card('BCR 137').tags).toContain('ACE SPEC');
    expect(card('TEF 162')).toMatchObject({ energyType: 'Special' });
    expect(card('TEF 162').tags).toContain('ACE SPEC');
    expect(card('A1 96').tags).toEqual(['ex']);
  });

  it('gives reprints one print group, and so one legality', () => {
    // Judge rotated with its G-mark print, but the J-mark reprint keeps
    // the card, and with it every print, legal in Standard.
    expect(card('SVI 176').regulationMark).toBe('G');
    expect(card('SVI 176').printGroup).toBe(card('POR 76').printGroup);
    expect(card('SVI 176').legal.standard).toBe(true);
    expect(card('SVI 191').printGroup).toBe(card('MEG 125').printGroup);
    expect(card('SVI 191').legal.standard).toBe(true);
    // A full art is the same card.
    expect(card('TWM 200').printGroup).toBe(card('TWM 130').printGroup);
    expect(card('OBF 215').printGroup).toBe(card('OBF 125').printGroup);
    // A rotated card with no legal reprint is out of Standard only.
    expect(card('PAR 163').legal).toEqual({ standard: false, expanded: true });
    // Basic Energy is one card whatever set it's from.
    expect(card('SVE 5').printGroup).toBe(card('MEE 5').printGroup);
    expect(card('SVE 5').printGroup).not.toBe(card('SVE 6').printGroup);
    // TCG Pocket's Professor's Research is another game's card.
    expect(card('P-A 7').printGroup).not.toBe(card('SVI 189').printGroup);
    expect(card('P-A 7').legal).toEqual({ standard: false, expanded: false });
    // 74 prints, six of them reprints of another print here.
    expect(new Set(catalog.cards.map((entry) => entry.printGroup)).size).toBe(
      68
    );
  });

  it('applies the Expanded ban to every print of a banned card', () => {
    expect(card('PHF 99').legal.expanded).toBe(false);
    expect(card('AOR 75').legal.expanded).toBe(false);
    expect(card('ROS 77').legal.expanded).toBe(false);
    expect(card('ROS 77A').legal.expanded).toBe(false);
    expect(card('LOT 90').legal.expanded).toBe(false);
    expect(card('BCR 137').legal.expanded).toBe(true);
  });

  it('bans by print id even where the source says legal', () => {
    const banned = decodeCatalog({
      ...body([
        { n: '130', nm: 'Dragapult ex', c: 'P', st: 'Stage 2', lg: 3 },
        { n: '200', nm: 'Dragapult ex', c: 'P', st: 'Stage 2', lg: 3 },
      ]),
      bans: { expanded: ['TWM 130'], standard: ['twm 200'] },
    });
    expect(banned.byId.get('TWM 200')?.legal).toEqual({
      standard: false,
      expanded: false,
    });
  });

  it('makes Basic Energy legal everywhere, and Pocket cards nowhere', () => {
    expect(card('SVE 5').legal).toEqual({ standard: true, expanded: true });
    expect(card('A1 1').legal).toEqual({ standard: false, expanded: false });
    expect(card('A1 1').set.pocket).toBe(true);
    expect(card('P-A 7').set.pocket).toBe(true);
  });

  it('falls back to Limitless scans where TCGdex has no image', () => {
    expect(card('SVE 5').image).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN_LG.png'
    );
    expect(card('MEE 2').imageSmall).toContain('MEE_002_R_EN_SM.png');
    expect(card('BS 4').image).toBe(
      'https://assets.tcgdex.net/en/base/base1/4/high.webp'
    );
  });

  it('indexes prints by folded name, newest first', () => {
    const charizards = catalog.byName.get('charizard ex') ?? [];
    expect(charizards.map((entry) => entry.id)).toEqual(['OBF 125', 'OBF 215']);
    expect(
      catalog.byName.get(foldText("Lillie's Determination"))?.[0]?.id
    ).toBe('MEG 119');
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(card('TWM 130'))).toBe(true);
    expect(Object.isFrozen(card('TWM 130').attacks[0])).toBe(true);
  });
});

describe('untrusted input', () => {
  it('refuses a body that is not a catalog', () => {
    expect(() => decodeCatalog(null)).toThrow(CatalogWireError);
    expect(() => decodeCatalog([])).toThrow(CatalogWireError);
    expect(() => decodeCatalog({ ...body([]), v: 2 })).toThrow(
      /Unsupported catalog version 2/u
    );
    expect(() => decodeCatalog({ ...body([]), builtAt: 'never' })).toThrow(
      CatalogWireError
    );
    expect(() => decodeCatalog({ ...body([]), sets: {} })).toThrow(
      CatalogWireError
    );
  });

  it('skips cards and sets that do not decode, keeping the rest', () => {
    const decoded = decodeCatalog(
      body([
        { n: '1', nm: 'Good', c: 'P' },
        { n: '2', nm: 'No category' },
        { n: '3', nm: 'Bad type', c: 'P', ty: 'Q' },
        { n: '4', nm: 'Bad attack', c: 'P', at: [['Hit', 'CC']] },
        { n: '5', nm: 'x'.repeat(161), c: 'P' },
        { n: '6', nm: 'Insecure image', c: 'P', im: 'http://example.com/a' },
        'not a card',
        { n: '1', nm: 'Same id twice', c: 'P' },
        { n: '7', nm: 'Unknown stage dropped', c: 'P', st: 'Stage 9', hp: -1 },
      ])
    );
    expect(decoded.cards.map((entry) => entry.name)).toEqual([
      'Good',
      'Insecure image',
      'Unknown stage dropped',
    ]);
    // An image it can't use is no image: Limitless's scan stands in.
    expect(decoded.byId.get('TWM 6')?.image).toContain(
      '/tpci/TWM/TWM_006_R_EN_LG.png'
    );
    expect(decoded.cards[2]).not.toHaveProperty('stage');
    expect(decoded.cards[2]).not.toHaveProperty('hp');

    const badSet = decodeCatalog({
      ...body([]),
      sets: [{ id: 'x', name: 'No date', series: 's', cards: [] }],
    });
    expect(badSet.sets).toHaveLength(0);
  });

  it('drops a card with no image and no code to find a scan by', () => {
    const decoded = decodeCatalog(
      body([{ n: '1', nm: 'No picture', c: 'P', im: '' }], { code: undefined })
    );
    expect(decoded.cards).toHaveLength(0);
  });

  it('tells Basic Energy, Special Energy and ACE SPEC Trainers apart', () => {
    const decoded = decodeCatalog({
      ...body([]),
      sets: [
        {
          id: 'old',
          name: 'Old',
          code: 'OLD',
          series: 'Base',
          released: '1999-01-09',
          cards: [
            { n: '71', nm: 'Computer Search', c: 'T', tx: 'Search.' },
            { n: '97', nm: 'Fairy Energy', c: 'E', et: 'B', lg: 2 },
          ],
        },
        {
          id: 'new',
          name: 'New',
          code: 'NEW',
          series: 'SV',
          released: '2024-01-01',
          cards: [
            {
              n: '137',
              nm: 'Computer Search',
              c: 'T',
              tg: ['ACE SPEC'],
              tx: 'Search, as an ACE SPEC.',
              lg: 2,
            },
            {
              n: '266',
              nm: 'Reversal Energy',
              c: 'E',
              et: 'B',
              tx: 'Provides {C} Energy.',
              lg: 3,
            },
            { n: '2', nm: 'Fire Energy', c: 'E', et: 'B', lg: 3 },
            { n: '3', nm: 'Basic Fire Energy', c: 'E', et: 'B' },
          ],
        },
      ],
    });
    const find = (id: string) =>
      decoded.cards.find((entry) => entry.id === id)!;
    // Base Set's Computer Search isn't the ACE SPEC one.
    expect(find('OLD 71').printGroup).not.toBe(find('NEW 137').printGroup);
    expect(find('OLD 71').legal.expanded).toBe(false);
    expect(find('OLD 71').tags).not.toContain('ACE SPEC');
    // TCGdex's "Normal" Reversal Energy is Special Energy.
    expect(find('NEW 266').energyType).toBe('Special');
    // Fire Energy by any name is one card, legal everywhere.
    expect(find('NEW 3').printGroup).toBe(find('NEW 2').printGroup);
    expect(find('NEW 3').legal).toEqual({ standard: true, expanded: true });
    // Fairy Energy is out of Standard.
    expect(find('OLD 97').legal).toEqual({ standard: false, expanded: true });
  });

  it('keys print groups by rules, ignoring case and spacing', () => {
    const base = {
      name: 'Shadow Rider',
      category: 'Pokémon' as const,
      stage: 'Basic',
      hp: 70,
      types: [],
      abilities: [{ name: 'Gallop', text: 'Draw a card.' }],
      attacks: [],
    };
    const same = printGroupKey({
      ...base,
      name: 'shadow  rider',
      abilities: [{ name: 'Gallop', text: 'draw a  card.' }],
    });
    expect(printGroupKey(base)).toBe(same);
    expect(
      printGroupKey({
        ...base,
        abilities: [{ name: 'Gallop', text: 'Draw 2 cards.' }],
      })
    ).not.toBe(same);
    // A Trainer's subtitle is cosmetic.
    expect(
      printGroupKey({
        name: "Boss's Orders (Giovanni)",
        category: 'Trainer',
        types: [],
        abilities: [],
        attacks: [],
      })
    ).toBe(
      printGroupKey({
        name: "Boss's Orders",
        category: 'Trainer',
        types: [],
        abilities: [],
        attacks: [],
      })
    );
    // A Trainer is its name: an old print plays with the new wording.
    const switchCard = {
      name: 'Switch',
      category: 'Trainer' as const,
      types: [],
      abilities: [],
      attacks: [],
    };
    expect(
      printGroupKey({
        ...switchCard,
        text: 'Switch 1 of your Benched Pokémon with your Active Pokémon.',
      })
    ).toBe(
      printGroupKey({
        ...switchCard,
        text: 'Switch your Active Pokémon with 1 of your Benched Pokémon.',
      })
    );
    expect(
      printGroupKey({
        ...base,
        name: 'Fire Energy',
        category: 'Energy',
        energyType: 'Basic',
      })
    ).toBe(
      printGroupKey({
        ...base,
        name: 'Fire  energy',
        category: 'Energy',
        energyType: 'Basic',
        text: 'something else',
      })
    );
  });
});
