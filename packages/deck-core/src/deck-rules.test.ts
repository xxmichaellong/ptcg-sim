import { describe, expect, it } from 'vitest';

import {
  addCard,
  deckListOf,
  ruleName,
  sortDeckList,
  coverCardOf,
  hasRuleBox,
  replacePrinting,
  removeCard,
  setCardCount,
  EMPTY_DECK_LIST,
  type CardRuleFacts,
  type DeckCard,
  type DeckList,
} from './deck-list.js';
import {
  checkDeck,
  describeDeckIssue,
  guessDeckFormat,
  basicEnergyTypeOf,
  isBasicEnergy,
  type DeckIssue,
} from './deck-rules.js';

const LEGAL = { standard: true, expanded: true } as const;

const card = (
  id: string,
  name: string,
  category: DeckCard['category'],
  facts: CardRuleFacts = { legal: LEGAL }
): DeckCard => ({
  id,
  name,
  category,
  image: `https://example.com/${encodeURIComponent(id)}.png`,
  facts,
});

const basic = (id: string, name: string, extra: CardRuleFacts = {}) =>
  card(id, name, 'Pokémon', { stage: 'Basic', legal: LEGAL, ...extra });
const item = (id: string, name: string, extra: CardRuleFacts = {}) =>
  card(id, name, 'Trainer', { trainerType: 'Item', legal: LEGAL, ...extra });
const energy = (id: string, name: string) =>
  card(id, name, 'Energy', { energyType: 'Basic', legal: LEGAL });

/** A legal 60: 4 Pikachu, 4 each of 9 Items (36 Items), 20 Lightning Energy. */
const legalSixty = (): DeckList =>
  deckListOf([
    { card: basic('SVI 63', 'Pikachu'), count: 4 },
    ...Array.from({ length: 9 }, (_, index) => ({
      card: item(`SVI ${100 + index}`, `Item ${index}`),
      count: 4,
    })),
    { card: energy('SVE 4', 'Lightning Energy'), count: 20 },
  ]);

const codes = (issues: readonly DeckIssue[]) =>
  issues.map((issue) => issue.code);

