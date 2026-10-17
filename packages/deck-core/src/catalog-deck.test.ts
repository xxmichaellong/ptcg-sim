import { describe, expect, it } from 'vitest';

import type { CatalogCard, CatalogSet, LoadedCatalog } from './catalog.js';
import {
  catalogIndex,
  deckCardFromCatalog,
  findCatalogPrint,
  printFromImageUrl,
  printKey,
  resolveDecklistRow,
  withCatalogFacts,
} from './catalog-deck.js';
import { formatDecklistText } from './decklist-text.js';
import { deckListOf, sameDeckList } from './deck-list.js';
import {
  parsePastedDecklist,
  type PastedDecklistRow,
} from './pasted-decklist.js';

const set = (
  id: string,
  code: string | undefined,
  released: string,
  official = 200
): CatalogSet => ({
  id,
  ...(code ? { code } : {}),
  name: `Set ${id}`,
  series: 'Scarlet & Violet',
  released,
  official,
});

const MEE = set('mee', 'MEE', '2025-09-25', 8);
const SVE = set('sve', 'SVE', '2023-03-31', 24);
const TWM = set('sv06', 'TWM', '2024-05-24', 167);
const SVP = set('svp', 'SVP', '2023-03-31', 300);

const card = (
  cardSet: CatalogSet,
  number: string,
  name: string,
  overrides: Partial<CatalogCard> = {}
): CatalogCard => ({
  id: `${cardSet.code ?? cardSet.id} ${number}`,
  name,
  category: 'Pokémon',
  set: cardSet,
  number,
  image: `https://img/${cardSet.id}/${number}/high.webp`,
  imageSmall: `https://img/${cardSet.id}/${number}/low.webp`,
  tags: [],
  types: [],
  abilities: [],
  attacks: [],
  dex: [],
  legal: { standard: true, expanded: true },
  printGroup: name,
  stage: 'Basic',
  ...overrides,
});

const energy = (cardSet: CatalogSet, number: string, name: string) =>
  card(cardSet, number, name, {
    category: 'Energy',
    energyType: 'Basic',
    stage: undefined,
  });

const CARDS = [
  card(TWM, '128', 'Dreepy'),
  card(TWM, '130', 'Dragapult ex', {
    stage: 'Stage 2',
    tags: ['ex', 'Tera'],
    regulationMark: 'H',
  }),
  card(TWM, '200', 'Dragapult ex', { stage: 'Stage 2', tags: ['ex', 'Tera'] }),
  card(SVP, '85', 'Pikachu'),
  energy(MEE, '2', 'Fire Energy'),
  energy(SVE, '2', 'Fire Energy'),
];

const catalog: LoadedCatalog = {
  builtAt: '2026-10-15T00:00:00Z',
  cards: CARDS,
  sets: [MEE, SVE, TWM, SVP],
  byId: new Map(CARDS.map((entry) => [entry.id, entry])),
  byName: new Map(),
};

const row = (line: string): PastedDecklistRow => {
  const parsed = parsePastedDecklist(line);
  if (!parsed.ok || !parsed.rows[0]) throw new Error(`Unparsed: ${line}`);
  return parsed.rows[0];
};

