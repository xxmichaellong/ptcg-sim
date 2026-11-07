import {
  catalogCardText,
  decodeCatalog,
  deckCardPrint,
  splitPrint,
} from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../tests/fixtures/card-catalog.json';
import { resolveCardText } from './card-text.js';

const catalog = decodeCatalog(fixture);
const ready = { status: 'ready', catalog } as const;

describe('a card’s text on the table (ADR-043)', () => {
  it('reads a catalogued card’s text by its print', () => {
    const charizard = catalog.byId.get('OBF 125')!;
    const resolved = resolveCardText(
      {
        name: 'Charizard ex',
        imageUrl: 'https://example.test/someone-elses-scan.png',
        print: 'OBF 125',
      },
      ready
    );
    expect(resolved).toEqual({
      status: 'catalog',
      text: catalogCardText(charizard),
    });
    if (resolved.status !== 'catalog') return;
    expect(resolved.text.hp).toBe(330);
    expect(resolved.text.abilities?.[0]?.name).toBe('Infernal Reign');
    expect(resolved.text.attacks?.[0]).toMatchObject({
      name: 'Burning Darkness',
      damage: '180+',
    });
  });

  it('reads it by its picture where the room kept no print, and only under its own name', () => {
    const charizard = catalog.byId.get('OBF 125')!;
    expect(
      resolveCardText(
        { name: 'Charizard ex', imageUrl: charizard.image },
        ready
      )
    ).toMatchObject({ status: 'catalog' });
    // A print that goes by another name is not this card.
    expect(
      resolveCardText(
        { name: 'Pikachu', imageUrl: '/pikachu.png', print: 'OBF 125' },
        ready
      )
    ).toEqual({ status: 'none' });
  });

  it('prefers a deck’s own text, waits for the catalog, and knows when nothing will tell', () => {
    const own = { hp: 999, rules: 'Made at home.' };
    expect(
      resolveCardText(
        {
          name: 'Charizard ex',
          imageUrl: '/x.png',
          print: 'OBF 125',
          text: own,
        },
        ready
      )
    ).toEqual({ status: 'own', text: own });
    const card = { name: 'Charizard ex', imageUrl: '/x.png', print: 'OBF 125' };
    expect(resolveCardText(card, { status: 'loading' })).toEqual({
      status: 'pending',
    });
    expect(resolveCardText(card, { status: 'idle' })).toEqual({
      status: 'pending',
    });
    expect(resolveCardText(card, { status: 'failed' })).toEqual({
      status: 'none',
    });
    expect(resolveCardText(undefined, ready)).toEqual({ status: 'none' });
  });

  it('knows a deck card’s print by its set and number, or an id that is one', () => {
    expect(deckCardPrint({ id: 'x', set: 'obf', number: '125' })).toBe(
      'OBF 125'
    );
    expect(deckCardPrint({ id: 'PAL 185' })).toBe('PAL 185');
    expect(deckCardPrint({ id: 'custom:abc' })).toBeUndefined();
    expect(splitPrint('PAL 185')).toEqual({ set: 'PAL', number: '185' });
    expect(splitPrint('PAL185')).toBeUndefined();
  });
});