describe('deck lists', () => {
  it('adds, merges, counts down and removes printings', () => {
    const pikachu = basic('SVI 63', 'Pikachu');
    let list = addCard(EMPTY_DECK_LIST, pikachu);
    list = addCard(list, pikachu, 2);
    expect(list).toEqual([{ card: pikachu, count: 3 }]);
    list = removeCard(list, pikachu);
    expect(list[0]!.count).toBe(2);
    list = setCardCount(list, pikachu, 0);
    expect(list).toEqual([]);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('swaps a printing in place, merging with one already there', () => {
    const a = basic('SVI 63', 'Pikachu');
    const b = basic('PAF 131', 'Pikachu');
    const switchCard = item('SVI 194', 'Switch');
    let list = deckListOf([
      { card: a, count: 2 },
      { card: switchCard, count: 4 },
    ]);
    list = replacePrinting(list, a.id, b);
    expect(list.map((entry) => [entry.card.id, entry.count])).toEqual([
      ['PAF 131', 2],
      ['SVI 194', 4],
    ]);
    list = addCard(list, a);
    list = replacePrinting(list, a.id, b);
    expect(list.map((entry) => [entry.card.id, entry.count])).toEqual([
      ['PAF 131', 3],
      ['SVI 194', 4],
    ]);
  });

  it('groups Pokémon by evolution line, biggest line first', () => {
    const list = deckListOf([
      // Rare Candy skips Pidgeotto: the catalog names the line.
      {
        card: card('A', 'Pidgeot ex', 'Pokémon', {
          stage: 'Stage 2',
          evolvesFrom: 'Pidgeotto',
          line: 'Pidgey',
        }),
        count: 2,
      },
      {
        card: card('B', 'Dragapult ex', 'Pokémon', {
          stage: 'Stage 2',
          evolvesFrom: 'Drakloak',
        }),
        count: 3,
      },
      { card: card('C', 'Pidgey', 'Pokémon', { stage: 'Basic' }), count: 2 },
      { card: card('D', 'Dreepy', 'Pokémon', { stage: 'Basic' }), count: 4 },
      {
        card: card('E', 'Drakloak', 'Pokémon', {
          stage: 'Stage 1',
          evolvesFrom: 'Dreepy',
        }),
        count: 4,
      },
      {
        card: card('F', 'Fezandipiti ex', 'Pokémon', { stage: 'Basic' }),
        count: 1,
      },
    ]);
    expect(sortDeckList(list).map((entry) => entry.card.name)).toEqual([
      'Dreepy',
      'Drakloak',
      'Dragapult ex',
      'Pidgey',
      'Pidgeot ex',
      'Fezandipiti ex',
    ]);
  });

  it('reads like Pokémon TCG Live: Pokémon, Supporters, Items, Tools, Stadiums, Energy', () => {
    const list = deckListOf([
      { card: energy('SVE 4', 'Lightning Energy'), count: 8 },
      {
        card: card('X 1', 'Stadium', 'Trainer', { trainerType: 'Stadium' }),
        count: 1,
      },
      { card: item('X 2', 'Nest Ball'), count: 4 },
      {
        card: card('X 3', 'Iono', 'Trainer', { trainerType: 'Supporter' }),
        count: 4,
      },
      {
        card: card('X 4', 'Raichu', 'Pokémon', { stage: 'Stage 1' }),
        count: 2,
      },
      { card: basic('X 5', 'Pikachu'), count: 4 },
      {
        card: card('X 6', 'Jet Energy', 'Energy', { energyType: 'Special' }),
        count: 2,
      },
    ]);
    expect(sortDeckList(list).map((entry) => entry.card.name)).toEqual([
      'Pikachu',
      'Raichu',
      'Iono',
      'Nest Ball',
      'Stadium',
      'Jet Energy',
      'Lightning Energy',
    ]);
  });

  it('pictures a deck by its main attacker', () => {
    const list = deckListOf([
      { card: basic('TWM 128', 'Dreepy'), count: 4 },
      {
        card: card('TWM 130', 'Dragapult', 'Pokémon', { stage: 'Stage 2' }),
        count: 3,
      },
    ]);
    expect(coverCardOf(list)?.name).toBe('Dreepy');
    const tagged = deckListOf([
      { card: basic('TWM 128', 'Dreepy'), count: 4 },
      {
        card: card('TWM 130', 'Dragapult ex', 'Pokémon', {
          stage: 'Stage 2',
          tags: ['ex'],
        }),
        count: 3,
      },
    ]);
    expect(coverCardOf(tagged)?.name).toBe('Dragapult ex');
  });

  it('pictures a deck named for its Pokémon by the first one named', () => {
    const list = deckListOf([
      {
        card: basic('MEG 104', 'Mega Kangaskhan ex', { tags: ['ex', 'Mega'] }),
        count: 4,
      },
      { card: basic('SCR 84', 'Dwebble'), count: 3 },
      {
        card: card('SCR 85', 'Crustle', 'Pokémon', { stage: 'Stage 1' }),
        count: 3,
      },
      { card: basic('JTG 95', "N's Zorua"), count: 4 },
      {
        card: card('JTG 98', "N's Zoroark ex", 'Pokémon', {
          stage: 'Stage 1',
          tags: ['ex'],
        }),
        count: 3,
      },
    ]);
    expect(coverCardOf(list, 'Crustle')?.name).toBe('Crustle');
    // Words are matched whole and without case; the strongest print wins.
    expect(coverCardOf(list, "n's zoroark")?.name).toBe("N's Zoroark ex");
    // A name that calls no Pokémon in the list falls back to the attacker.
    expect(coverCardOf(list, 'Basic Box')?.name).toBe('Mega Kangaskhan ex');
    expect(coverCardOf(list, 'Pikachu')?.name).toBe('Mega Kangaskhan ex');
  });

  it('knows a rule-box Pokémon by its name or its tags', () => {
    for (const name of [
      'Dragapult ex',
      'Mew VMAX',
      'Arceus VSTAR',
      'Pikachu-GX',
      'M Rayquaza-EX',
      'Mega Lucario ex',
    ])
      expect(hasRuleBox(basic('X 1', name))).toBe(true);
    for (const name of ['Dreepy', 'Vikavolt', 'Exeggutor', "N's Zorua"])
      expect(hasRuleBox(basic('X 1', name))).toBe(false);
    expect(hasRuleBox(basic('X 1', 'Lugia', { tags: ['V'] }))).toBe(true);
    expect(hasRuleBox(card('X 2', 'Professor Burnet ex', 'Trainer'))).toBe(
      false
    );
  });

  it('counts copies by name, ignoring a Trainer subtitle, spacing and accents', () => {
    expect(
      ruleName({
        name: "Professor's Research (Professor Turo)",
        category: 'Trainer',
      })
    ).toBe(ruleName({ name: 'Professor’s Research', category: 'Trainer' }));
    expect(ruleName({ name: 'Pokémon Catcher', category: 'Trainer' })).toBe(
      'pokemon catcher'
    );
    expect(ruleName({ name: 'Unown (A)', category: 'Pokémon' })).toBe(
      'unown (a)'
    );
    // A Pokémon-EX is another Pokémon than a Pokémon ex, however spelled.
    const ex = ruleName({ name: 'Rayquaza ex', category: 'Pokémon' });
    const upper = ruleName({ name: 'Rayquaza EX', category: 'Pokémon' });
    expect(upper).not.toBe(ex);
    expect(ruleName({ name: 'Rayquaza-EX', category: 'Pokémon' })).toBe(upper);
    expect(ruleName({ name: 'rayquaza  ex', category: 'Pokémon' })).toBe(ex);
    // A level isn't part of the name: a LV.X shares its Pokémon's four.
    expect(ruleName({ name: 'Luxray GL LV.X', category: 'Pokémon' })).toBe(
      ruleName({ name: 'Luxray GL', category: 'Pokémon' })
    );
  });
});

describe('deck rules', () => {
  it('accepts a legal Standard deck', () => {
    const check = checkDeck(legalSixty(), 'standard');
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.total).toBe(60);
  });

  it('needs exactly 60 cards, saying how many are missing or extra', () => {
    const short = removeCard(legalSixty(), { id: 'SVE 4' }, 2);
    const check = checkDeck(short, 'standard');
    expect(check.errors).toEqual([{ code: 'size', count: 58, required: 60 }]);
    expect(describeDeckIssue(short, check.errors[0]!)).toBe(
      '2 more cards needed (58/60).'
    );
    const long = addCard(legalSixty(), energy('SVE 4', 'Lightning Energy'));
    expect(
      describeDeckIssue(long, checkDeck(long, 'standard').errors[0]!)
    ).toBe('1 card too many (61/60).');
  });

  it('limits copies by name across printings, but never Basic Energy', () => {
    let list = legalSixty();
    list = removeCard(list, { id: 'SVE 4' });
    list = addCard(list, basic('PAF 131', 'Pikachu'));
    const check = checkDeck(list, 'standard');
    expect(check.errors).toEqual([
      expect.objectContaining({
        code: 'copies',
        name: 'Pikachu',
        count: 5,
        limit: 4,
      }),
    ]);
    expect((check.errors[0] as { cardIds: string[] }).cardIds).toEqual([
      'SVI 63',
      'PAF 131',
    ]);
  });

  it('limits Special Energy to four, where v1 let any Energy through', () => {
    let list = removeCard(legalSixty(), { id: 'SVE 4' }, 5);
    list = addCard(
      list,
      card('PAR 191', 'Reversal Energy', 'Energy', {
        energyType: 'Special',
        legal: LEGAL,
      }),
      5
    );
    expect(codes(checkDeck(list, 'standard').errors)).toEqual(['copies']);
  });

  it('takes a hand-typed Basic Energy at its name', () => {
    expect(
      isBasicEnergy({
        id: 'custom:x',
        name: 'Basic Fire Energy',
        category: 'Energy',
        image: 'x',
      })
    ).toBe(true);
    // Pokémon TCG Live writes Basic Energy by its symbol.
    expect(
      isBasicEnergy({
        id: 'custom:r',
        name: 'Basic {R} Energy',
        category: 'Energy',
        image: 'x',
      })
    ).toBe(true);
    expect(
      isBasicEnergy({
        id: 'custom:y',
        name: 'Double Turbo Energy',
        category: 'Energy',
        image: 'x',
      })
    ).toBe(false);
  });

  it('reads basic Energy however a list writes it, and nothing else', () => {
    for (const [name, type] of [
      ['Fire Energy', 'fire'],
      ['Basic Fire Energy', 'fire'],
      ['Basic {R} Energy', 'fire'],
      ['Basic {M} Energy Energy', 'metal'],
      ['Basic Fire Energy null', 'fire'],
      ['Dark Energy', 'darkness'],
      ['basic r energy', 'fire'],
      ['{R} Energy', 'fire'],
    ] as const) {
      expect(basicEnergyTypeOf(name), name).toBe(type);
      expect(
        isBasicEnergy({
          id: `custom:${name}`,
          name,
          category: 'Energy',
          image: 'x',
        }),
        name
      ).toBe(true);
    }
    for (const name of [
      'Double Turbo Energy',
      'Basic {X} Energy',
      'Fire Energy Retrieval',
      'Energy',
      // Team Rocket Returns' Special Energy.
      'R Energy',
      'r energy',
    ]) {
      expect(basicEnergyTypeOf(name), name).toBeUndefined();
    }
  });

  it('needs a Basic Pokémon, unless a hand-typed Pokémon might be one', () => {
    let list = removeCard(legalSixty(), { id: 'SVI 63' }, 4);
    list = addCard(
      list,
      card('X 9', 'Raichu', 'Pokémon', { stage: 'Stage 1', legal: LEGAL }),
      4
    );
    expect(codes(checkDeck(list, 'standard').errors)).toEqual(['no_basic']);
    const unknown = deckListOf([
      ...list.filter((entry) => entry.card.id !== 'X 9'),
      {
        card: {
          id: 'custom:p',
          name: 'Mystery',
          category: 'Pokémon',
          image: 'x',
        },
        count: 4,
      },
    ]);
    expect(codes(checkDeck(unknown, 'standard').errors)).not.toContain(
      'no_basic'
    );
    // A Baby Pokémon (Skyridge's Cleffa) starts a game as a Basic does.
    const babies = addCard(
      list,
      card('SK 17', 'Cleffa', 'Pokémon', { stage: 'Baby', legal: LEGAL }),
      4
    );
    expect(codes(checkDeck(babies, 'standard').errors)).not.toContain(
      'no_basic'
    );
  });

  it('allows one ACE SPEC, one Radiant and one Pokémon ☆ per deck', () => {
    let list = removeCard(legalSixty(), { id: 'SVE 4' }, 4);
    list = addCard(
      list,
      item('TEF 144', 'Prime Catcher', { tags: ['ACE SPEC'] })
    );
    list = addCard(
      list,
      item('TWM 163', 'Neutralization Zone', { tags: ['ACE SPEC'] })
    );
    list = addCard(
      list,
      basic('ASR 46', 'Radiant Greninja', { tags: ['Radiant'] })
    );
    list = addCard(
      list,
      basic('LOR 27', 'Radiant Charizard', { tags: ['Radiant'] })
    );
    const errors = checkDeck(list, 'unlimited').errors;
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'one_per_deck',
        kind: 'ACE SPEC',
        count: 2,
      }),
      expect.objectContaining({
        code: 'one_per_deck',
        kind: 'Radiant',
        count: 2,
      }),
    ]);
  });

  it('allows one copy of each Prism Star card', () => {
    let list = removeCard(legalSixty(), { id: 'SVE 4' }, 2);
    list = addCard(
      list,
      card('UPR 61', 'Giratina ◇', 'Pokémon', {
        stage: 'Basic',
        tags: ['Prism Star'],
      }),
      2
    );
    expect(codes(checkDeck(list, 'unlimited').errors)).toEqual(['prism_star']);
  });

  it('reports cards a format does not allow, and cards it cannot check', () => {
    let list = removeCard(legalSixty(), { id: 'SVE 4' }, 2);
    list = addCard(
      list,
      item('BRS 132', 'Ultra Ball', {
        legal: { standard: false, expanded: true },
      })
    );
    list = addCard(list, {
      id: 'custom:z',
      name: 'Homemade',
      category: 'Trainer',
      image: 'x',
    });
    const standard = checkDeck(list, 'standard');
    expect(standard.errors).toEqual([
      { code: 'not_legal', cardIds: ['BRS 132'] },
    ]);
    expect(standard.warnings).toEqual([
      { code: 'unchecked', cardIds: ['custom:z'] },
    ]);
    expect(standard.valid).toBe(false);
    const expanded = checkDeck(list, 'expanded');
    expect(expanded.valid).toBe(true);
    expect(checkDeck(list, 'unlimited').warnings).toEqual([]);
  });

  it('builds Pocket decks of 20 with two copies and no Energy', () => {
    const pocket = (id: string, name: string, stage = 'Basic'): DeckCard => ({
      id,
      name,
      category: 'Pokémon',
      image: `https://example.com/tcgp/${id}.webp`,
      facts: { stage, pocket: true },
    });
    const list = deckListOf([
      { card: pocket('A1 1', 'Bulbasaur'), count: 2 },
      { card: pocket('A1 2', 'Ivysaur', 'Stage 1'), count: 3 },
      ...Array.from({ length: 15 }, (_, index) => ({
        card: pocket(`A1 ${10 + index}`, `Mon ${index}`),
        count: 1,
      })),
    ]);
    expect(guessDeckFormat(list)).toBe('pocket');
    const check = checkDeck(list, 'pocket');
    expect(codes(check.errors)).toEqual(['copies']);
    expect(codes(checkDeck(list, 'standard').errors)).toContain('wrong_pool');
  });

  it('guesses the format a list was built for', () => {
    expect(guessDeckFormat(legalSixty())).toBe('standard');
    const expanded = addCard(
      legalSixty(),
      item('BRS 132', 'Ultra Ball', {
        legal: { standard: false, expanded: true },
      })
    );
    expect(guessDeckFormat(expanded)).toBe('expanded');
    const old = addCard(
      legalSixty(),
      item('BS 1', 'Old', { legal: { standard: false, expanded: false } })
    );
    expect(guessDeckFormat(old)).toBe('unlimited');
  });
});