describe('finding the printing a decklist line means', () => {
  const index = catalogIndex(catalog);

  it('matches a set and number, whatever the spelling', () => {
    expect(printKey('pr-sv', '085')).toBe('SVP 85');
    expect(printKey('BRS', 'TG01')).toBe('BRS TG1');
    expect(
      resolveDecklistRow(index, row('3 Dragapult ex TWM 130'))
    ).toMatchObject({
      match: 'print',
      card: { id: 'TWM 130' },
    });
    expect(resolveDecklistRow(index, row('1 Pikachu PR-SV 85'))).toMatchObject({
      match: 'print',
      card: { id: 'SVP 85' },
    });
  });

  it("finds a Trainer's printing whatever its subtitle", () => {
    const RCL = set('swsh2', 'RCL', '2020-05-01', 192);
    const MEG = set('me01', 'MEG', '2025-09-26', 132);
    const trainer = { category: 'Trainer' as const, stage: undefined };
    const bosses = [
      card(RCL, '154', "Boss's Orders (Giovanni)", trainer),
      card(MEG, '114', "Boss's Orders", trainer),
    ];
    const withBosses: LoadedCatalog = {
      ...catalog,
      cards: bosses,
      sets: [RCL, MEG],
      byId: new Map(bosses.map((entry) => [entry.id, entry])),
    };
    const bossIndex = catalogIndex(withBosses);
    expect(
      resolveDecklistRow(bossIndex, row("4 Boss's Orders RCL 154"))
    ).toMatchObject({ match: 'print', card: { id: 'RCL 154' } });
    expect(
      findCatalogPrint(withBosses, {
        name: "Boss's Orders",
        set: 'RCL',
        number: '154',
        image: 'x',
      })?.id
    ).toBe('RCL 154');
  });

  it('finds a card by name in the set given when the number differs', () => {
    // Limitless numbers the Mega Evolution Energy differently from TCGdex.
    expect(
      resolveDecklistRow(index, row('4 Fire Energy MEE 10'))
    ).toMatchObject({
      match: 'name_in_set',
      card: { id: 'MEE 2' },
    });
  });

  it('finds Basic Energy by name, newest ordinary printing first', () => {
    expect(resolveDecklistRow(index, row('8 Basic {R} Energy'))).toMatchObject({
      match: 'energy',
      card: { id: 'MEE 2' },
    });
  });

  it("finds an old list's printing by its id, and never swaps EX for ex", () => {
    const TM = set('hgss4', 'TM', '2010-11-03', 102);
    const PAL = set('sv02', 'PAL', '2023-06-09', 193);
    const FLF = set('xy2', 'FLF', '2014-05-07', 106);
    const OBF = set('sv03', 'OBF', '2023-08-11', 197);
    const DF = set('ex15', 'DF', '2006-11-08', 113);
    const DPP = set('dpp', 'DPP', '2007-05-01', 56);
    const cards = [
      card(TM, '84', 'Yanma'),
      card(DPP, '3', 'Piplup'),
      card(PAL, '50', 'Piplup'),
      card(TM, '79', 'Treecko'),
      card(DF, '19', 'Lickitung δ'),
      card(PAL, '6', 'Yanma'),
      card(FLF, '12', 'Charizard EX', { hp: 180 }),
      card(OBF, '125', 'Charizard ex', { stage: 'Stage 2' }),
    ];
    const old: LoadedCatalog = {
      ...catalog,
      cards,
      sets: [TM, DF, DPP, PAL, FLF, OBF],
      byId: new Map(cards.map((entry) => [entry.id, entry])),
    };
    const oldIndex = catalogIndex(old);
    expect(resolveDecklistRow(oldIndex, row('4 Yanma hgss4-84'))).toMatchObject(
      { match: 'print', card: { id: 'TM 84' } }
    );
    // A promo's id keeps its series' prefix; the catalog's number doesn't.
    expect(
      resolveDecklistRow(oldIndex, row('1 Piplup dpp-DP03'))
    ).toMatchObject({ match: 'print', card: { id: 'DPP 3' } });
    // TCGdex spells some names otherwise; an id on the wrong card is ignored.
    expect(
      resolveDecklistRow(oldIndex, row('2 Lickitung ex15-19'))
    ).toMatchObject({ match: 'print', card: { id: 'DF 19' } });
    expect(
      resolveDecklistRow(oldIndex, row('1 Relicanth hgss4-79')).match
    ).not.toBe('print');
    for (const line of ['1 Charizard EX', '1 Charizard-EX']) {
      expect(resolveDecklistRow(oldIndex, row(line)).card?.id).toBe('FLF 12');
    }
    expect(resolveDecklistRow(oldIndex, row('1 Charizard ex')).card?.id).toBe(
      'OBF 125'
    );
  });

  it('never takes Nidoran♂ for Nidoran♀, nor Celebi ☆ for Celebi', () => {
    const LM = set('ex12', 'LM', '2006-02-01', 92);
    const CL = set('col1', 'CL', '2011-02-09', 95);
    const cards = [
      card(LM, '1', 'Nidoran♀'),
      card(CL, '2', 'Celebi'),
      card(LM, '3', 'Celebi ★'),
    ];
    const marked: LoadedCatalog = {
      ...catalog,
      cards,
      sets: [LM, CL],
      byId: new Map(cards.map((entry) => [entry.id, entry])),
    };
    const markedIndex = catalogIndex(marked);
    expect(
      resolveDecklistRow(markedIndex, row('4 Nidoran♂')).card
    ).toBeUndefined();
    expect(resolveDecklistRow(markedIndex, row('4 Nidoran ♀')).card?.id).toBe(
      'LM 1'
    );
    expect(resolveDecklistRow(markedIndex, row('1 Celebi ☆')).card?.id).toBe(
      'LM 3'
    );
    expect(resolveDecklistRow(markedIndex, row('1 Celebi')).card?.id).toBe(
      'CL 2'
    );
  });

  it('keeps a TCG Pocket line in Pocket, and other lines out of it', () => {
    const PA = { ...set('pa', 'P-A', '2024-10-30', 100), pocket: true };
    const research = card(PA, '7', "Professor's Research", {
      category: 'Trainer',
      stage: undefined,
    });
    const withPocket: LoadedCatalog = {
      ...catalog,
      cards: [...CARDS, research],
      sets: [...catalog.sets, PA],
      byId: new Map([...CARDS, research].map((entry) => [entry.id, entry])),
    };
    const pocketIndex = catalogIndex(withPocket);
    // A Pocket set the catalog lacks finds no TCG card instead.
    expect(
      resolveDecklistRow(pocketIndex, row('2 Pikachu A1 94')).card
    ).toBeUndefined();
    expect(
      resolveDecklistRow(pocketIndex, row("2 Professor's Research A1 999"))
    ).toMatchObject({ match: 'name', card: { id: 'P-A 7' } });
    // A TCG line never lands on the Pocket card.
    expect(
      resolveDecklistRow(pocketIndex, row("4 Professor's Research")).card
    ).toBeUndefined();
  });

  it('falls back to the newest ordinary printing of the name', () => {
    expect(resolveDecklistRow(index, row('2 Dragapult ex'))).toMatchObject({
      match: 'name',
      card: { id: 'TWM 130' },
    });
    expect(resolveDecklistRow(index, row('1 Missingno'))).toEqual({
      row: row('1 Missingno'),
    });
  });

  it('makes a deck card that carries the rules facts', () => {
    const deckCard = deckCardFromCatalog(CARDS[1]!);
    expect(deckCard).toMatchObject({
      id: 'TWM 130',
      name: 'Dragapult ex',
      set: 'TWM',
      number: '130',
      image: 'https://img/sv06/130/high.webp',
      imageSmall: 'https://img/sv06/130/low.webp',
      facts: {
        stage: 'Stage 2',
        regulationMark: 'H',
        legal: { standard: true, expanded: true },
      },
    });
    expect(deckCard.facts?.tags).toBeUndefined();
    const french = deckCardFromCatalog(CARDS[1]!, { language: 'French' });
    expect(french.image).toContain('_R_FR');
  });

  it("finds a promo by its TCGdex image, whose number keeps the series' prefix", () => {
    const SP = set('swshp', 'SP', '2019-11-15', 307);
    const rillaboom = card(SP, '22', 'Rillaboom');
    const promos: LoadedCatalog = {
      ...catalog,
      cards: [rillaboom],
      sets: [SP],
      byId: new Map([[rillaboom.id, rillaboom]]),
    };
    expect(
      findCatalogPrint(promos, {
        name: 'Rillaboom',
        image: 'https://assets.tcgdex.net/en/swsh/swshp/SWSH022/high.webp',
      })?.id
    ).toBe('SP 22');
  });

  it("finds v1's Pokémon TCG API scans of an old list's ids", () => {
    const TM = set('hgss4', 'TM', '2010-11-03', 102);
    const DPP = set('dpp', 'DPP', '2007-05-01', 56);
    const LC = set('lc', 'LC', '2002-05-24', 110);
    const cards = [
      card(TM, '84', 'Yanma'),
      card(DPP, '3', 'Piplup'),
      card(LC, '7', 'Hitmonlee'),
    ];
    const old: LoadedCatalog = {
      ...catalog,
      cards,
      sets: [TM, DPP, LC],
      byId: new Map(cards.map((entry) => [entry.id, entry])),
    };
    const scan = (id: string, number: string) =>
      `https://images.pokemontcg.io/${id}/${number}_hires.png`;
    expect(printFromImageUrl(scan('hgss4', '84'))).toEqual({
      setId: 'hgss4',
      number: '84',
    });
    for (const [name, image, id] of [
      ['Yanma', scan('hgss4', '84'), 'TM 84'],
      ['Piplup', scan('dpp', 'DP03'), 'DPP 3'],
      ['Hitmonlee', scan('base6', '7'), 'LC 7'],
    ] as const) {
      expect(findCatalogPrint(old, { name, image })?.id, name).toBe(id);
    }
  });

  it('reads the printing from Limitless and TCGdex image addresses', () => {
    expect(
      printFromImageUrl(
        'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN.png'
      )
    ).toEqual({ set: 'TWM', number: '130' });
    expect(
      printFromImageUrl('https://assets.tcgdex.net/en/sv/sv06/130/high.webp')
    ).toEqual({
      setId: 'sv06',
      number: '130',
    });
    expect(
      findCatalogPrint(catalog, {
        name: 'Dragapult ex',
        image:
          'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN.png',
      })?.id
    ).toBe('TWM 130');
    expect(
      findCatalogPrint(catalog, {
        name: 'Dreepy',
        image: 'https://assets.tcgdex.net/en/sv/sv06/128/high.webp',
      })?.id
    ).toBe('TWM 128');
    expect(
      findCatalogPrint(catalog, {
        name: 'Wrong',
        set: 'TWM',
        number: '130',
        image: 'x',
      })
    ).toBeUndefined();
  });
});

