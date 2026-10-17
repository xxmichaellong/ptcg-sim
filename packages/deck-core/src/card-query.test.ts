import { describe, expect, it } from 'vitest';

import type { CatalogCard, CatalogSet } from './catalog.js';
import {
  compareCollectorNumbers,
  foldText,
  parseCardQuery,
  printsOf,
  searchCatalog,
} from './card-query.js';

const set = (
  id: string,
  code: string,
  released: string,
  official = 200
): CatalogSet => ({
  id,
  code,
  name: id,
  series: released < '2023' ? 'Sword & Shield' : 'Scarlet & Violet',
  released,
  official,
});

const TWM = set('sv06', 'TWM', '2024-05-24', 167);
const SVI = set('sv01', 'SVI', '2023-03-31', 198);
const BRS = set('swsh9', 'BRS', '2022-02-25', 172);

const base = {
  tags: [],
  types: [],
  abilities: [],
  attacks: [],
  dex: [],
  legal: { standard: true, expanded: true },
};

const pokemon = (
  overrides: Partial<CatalogCard> & Pick<CatalogCard, 'name'>
): CatalogCard => ({
  ...base,
  id: `${(overrides.set ?? TWM).code} ${overrides.number ?? '1'}`,
  category: 'Pokémon',
  set: TWM,
  number: '1',
  image: 'large',
  imageSmall: 'small',
  stage: 'Basic',
  printGroup: overrides.name,
  ...overrides,
});

const CARDS: readonly CatalogCard[] = [
  pokemon({
    name: 'Dragapult ex',
    number: '130',
    stage: 'Stage 2',
    tags: ['ex', 'Tera'],
    types: ['Dragon'],
    hp: 320,
    retreat: 1,
    evolvesFrom: 'Drakloak',
    rarity: 'Double rare',
    illustrator: '5ban Graphics',
    regulationMark: 'H',
    dex: [887],
    attacks: [
      { name: 'Jet Headbutt', cost: ['Colorless'], damage: '70' },
      {
        name: 'Phantom Dive',
        cost: ['Fire', 'Psychic'],
        damage: '200',
        text: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.",
      },
    ],
  }),
  pokemon({
    name: 'Dragapult ex',
    number: '200',
    stage: 'Stage 2',
    tags: ['ex', 'Tera'],
    types: ['Dragon'],
    hp: 320,
    rarity: 'Special illustration rare',
    regulationMark: 'H',
  }),
  pokemon({
    name: 'Pikachu',
    set: SVI,
    number: '63',
    types: ['Lightning'],
    hp: 60,
    weakness: 'Fighting',
    retreat: 1,
    regulationMark: 'G',
    legal: { standard: false, expanded: true },
    attacks: [
      { name: 'Thunder Shock', cost: ['Lightning', 'Lightning'], damage: '30' },
    ],
  }),
  pokemon({
    name: 'Radiant Greninja',
    set: BRS,
    number: '46',
    types: ['Water'],
    hp: 130,
    tags: ['Radiant'],
    retreat: 1,
    weakness: 'Lightning',
    legal: { standard: false, expanded: true },
    abilities: [
      {
        kind: 'Ability',
        name: 'Concealed Cards',
        text: 'You must discard an Energy card from your hand in order to use this Ability. Draw 2 cards.',
      },
    ],
    attacks: [
      {
        name: 'Moonlight Shuriken',
        cost: ['Water', 'Water', 'Colorless'],
        damage: '',
      },
    ],
  }),
  {
    ...base,
    id: 'TWM 163',
    name: 'Neutralization Zone',
    category: 'Trainer',
    set: TWM,
    number: '163',
    image: 'l',
    imageSmall: 's',
    trainerType: 'Stadium',
    tags: ['ACE SPEC'],
    text: 'Prevent all damage done to Pokémon that don’t have a Rule Box.',
    printGroup: 'Neutralization Zone',
  },
  {
    ...base,
    id: 'SVI 196',
    name: 'Ultra Ball',
    category: 'Trainer',
    set: SVI,
    number: '196',
    image: 'l',
    imageSmall: 's',
    trainerType: 'Item',
    text: 'You can use this card only if you discard 2 other cards from your hand. Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',
    printGroup: 'Ultra Ball',
  },
  {
    ...base,
    id: 'SVE 4',
    name: 'Lightning Energy',
    category: 'Energy',
    set: set('sve', 'SVE', '2023-03-31', 24),
    number: '4',
    image: 'l',
    imageSmall: 's',
    energyType: 'Basic',
    types: ['Lightning'],
    printGroup: 'Lightning Energy',
  },
];

const names = (query: string, options = {}) =>
  searchCatalog(CARDS, parseCardQuery(query), options).cards.map(
    (card) => `${card.name} ${card.number}`
  );

