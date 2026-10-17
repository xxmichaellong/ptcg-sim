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

  it("keeps a TCG Pocket mini-set's code as spelled, for its scans", () => {
    const decoded = decodeCatalog(
      body([{ n: '1', nm: 'Celebi ex', c: 'P', im: '' }], {
        id: 'A1a',
        code: 'A1a',
        name: 'Mythical Island',
        series: 'Pokémon TCG Pocket',
        released: '2024-12-17',
        img: undefined,
        pocket: true,
      })
    );
    const card = decoded.cards[0]!;
    expect(card.set.code).toBe('A1a');
    expect(card.id).toBe('A1A 1');
    expect(card.image).toContain('/pocket/A1a/A1a_001_');
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

  it('takes reworded reprints for one card, and different effects for two', () => {
    const trainer = (name: string, text?: string) =>
      printGroupKey({
        name,
        category: 'Trainer',
        types: [],
        abilities: [],
        attacks: [],
        ...(text === undefined ? {} : { text }),
      });
    // TCGdex's own texts. The handbook's example: "the wording has been
    // altered, the effect described remains unchanged".
    expect(
      trainer(
        'Copycat',
        "You can play only one Supporter card each turn. When you play this card, put it next to your Active Pokémon. When your turn ends, discard this card. Shuffle your hand into your deck. Then, count the number of cards in your opponent's hand and draw that many cards."
      )
    ).toBe(
      trainer(
        'Copycat',
        "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand."
      )
    );
    expect(
      trainer(
        'Ultra Ball',
        'Discard 2 cards from your hand. (If you can’t discard 2 cards, you can’t play this card.) Search your deck for a Pokémon, reveal it, and put it into your hand. Shuffle your deck afterward.'
      )
    ).toBe(
      trainer(
        'Ultra Ball',
        'You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.'
      )
    );
    const same: readonly (readonly [string, string, string])[] = [
      [
        'Pokémon Catcher',
        'Flip a coin. If heads, switch 1 of your opponent’s Benched Pokémon with his or her Active Pokémon.',
        "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      ],
      [
        'Air Balloon',
        'The Retreat Cost of the Pokémon this card is attached to is ColorlessColorless less.',
        'The Retreat Cost of the Pokémon this card is attached to is {C}{C} less.',
      ],
      [
        'Poké Ball',
        'Flip a coin. If heads, search your deck for a Pokémon, show it to your opponent, and put it into your hand. Shuffle your deck afterward.',
        'Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',
      ],
      [
        'Energy Switch',
        'Move a basic Energy card attached to 1 of your Pokémon to another of your Pokémon.',
        'Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.',
      ],
      [
        'Rare Candy',
        'Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card on the Basic Pokémon. (This counts as evolving that Pokémon.) You can’t use this card during your first turn or on a Basic Pokémon that was put into play this turn.',
        "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.",
      ],
    ];
    for (const [name, older, newer] of same) {
      expect(trainer(name, older), name).toBe(trainer(name, newer));
    }
    // The handbook's other example: damage counters are not damage.
    const rainbow = (text: string) =>
      printGroupKey({
        name: 'Rainbow Energy',
        category: 'Energy',
        energyType: 'Special',
        types: [],
        abilities: [],
        attacks: [],
        text,
      });
    expect(
      rainbow(
        "Attach Rainbow Energy to 1 of your Pokémon. While in play, Rainbow Energy counts as every type of basic Energy but only provides 1 Energy at a time. (Doesn't count as a basic Energy card when not in play.) When you attach this card from your hand to 1 of your Pokémon, it does 10 damage to that Pokémon. (Don't apply Weakness and Resistance.)"
      )
    ).not.toBe(
      rainbow(
        'This card provides Colorless Energy. While in play, this card provides every type of Energy but provides only 1 Energy at a time. When you attach this card from your hand to 1 of your Pokémon, put 1 damage counter on that Pokémon.'
      )
    );
    // Rare Candy that also skips to Stage 1 is another card.
    expect(
      trainer(
        'Rare Candy',
        'Choose 1 of your Basic Pokémon in play. If you have a Stage 1 or Stage 2 card that evolves from that Pokémon in your hand, put that card on the Basic Pokémon. (This counts as evolving that Pokémon.)'
      )
    ).not.toBe(
      trainer(
        'Rare Candy',
        "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn."
      )
    );
  });

  it('keeps Trainers of different kinds apart, an unprinted kind being an Item', () => {
    const trainer = (name: string, text: string, trainerType?: string) =>
      printGroupKey({
        name,
        category: 'Trainer',
        types: [],
        abilities: [],
        attacks: [],
        text,
        ...(trainerType ? { trainerType } : {}),
      });
    // Base Set's Bill and HeartGold's Supporter: the same text once the
    // Supporter reminder goes, but not the same card.
    expect(trainer('Bill', 'Draw 2 cards.')).not.toBe(
      trainer(
        'Bill',
        'You can play only one Supporter card each turn. When you play this card, put it next to your Active Pokémon. When your turn ends, discard this card. Draw 2 cards.',
        'Supporter'
      )
    );
    // Base Set's Switch is today's Item.
    expect(
      trainer(
        'Switch',
        'Switch 1 of your own Benched Pokémon with your Active Pokémon.'
      )
    ).toBe(
      trainer(
        'Switch',
        'Switch your Active Pokémon with 1 of your Benched Pokémon.',
        'Item'
      )
    );
    expect(trainer('Energy Search', 'Search.')).toBe(
      trainer('Energy Search', 'Search.', 'Item')
    );
  });

  it('lets an older print share a reworded reprint’s legality, and a textless one borrow it', () => {
    const decoded = decodeCatalog({
      ...body([]),
      sets: [
        {
          id: 'bw5',
          name: 'Dark Explorers',
          code: 'DEX',
          series: 'Black & White',
          released: '2012-05-09',
          cards: [
            {
              n: '102',
              nm: 'Ultra Ball',
              c: 'T',
              tx: 'Discard 2 cards from your hand. (If you can’t discard 2 cards, you can’t play this card.) Search your deck for a Pokémon, reveal it, and put it into your hand. Shuffle your deck afterward.',
              lg: 2,
            },
          ],
        },
        {
          id: 'g1',
          name: 'Gym Heroes',
          code: 'G1',
          series: 'Gym',
          released: '2000-08-14',
          cards: [{ n: '18', nm: 'Misty', c: 'T', tx: 'Misty, long ago.' }],
        },
        {
          id: 'me01',
          name: 'Mega Evolution',
          code: 'MEG',
          series: 'Mega Evolution',
          released: '2025-09-26',
          cards: [
            {
              n: '131',
              nm: 'Ultra Ball',
              c: 'T',
              tx: 'You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',
              lg: 3,
            },
          ],
        },
        {
          id: 'new',
          name: 'New',
          code: 'NEW',
          series: 'Mega Evolution',
          released: '2026-09-16',
          // No text yet: legal where the newest Ultra Ball is, while this
          // Misty, legal on its own, lends Gym Heroes' nothing.
          cards: [
            { n: '128', nm: 'Ultra Ball', c: 'T' },
            { n: '5', nm: 'Misty', c: 'T', lg: 2 },
          ],
        },
      ],
    });
    const find = (id: string) =>
      decoded.cards.find((entry) => entry.id === id)!;
    expect(find('DEX 102').printGroup).toBe(find('MEG 131').printGroup);
    expect(find('DEX 102').legal).toEqual({ standard: true, expanded: true });
    expect(find('NEW 128').legal).toEqual({ standard: true, expanded: true });
    expect(find('NEW 5').legal).toEqual({ standard: false, expanded: true });
    expect(find('G1 18').legal).toEqual({ standard: false, expanded: false });
  });

  it('tells Pokémon apart by Weakness, Resistance and Retreat where TCGdex has them', () => {
    const electrike = (
      n: string,
      defense: Record<string, unknown>,
      lg = 0
    ) => ({
      n,
      nm: 'Electrike',
      c: 'P',
      st: 'Basic',
      hp: 60,
      ty: 'L',
      at: [['Bite', 'C', '10']],
      ...defense,
      ...(lg ? { lg } : {}),
    });
    const at = (
      id: string,
      code: string,
      released: string,
      cards: unknown[]
    ) => ({
      id,
      name: code,
      code,
      series: 'Any',
      released,
      cards,
    });
    const decoded = decodeCatalog({
      ...body([]),
      sets: [
        at('pl4', 'AR', '2009-11-04', [
          electrike('63', { wk: 'F', wv: '+10', rs: 'M', rv: '-20', rt: 1 }),
        ]),
        at('xy6', 'ROS', '2015-05-06', [
          electrike('24', { wk: 'F', wv: '×2', rs: 'M', rv: '-20', rt: 1 }, 2),
        ]),
        at('xy7', 'AOR', '2015-08-12', [
          electrike('30', { wk: 'F', wv: '×2', rs: 'M', rv: '-20', rt: 1 }),
        ]),
        // A promo TCGdex gives no Weakness: the newest print it matches.
        at('xyp', 'XYP', '2016-01-01', [electrike('99', { rt: 1 })]),
      ],
    });
    const find = (id: string) =>
      decoded.cards.find((entry) => entry.id === id)!;
    expect(find('AR 63').printGroup).not.toBe(find('ROS 24').printGroup);
    expect(find('AR 63').legal.expanded).toBe(false);
    expect(find('AOR 30').printGroup).toBe(find('ROS 24').printGroup);
    expect(find('AOR 30').legal.expanded).toBe(true);
    expect(find('XYP 99').printGroup).toBe(find('ROS 24').printGroup);
    // A catalog stored before the modifiers splits nothing.
    const before = decodeCatalog({
      ...body([]),
      sets: [
        at('pl4', 'AR', '2009-11-04', [
          electrike('63', { wk: 'F', rs: 'M', rt: 1 }),
        ]),
        at('xy6', 'ROS', '2015-05-06', [
          electrike('24', { wk: 'F', rs: 'M', rt: 1 }, 2),
        ]),
      ],
    });
    expect(before.cards[0]!.printGroup).toBe(before.cards[1]!.printGroup);
  });

  it('keeps the pieces of a card printed in pieces apart, and a LEGEND half no Basic', () => {
    const piece = (n: string, extra: Record<string, unknown> = {}) => ({
      n,
      nm: 'Mewtwo V-UNION',
      c: 'P',
      hp: 310,
      ty: 'P',
      tx: 'Once per game during your turn, combine 4 different Mewtwo V-UNION from your discard pile.',
      ...extra,
    });
    const decoded = decodeCatalog({
      ...body([]),
      sets: [
        {
          id: 'swshp',
          name: 'SWSH Promos',
          code: 'SP',
          series: 'Sword & Shield',
          released: '2019-11-15',
          cards: [
            piece('159', { st: 'V-UNION' }),
            piece('160', { st: 'V-UNION' }),
            // TCGdex has no stage for some: the name says it.
            piece('215'),
            piece('216'),
            {
              n: '111',
              nm: 'Ho-Oh LEGEND',
              c: 'P',
              st: 'Basic',
              tg: ['LEGEND'],
              tx: 'Put this card from your hand onto your Bench only with the other half.',
            },
          ],
        },
      ],
    });
    const find = (id: string) =>
      decoded.cards.find((entry) => entry.id === id)!;
    expect(find('SP 159').printGroup).not.toBe(find('SP 160').printGroup);
    expect(find('SP 215').printGroup).not.toBe(find('SP 216').printGroup);
    // Stored before the server said so: still LEGEND, not Basic.
    expect(find('SP 111').stage).toBe('LEGEND');
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
    // In Standard and Expanded only the same text stands in for a reprint:
    // Neo Genesis's coin-flip Super Rod is not today's.
    const superRod = {
      name: 'Super Rod',
      category: 'Trainer' as const,
      types: [],
      abilities: [],
      attacks: [],
    };
    expect(
      printGroupKey({
        ...superRod,
        text: 'Flip a coin. If heads, put a card from your discard pile into your hand.',
      })
    ).not.toBe(
      printGroupKey({
        ...superRod,
        text: 'Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.',
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
