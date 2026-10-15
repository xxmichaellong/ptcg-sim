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
