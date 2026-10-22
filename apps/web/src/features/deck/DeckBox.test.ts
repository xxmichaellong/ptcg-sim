import { i18n } from '@lingui/core';
import type { DeckCard, DeckList } from '@ptcgsim/deck-core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeckBox, deckBoxToneOf } from './DeckBox.js';
import { finderMode } from './DeckHome.js';
import { importDeckText } from './deck-import.js';
import { finishName } from './TournamentDecks.js';

const card = (
  name: string,
  category: DeckCard['category'],
  id = name
): DeckCard => ({ id, name, category, image: `/${id}.png` });

describe('a deck box', () => {
  it('shows a whole first character on a box with no cover, an emoji too', () => {
    const initial = (name: string) =>
      /class="deck-box__initial">([^<]*)</u.exec(
        renderToStaticMarkup(createElement(DeckBox, { cover: undefined, name }))
      )?.[1];
    expect(initial('dragons')).toBe('D');
    expect(initial('🐉 Dragons')).toBe('🐉');
    // A flag, a family and an accent typed apart are one character each.
    expect(initial('🇯🇵 Japan Nats')).toBe('🇯🇵');
    expect(initial('👨‍👩‍👧 Family')).toBe('👨‍👩‍👧');
    expect(initial('e\u0301clair')).toBe('E\u0301');
    // Never a blank box for an invisible mark or space before the name.
    expect(initial('\u200Fdragons')).toBe('D');
    expect(initial('\u200B dragons')).toBe('D');
    expect(initial('\uFEFFdragons')).toBe('D');
  });

  it('capitalises its initial as the page’s language does', () => {
    const locale = i18n.locale;
    i18n.load('tr', {});
    i18n.activate('tr');
    try {
      expect(
        renderToStaticMarkup(
          createElement(DeckBox, { cover: undefined, name: 'ilk deste' })
        )
      ).toContain('class="deck-box__initial">İ<');
    } finally {
      i18n.activate(locale);
    }
  });

  it('wears the colour of the basic Energy its deck plays most of', () => {
    const deck: DeckList = [
      { card: card('Dreepy', 'Pokémon'), count: 4 },
      { card: card('Psychic Energy', 'Energy'), count: 4 },
      { card: card('Fire Energy', 'Energy', 'SVE 2'), count: 3 },
      { card: card('Fire Energy', 'Energy', 'MEE 2'), count: 3 },
      { card: card('Jet Energy', 'Energy'), count: 4 },
    ];
    expect(deckBoxToneOf(deck)).toBe('Fire');
  });

  it('reads basic Energy however a list names it', async () => {
    // Pokémon TCG Live's list, imported before the catalog is in: its
    // names stay as written.
    const live = await importDeckText(
      [
        'Pokémon: 1',
        '4 Charmander MEW 4',
        'Energy: 2',
        '8 Basic {R} Energy SVE 2',
        '3 Basic {P} Energy SVE 5',
      ].join('\n'),
      { fetch: () => Promise.reject(new Error('offline')) }
    );
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.cards.map(({ card }) => card.name)).toContain(
      'Basic {R} Energy'
    );
    expect(deckBoxToneOf(live.cards)).toBe('Fire');
    // Typed by hand: "Basic Fire Energy" counts as Fire.
    expect(
      deckBoxToneOf([
        { card: card('Basic Fire Energy', 'Energy'), count: 8 },
        { card: card('Water Energy', 'Energy'), count: 2 },
      ])
    ).toBe('Fire');
    expect(
      deckBoxToneOf([
        { card: card('Basic {D} Energy Energy', 'Energy'), count: 4 },
        { card: card('Basic Water Energy', 'Energy'), count: 2 },
      ])
    ).toBe('Darkness');
  });

  it('is plain for a deck with no basic Energy, or one not read yet', () => {
    expect(
      deckBoxToneOf([{ card: card('Double Turbo Energy', 'Energy'), count: 4 }])
    ).toBeUndefined();
    expect(deckBoxToneOf(undefined)).toBeUndefined();
  });
});

describe('the finder', () => {
  it("takes one line of words as a deck's name, and a list as a list", () => {
    expect(finderMode('')).toBe('empty');
    expect(finderMode('   ')).toBe('empty');
    expect(finderMode('Charizard')).toBe('search');
    expect(finderMode("N's Zoroark")).toBe('search');
    expect(finderMode('4 Dreepy TWM 128')).toBe('list');
    expect(finderMode('Pokémon: 12')).toBe('list');
    expect(finderMode('Pokemon (12)')).toBe('list');
    expect(finderMode('QTY,Name,Type,URL')).toBe('list');
    expect(finderMode('Charizard\nPidgeot')).toBe('list');
  });
});

describe("a tournament list's name", () => {
  it('reads as the current decks do: the deck, then its finish', () => {
    expect(finishName('Dragapult', 1, 285)).toBe('Dragapult — 1st of 285');
    expect(finishName('Gardevoir', 2, 67)).toBe('Gardevoir — 2nd of 67');
    expect(finishName('Lugia', 3, 40)).toBe('Lugia — 3rd of 40');
    expect(finishName('Lugia', 11, 40)).toBe('Lugia — 11th of 40');
    expect(finishName('Lugia', 22, 40)).toBe('Lugia — 22nd of 40');
    expect(finishName('Lugia', null, 40)).toBe('Lugia');
  });
});
