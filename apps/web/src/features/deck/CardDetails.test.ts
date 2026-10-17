import { decodeCatalog, type DeckCard } from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import { cardDetailsFacts } from './CardDetails.js';

const catalog = decodeCatalog(fixture);
const scan =
  'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_DE.png';

describe('card details', () => {
  it('finds a deck card kept under its own id by its printing', () => {
    // A file's German scan, kept apart from the English one.
    const card: DeckCard = {
      id: 'custom:german',
      name: 'Dragapult ex',
      category: 'Pokémon',
      image: scan,
      set: 'TWM',
      number: '130',
    };
    expect(cardDetailsFacts(catalog, { kind: 'deck', card })?.card.id).toBe(
      'TWM 130'
    );
    // Typed otherwise in the card dialog, it is the maker's card.
    expect(
      cardDetailsFacts(catalog, {
        kind: 'deck',
        card: { ...card, category: 'Trainer' },
      })
    ).toBeUndefined();
  });
});
