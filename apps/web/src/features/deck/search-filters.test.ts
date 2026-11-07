import {
  decodeCatalog,
  parseCardQuery,
  searchCatalog,
} from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import {
  readSearchFilters,
  searchFilterCount,
  withSearchFilter,
  withoutSearchFilters,
} from './search-filters.js';

const { cards } = decodeCatalog(fixture);
const names = (text: string): string[] => [
  ...new Set(
    searchCatalog(cards, parseCardQuery(text), { sort: 'name' }).cards.map(
      (card) => card.name
    )
  ),
];

describe('the More filters drawer in the search box', () => {
  it('reads what was typed onto its controls', () => {
    const filters = readSearchFilters(
      'charizard hp>=200 hp<330 rc<=1 ac<=rrc reg:h,G -has:ability has:rulebox w:fire rs:none !e:PAL,obf r:double_rare a:"Mitsuhiro Arita" from:charmeleon dmg>99'
    );
    expect(filters).toEqual({
      hpMin: 200,
      hpMax: 329,
      retreatMax: 1,
      damageMin: 100,
      cost: ['Fire', 'Fire', 'Colorless'],
      ability: 'no',
      ruleBox: 'yes',
      weakness: 'Fire',
      resistance: 'none',
      marks: ['G', 'H'],
      sets: ['PAL', 'obf'],
      rarities: ['double rare'],
      artist: 'Mitsuhiro Arita',
      evolvesFrom: 'charmeleon',
    });
    expect(searchFilterCount('charizard hp>=200 ac<=rrc t:fire')).toBe(2);
  });

  it('leaves words it has no control for alone', () => {
    const typed = 'hp:200 rc:0 ac<=2 -reg:h w:fire,water -e:PAL t:fire';
    expect(searchFilterCount(typed)).toBe(0);
    expect(withoutSearchFilters(`${typed} hp>=10`)).toBe(typed);
  });

  it('writes a control into the box, in its word’s place', () => {
    let text = 'charizard ';
    text = withSearchFilter(text, 'hpMin', 200);
    expect(text).toBe('charizard hp>=200 ');
    text = withSearchFilter(text, 'cost', ['Colorless', 'Fire', 'Fire']);
    expect(text).toBe('charizard hp>=200 ac<=RRC ');
    text = withSearchFilter(text, 'hpMin', 180);
    expect(text).toBe('charizard hp>=180 ac<=RRC ');
    text = withSearchFilter(text, 'hpMin', undefined);
    expect(text).toBe('charizard ac<=RRC ');
    text = withSearchFilter(text, 'marks', ['H', 'G']);
    text = withSearchFilter(text, 'ability', 'no');
    text = withSearchFilter(text, 'rarities', ['Illustration Rare']);
    text = withSearchFilter(text, 'artist', '  Mitsuhiro  Arita ');
    expect(text).toBe(
      'charizard ac<=RRC reg:G,H -has:ability !r:Illustration_Rare a:Mitsuhiro_Arita '
    );
    expect(readSearchFilters(text)).toMatchObject({
      cost: ['Fire', 'Fire', 'Colorless'],
      marks: ['G', 'H'],
      ability: 'no',
      rarities: ['Illustration Rare'],
      artist: 'Mitsuhiro Arita',
    });
    expect(withoutSearchFilters(text)).toBe('charizard');
  });

  it('finds what the controls mean', () => {
    // Attacks payable with two Fire: RR, R, C, CC -- not LL or CCC.
    const payable = names(withSearchFilter('', 'cost', ['Fire', 'Fire']));
    expect(payable).toEqual(
      expect.arrayContaining(['Charizard ex', 'Charmeleon', 'Gimmighoul'])
    );
    expect(payable).not.toContain('Pikachu ex');
    expect(payable).not.toContain('Fezandipiti ex');
    // A set exactly: typed, "e:PAL" also finds Paldean Fates by its name.
    expect(names('e:PAL')).toContain('Charmander');
    const paldeaEvolved = names(withSearchFilter('', 'sets', ['PAL']));
    expect(paldeaEvolved).toContain('Iono');
    expect(paldeaEvolved).not.toContain('Charmander');
    // A rarity exactly: Rare, not Double rare or ACE SPEC Rare.
    const rare = names(withSearchFilter('', 'rarities', ['Rare']));
    expect(rare).toContain('Munkidori');
    expect(rare).not.toContain('Charizard ex');
    expect(rare).not.toContain('Unfair Stamp');
  });
});