describe('card images in other languages', () => {
  it('uses a translated scan only where Limitless has one', () => {
    const SVI = {
      ...set('sv01', 'SVI', '2023-03-31', 198),
      series: 'Scarlet & Violet',
    };
    const BS = { ...set('base1', 'BS', '1999-01-09', 102), series: 'Base' };
    const modern = deckCardFromCatalog(card(SVI, '1', 'Pineco'), {
      language: 'German',
    });
    expect(modern.image).toContain('/tpci/SVI/SVI_001_R_DE.png');
    const old = card(BS, '4', 'Charizard');
    expect(deckCardFromCatalog(old, { language: 'German' }).image).toBe(
      old.image
    );
  });
});

describe('catalog facts for decks made without the catalog', () => {
  it('adds facts and keeps what the table shows', () => {
    const imported = deckListOf([
      {
        card: {
          id: 'TWM 130',
          name: 'Dragapult ex',
          category: 'Pokémon',
          image:
            'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_FR.png',
          set: 'TWM',
          number: '130',
        },
        count: 3,
      },
      {
        card: {
          id: 'custom:x',
          name: 'Homemade',
          category: 'Trainer',
          image: 'x',
        },
        count: 1,
      },
    ]);
    const upgraded = withCatalogFacts(imported, catalog);
    expect(upgraded).not.toBe(imported);
    expect(upgraded[0]!.card).toMatchObject({
      id: 'TWM 130',
      image: imported[0]!.card.image,
      facts: { stage: 'Stage 2', regulationMark: 'H' },
    });
    expect(upgraded[0]!.card.imageSmall).toBeUndefined();
    expect(upgraded[1]).toBe(imported[1]);
    expect(sameDeckList(imported, upgraded)).toBe(true);
    expect(withCatalogFacts(upgraded, catalog)).toBe(upgraded);
  });

  it('leaves a card typed otherwise than the catalog as it was made', () => {
    // The card dialog's Card Type: Dragapult ex's scan, played as a Trainer.
    const made = deckListOf([
      {
        card: {
          id: 'custom:typed',
          name: 'Dragapult ex',
          category: 'Trainer',
          image:
            'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN.png',
        },
        count: 1,
      },
    ]);
    expect(withCatalogFacts(made, catalog)).toBe(made);
  });

  it('brings saved facts up to the catalog, keeping the rest of the card', () => {
    const current = deckCardFromCatalog(CARDS[0]!, { catalog });
    // Saved before a legal reprint: illegal then, and its own image.
    const saved = deckListOf([
      {
        card: {
          ...current,
          image: 'https://example.test/kept.png',
          facts: {
            ...current.facts,
            legal: { standard: false, expanded: false },
          },
        },
        count: 2,
      },
    ]);
    const refreshed = withCatalogFacts(saved, catalog);
    expect(refreshed).not.toBe(saved);
    expect(refreshed[0]!.card.facts).toEqual(current.facts);
    expect(refreshed[0]!.card.image).toBe('https://example.test/kept.png');
    expect(refreshed[0]!.count).toBe(2);
    expect(withCatalogFacts(refreshed, catalog)).toBe(refreshed);
  });
});

describe('decklist text', () => {
  it('writes the Pokémon TCG Live export shape', () => {
    const list = deckListOf([
      { card: deckCardFromCatalog(CARDS[4]!), count: 8 },
      { card: deckCardFromCatalog(CARDS[0]!), count: 4 },
      {
        card: {
          id: 'custom:x',
          name: 'Homemade',
          category: 'Trainer',
          image: 'x',
        },
        count: 1,
      },
    ]);
    expect(formatDecklistText(list)).toBe(
      [
        'Pokémon: 4',
        '4 Dreepy TWM 128',
        '',
        'Trainer: 1',
        '1 Homemade',
        '',
        'Energy: 8',
        '8 Fire Energy MEE 2',
        '',
        'Total Cards: 13',
      ].join('\n')
    );
  });

  it('reads back through the decklist parser', () => {
    const list = deckListOf([
      { card: deckCardFromCatalog(CARDS[1]!), count: 3 },
    ]);
    const parsed = parsePastedDecklist(formatDecklistText(list));
    expect(parsed.ok && parsed.rows).toEqual([
      expect.objectContaining({
        quantity: 3,
        name: 'Dragapult ex',
        setCode: 'TWM',
        number: '130',
      }),
    ]);
  });
});
