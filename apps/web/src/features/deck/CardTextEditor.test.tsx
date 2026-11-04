import {
  deckListOf,
  sameDeckList,
  setCardText,
  swapPrinting,
  type DeckCard,
  type DeckCardText,
} from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import {
  hasUnnamedMoves,
  isWritableCardText,
  tidyCardText,
} from './CardTextEditor.js';

/** A card's own text as a player writes it (ADR-043). */

describe('a card’s own text', () => {
  it('is tidied: words trimmed, nothing empty kept, moves with no name left out', () => {
    expect(
      tidyCardText({
        hp: 0,
        stage: ' ',
        evolvesFrom: 'Charmander',
        abilities: [{ name: '  ', kind: 'Ability', text: '' }],
        attacks: [
          { name: ' Ember ', cost: ['Fire'], damage: ' 30 ', text: '  ' },
        ],
        rules: '',
      })
    ).toEqual({
      evolvesFrom: 'Charmander',
      attacks: [{ name: 'Ember', cost: ['Fire'], damage: '30' }],
    });
    // A Basic evolves from nothing.
    expect(tidyCardText({ stage: 'Basic', evolvesFrom: 'Anything' })).toEqual({
      stage: 'Basic',
    });
    expect(tidyCardText({})).toBeUndefined();
    expect(tidyCardText({ hp: 0, rules: '  ' })).toBeUndefined();
  });

  it('notices a move written with no name, and text too long for the table', () => {
    const unnamed: DeckCardText = {
      attacks: [{ name: '', cost: ['Fire'], damage: '' }],
    };
    expect(hasUnnamedMoves(unnamed)).toBe(true);
    expect(
      hasUnnamedMoves({ attacks: [{ name: '', cost: [], damage: '' }] })
    ).toBe(false);
    expect(isWritableCardText(undefined)).toBe(true);
    expect(isWritableCardText({ rules: 'Draw a card.' })).toBe(true);
    expect(isWritableCardText({ rules: 'x'.repeat(1_001) })).toBe(false);
  });

  it('is set on every copy of a card in a deck, and taken off again', () => {
    const card = (id: string): DeckCard => ({
      id,
      name: id,
      category: 'Pokémon',
      image: `/${id}.png`,
    });
    const list = deckListOf([
      { card: card('OBF 125'), count: 2 },
      { card: card('PAF 7'), count: 1 },
    ]);
    const text: DeckCardText = { hp: 340 };
    const edited = setCardText(list, ['OBF 125'], text);
    expect(edited[0]).toEqual({ card: { ...card('OBF 125'), text }, count: 2 });
    expect(edited[1]).toBe(list[1]);
    const printed = setCardText(edited, ['OBF 125'], undefined);
    expect(printed[0]?.card).not.toHaveProperty('text');
    // Nothing to take off: the same list back.
    expect(setCardText(list, ['PAF 7'], undefined)).toBe(list);
  });

  it('is part of what a seat compares: an edit reaches the table', () => {
    const card: DeckCard = {
      id: 'OBF 125',
      name: 'Charizard ex',
      category: 'Pokémon',
      image: '/c.png',
    };
    const plain = deckListOf([{ card, count: 1 }]);
    const edited = setCardText(plain, ['OBF 125'], { hp: 340 });
    expect(sameDeckList(plain, edited)).toBe(false);
    expect(
      sameDeckList(edited, setCardText(plain, ['OBF 125'], { hp: 340 }))
    ).toBe(true);
  });

  it('goes with its copies to another print, one already in the deck too', () => {
    const card = (id: string, text?: DeckCardText): DeckCard => ({
      id,
      name: 'Charizard ex',
      category: 'Pokémon',
      image: `/${id}.png`,
      ...(text ? { text } : {}),
    });
    const text: DeckCardText = { hp: 340 };
    const into = swapPrinting(
      deckListOf([
        { card: card('OBF 125', text), count: 2 },
        { card: card('PAF 54'), count: 1 },
      ]),
      ['OBF 125'],
      card('PAF 54')
    );
    expect(into).toEqual([{ card: card('PAF 54', text), count: 3 }]);
    // A print not in the deck yet takes it as it goes in.
    const fresh = swapPrinting(
      deckListOf([{ card: card('OBF 125', text), count: 2 }]),
      ['OBF 125'],
      card('OBF 215')
    );
    expect(fresh).toEqual([{ card: card('OBF 215', text), count: 2 }]);
  });
});
