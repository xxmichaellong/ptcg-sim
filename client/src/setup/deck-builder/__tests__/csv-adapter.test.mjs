import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatImageUrl,
  formatCardType,
  serializeDeckToSimCsv,
  parseSimCsv,
} from '../core/csv-adapter.mjs';

test('formatImageUrl uses images.large for database cards', () => {
  const card = {
    id: 'sv1-1',
    images: { large: 'https://example.com/card.png' },
    supertype: 'Pokémon',
  };

  assert.equal(formatImageUrl(card), 'https://example.com/card.png');
});

test('formatImageUrl preserves direct image for formatted deck cards', () => {
  const card = {
    image: 'https://example.com/direct.png',
    supertype: 'Trainer',
  };

  assert.equal(formatImageUrl(card), 'https://example.com/direct.png');
});

test('serializeDeckToSimCsv emits the simulator header and rows', () => {
  const deck = {
    Pikachu: {
      totalCount: 2,
      cards: [
        {
          count: 2,
          data: {
            id: 'sv1-25',
            name: 'Pikachu',
            supertype: 'Pokémon',
            images: { large: 'https://example.com/pikachu.png' },
          },
        },
      ],
    },
  };

  const csv = serializeDeckToSimCsv(deck);

  assert.equal(
    csv,
    'QTY,Name,Type,URL\n2,Pikachu,Pokémon,https://example.com/pikachu.png'
  );
});

test('serializeDeckToSimCsv emits one row per card variation', () => {
  const deck = {
    Pikachu: {
      totalCount: 3,
      cards: [
        {
          count: 2,
          data: {
            id: 'sv1-25',
            name: 'Pikachu',
            supertype: 'Pokémon',
            images: { large: 'https://example.com/pikachu-a.png' },
          },
        },
        {
          count: 1,
          data: {
            image: 'https://example.com/pikachu-b.png',
            supertype: 'Pokémon',
          },
        },
      ],
    },
  };

  const csv = serializeDeckToSimCsv(deck);
  const lines = csv.split('\n');

  assert.equal(lines[0], 'QTY,Name,Type,URL');
  assert.equal(lines[1], '2,Pikachu,Pokémon,https://example.com/pikachu-a.png');
  assert.equal(lines[2], '1,Pikachu,Pokémon,https://example.com/pikachu-b.png');
});

test('parseSimCsv parses simulator CSV into grouped deck structure', () => {
  const csv = [
    'QTY,Name,Type,URL',
    '2,Pikachu,Pokémon,https://example.com/pikachu.png',
    '1,Switch,Trainer,https://example.com/switch.png',
  ].join('\n');

  const deck = parseSimCsv(csv);

  assert.equal(deck.Pikachu.totalCount, 2);
  assert.equal(deck.Pikachu.cards[0].count, 2);
  assert.equal(deck.Pikachu.cards[0].data.name, 'Pikachu');
  assert.equal(deck.Switch.totalCount, 1);
  assert.equal(deck.Switch.cards[0].data.supertype, 'Trainer');
});

test('formatCardType returns supertype', () => {
  assert.equal(formatCardType({ supertype: 'Energy' }), 'Energy');
});
