import { describe, expect, it } from 'vitest';

import {
  archetypeSearchText,
  coreName,
  ftsQuery,
  normalizeName,
  searchTerms,
} from './normalize.js';

describe('deck names as a player types them', () => {
  it('drops case, accents and apostrophes', () => {
    expect(normalizeName('N’s Zoroark')).toBe('ns zoroark');
    expect(normalizeName("N's  Zoroark!")).toBe('ns zoroark');
    expect(normalizeName('Pokémon Énergie')).toBe('pokemon energie');
    expect(normalizeName('  Mega-Charizard X ex ')).toBe('mega charizard x ex');
  });

  it('lets a search leave out ex, V, VSTAR, VMAX, GX and Mega', () => {
    expect(searchTerms('Gardevoir ex')).toEqual(['gardevoir']);
    expect(searchTerms('mega charizard x')).toEqual(['charizard', 'x']);
    expect(searchTerms('Giratina VSTAR')).toEqual(['giratina']);
  });

  it('keeps optional words when the search is nothing else', () => {
    expect(searchTerms('ex')).toEqual(['ex']);
    expect(searchTerms('  ')).toEqual([]);
  });

  it('builds a prefix query from letters and digits only', () => {
    expect(ftsQuery(['charz', '151'])).toBe('"charz"* "151"*');
    expect(ftsQuery([])).toBeNull();
    expect(ftsQuery(searchTerms('"; DROP TABLE x; --'))).toBe(
      '"drop"* "table"* "x"*'
    );
  });

  it('finds an archetype by its name, its id and its icons', () => {
    expect(
      archetypeSearchText({
        id: 'mega-charizard-x-ex',
        name: 'Mega Charizard X ex',
        icons: ['charizard-mega-x'],
      })
    ).toBe('mega charizard x ex mega charizard x ex charizard mega x');
  });

  it('compares names without their optional words', () => {
    expect(coreName('Gardevoir ex')).toBe('gardevoir');
    expect(coreName('gardevoir')).toBe('gardevoir');
    expect(coreName('Dragapult Dusknoir')).toBe('dragapult dusknoir');
  });
});