describe('card search', () => {
  it('matches names by word starts, folding accents and case', () => {
    expect(names('drag')).toEqual(['Dragapult ex 130']);
    expect(names('PIKA')).toEqual(['Pikachu 63']);
    expect(names('greninja radiant')).toEqual(['Radiant Greninja 46']);
    expect(names('apult')).toEqual([]);
  });

  it('shows one print per card unless asked for every print', () => {
    expect(names('dragapult')).toEqual(['Dragapult ex 130']);
    expect(names('dragapult u:prints')).toEqual([
      'Dragapult ex 200',
      'Dragapult ex 130',
    ]);
    const result = searchCatalog(CARDS, parseCardQuery('dragapult'));
    expect(result.printCounts.get('Dragapult ex')).toBe(2);
    expect(printsOf(CARDS, 'Dragapult ex').map((card) => card.number)).toEqual([
      '200',
      '130',
    ]);
  });

  it('filters by type, stage, tags and kind', () => {
    expect(names('t:dragon')).toEqual(['Dragapult ex 130']);
    expect(names('t:l')).toEqual(['Lightning Energy 4', 'Pikachu 63']);
    expect(names('t:supporter')).toEqual([]);
    expect(names('t:stadium')).toEqual(['Neutralization Zone 163']);
    expect(names('t:basic-energy')).toEqual(['Lightning Energy 4']);
    expect(names('t:"basic energy"')).toEqual(['Lightning Energy 4']);
    expect(names('t:special')).toEqual([]);
    expect(names('s:2')).toEqual(['Dragapult ex 130']);
    expect(names('s:basic')).toEqual(['Pikachu 63', 'Radiant Greninja 46']);
    expect(names('is:tera')).toEqual(['Dragapult ex 130']);
    expect(names('is:ace')).toEqual(['Neutralization Zone 163']);
    expect(names('is:radiant,ace')).toEqual([
      'Neutralization Zone 163',
      'Radiant Greninja 46',
    ]);
    expect(names('is:ex+tera')).toEqual(['Dragapult ex 130']);
    expect(names('t:pokemon -is:ex')).toEqual([
      'Pikachu 63',
      'Radiant Greninja 46',
    ]);
  });

  it('compares numbers: HP, retreat, damage and Pokédex', () => {
    expect(names('hp>=130')).toEqual([
      'Dragapult ex 130',
      'Radiant Greninja 46',
    ]);
    expect(names('hp<100')).toEqual(['Pikachu 63']);
    expect(names('rc=1 hp>100')).toEqual([
      'Dragapult ex 130',
      'Radiant Greninja 46',
    ]);
    expect(names('dmg>=200')).toEqual(['Dragapult ex 130']);
    expect(names('dex:887')).toEqual(['Dragapult ex 130']);
  });

  it('reads attack costs as Limitless does', () => {
    expect(names('ac:0')).toEqual([]);
    expect(names('ac:c')).toEqual(['Dragapult ex 130']);
    expect(names('ac<=ll')).toEqual(['Dragapult ex 130', 'Pikachu 63']);
    expect(names('ac>=ww')).toEqual(['Radiant Greninja 46']);
    expect(names('ac:rp')).toEqual(['Dragapult ex 130']);
    expect(names('ac=2')).toEqual(['Dragapult ex 130', 'Pikachu 63']);
  });

  it('searches rules text by words or by exact phrase', () => {
    expect(names('text:shuffle')).toEqual(['Ultra Ball 196']);
    expect(names('text:"damage counters"')).toEqual(['Dragapult ex 130']);
    expect(names('text:draw_2_cards')).toEqual(['Radiant Greninja 46']);
    expect(names('text:draw_3_cards')).toEqual([]);
    expect(names('has:ability')).toEqual(['Radiant Greninja 46']);
    expect(names('has:rulebox')).toEqual([
      'Dragapult ex 130',
      'Radiant Greninja 46',
    ]);
  });

  it('filters by weakness, set, number, artist, rarity, mark, format and evolution', () => {
    expect(names('w:fighting')).toEqual(['Pikachu 63']);
    expect(names('w:none t:pokemon')).toEqual(['Dragapult ex 130']);
    expect(names('e:svi')).toEqual(['Ultra Ball 196', 'Pikachu 63']);
    expect(names('e:TWM n:130')).toEqual(['Dragapult ex 130']);
    expect(names('a:5ban')).toEqual(['Dragapult ex 130']);
    expect(names('r:double')).toEqual(['Dragapult ex 130']);
    expect(names('reg>=h')).toEqual(['Dragapult ex 130']);
    expect(names('reg:g')).toEqual(['Pikachu 63']);
    expect(names('f:standard t:pokemon')).toEqual(['Dragapult ex 130']);
    expect(names('f:expanded t:pokemon')).toEqual([
      'Dragapult ex 130',
      'Pikachu 63',
      'Radiant Greninja 46',
    ]);
    expect(names('from:drakloak')).toEqual(['Dragapult ex 130']);
  });

  it('keeps unknown words as name words, so names with colons still search', () => {
    expect(parseCardQuery('Type: Null').clauses).toEqual([
      { field: 'name', operator: ':', values: ['Type: Null'] },
    ]);
    expect(parseCardQuery('zz:top').clauses[0]?.field).toBe('name');
    expect(parseCardQuery('-"ultra ball"').clauses).toEqual([
      { field: 'name', operator: ':', values: ['ultra ball'], negate: true },
    ]);
  });

  it('sorts by newest, name, HP and type', () => {
    expect(names('t:pokemon o:name')).toEqual([
      'Dragapult ex 130',
      'Pikachu 63',
      'Radiant Greninja 46',
    ]);
    expect(names('t:pokemon o:hp')).toEqual([
      'Dragapult ex 130',
      'Radiant Greninja 46',
      'Pikachu 63',
    ]);
    expect(names('o:oldest')).toEqual([
      'Radiant Greninja 46',
      'Pikachu 63',
      'Ultra Ball 196',
      'Lightning Energy 4',
      'Dragapult ex 130',
      'Neutralization Zone 163',
    ]);
  });

  it('orders collector numbers as printed', () => {
    expect(
      ['10', '2', 'TG10', 'TG2', '185a', '185'].sort(compareCollectorNumbers)
    ).toEqual(['2', '10', '185', '185a', 'TG2', 'TG10']);
  });

  it('folds text for matching', () => {
    expect(foldText('  Pokémon’s  Catcher! ')).toBe("pokemon's catcher");
  });
});
