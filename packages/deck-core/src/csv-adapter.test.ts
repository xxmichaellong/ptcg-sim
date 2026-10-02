import { describe, expect, it } from 'vitest';

import {
  DeckCsvParseError,
  formatCardType,
  formatImageUrl,
  MAX_DECK_CARD_QUANTITY,
  MAX_DECK_IMAGE_URL_CODE_UNITS,
  parseSimCsv,
  parseSimCsvResult,
  serializeDeckToSimCsv,
} from './csv-adapter.js';
import type { Deck } from './types.js';

describe('legacy simulator CSV parity', () => {
  it('uses images.large for database cards', () => {
    expect(
      formatImageUrl({
        id: 'sv1-1',
        images: { large: 'https://example.com/card.png' },
        supertype: 'Pokémon',
      })
    ).toBe('https://example.com/card.png');
  });

  it('preserves direct images and the legacy asset conversion', () => {
    expect(
      formatImageUrl({
        image: 'https://example.com/direct.png',
        supertype: 'Trainer',
      })
    ).toBe('https://example.com/direct.png');
    expect(formatImageUrl({ image: 'assets/cards/a.png' })).toBe(
      'https://tishinator.github.io/PTCGDeckBuilderassets/cards/a.png'
    );
  });

  it('returns the supertype as the card type', () => {
    expect(formatCardType({ supertype: 'Energy' })).toBe('Energy');
  });

  it('serializes the exact simulator header and a row per variation', () => {
    const deck: Deck = {
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
    expect(serializeDeckToSimCsv(deck)).toBe(
      [
        'QTY,Name,Type,URL',
        '2,Pikachu,Pokémon,https://example.com/pikachu-a.png',
        '1,Pikachu,Pokémon,https://example.com/pikachu-b.png',
      ].join('\n')
    );
  });

  it('parses valid rows into the legacy grouped shape', () => {
    const deck = parseSimCsv(
      [
        'QTY,Name,Type,URL',
        '2,Pikachu,Pokémon,https://example.com/pikachu.png',
        '1,Switch,Trainer,https://example.com/switch.png',
      ].join('\n')
    );
    expect(deck.Pikachu?.totalCount).toBe(2);
    expect(deck.Pikachu?.cards[0]).toMatchObject({
      count: 2,
      data: { count: '2', name: 'Pikachu', supertype: 'Pokémon' },
    });
    expect(deck.Switch?.cards[0]?.data.supertype).toBe('Trainer');
  });

  it('merges repeated name and image rows', () => {
    const result = parseSimCsvResult(
      'QTY,Name,Type,URL\n2,Pikachu,Pokémon,url\n3,Pikachu,Pokémon,url'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.Pikachu?.cards).toHaveLength(1);
      expect(result.deck.Pikachu?.cards[0]?.count).toBe(5);
      expect(result.deck.Pikachu?.totalCount).toBe(5);
    }
  });
});

describe('transactional bounded simulator CSV parsing', () => {
  it('round trips commas, quotes, and newlines using RFC 4180 quoting', () => {
    const original: Deck = {
      'Misty, Determined': {
        totalCount: 1,
        cards: [
          {
            count: 1,
            data: {
              supertype: 'Trainer',
              image: 'https://example.com/"quoted",image\nline.png',
            },
          },
        ],
      },
    };
    const result = parseSimCsvResult(serializeDeckToSimCsv(original));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck['Misty, Determined']?.cards[0]?.data.image).toBe(
        'https://example.com/"quoted",image\nline.png'
      );
    }
  });

  it('accepts BOM and CRLF input', () => {
    const result = parseSimCsvResult(
      '\uFEFFQTY,Name,Type,URL\r\n1,Pikachu,Pokémon,url\r\n'
    );
    expect(result.ok).toBe(true);
  });

  it('fails the whole transaction on malformed quoting', () => {
    const result = parseSimCsvResult(
      'QTY,Name,Type,URL\n1,"Pikachu,Pokémon,url'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'unterminated_quote', row: 2 })
      );
    }
  });

  it.each([
    ['wrong header', 'QTY,Name,URL\n1,Pikachu,url', 'invalid_header'],
    [
      'wrong columns',
      'QTY,Name,Type,URL\n1,Pikachu,Pokémon',
      'invalid_column_count',
    ],
    [
      'zero count',
      'QTY,Name,Type,URL\n0,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    [
      'fractional count',
      'QTY,Name,Type,URL\n1.5,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    [
      'exponent count',
      'QTY,Name,Type,URL\n1e2,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    ['missing name', 'QTY,Name,Type,URL\n1,,Pokémon,url', 'missing_name'],
    ['missing type', 'QTY,Name,Type,URL\n1,Pikachu,,url', 'missing_type'],
    ['missing URL', 'QTY,Name,Type,URL\n1,Pikachu,Pokémon,', 'missing_url'],
  ])('rejects %s without returning a partial deck', (_name, source, code) => {
    const result = parseSimCsvResult(source);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.some((issue) => issue.code === code)).toBe(true);
  });

  it('bounds per-row quantities and image URLs', () => {
    const quantity = parseSimCsvResult(
      `QTY,Name,Type,URL\n${MAX_DECK_CARD_QUANTITY + 1},Pikachu,Pokémon,url`
    );
    const url = parseSimCsvResult(
      `QTY,Name,Type,URL\n1,Pikachu,Pokémon,${'x'.repeat(MAX_DECK_IMAGE_URL_CODE_UNITS + 1)}`
    );
    expect(quantity.ok).toBe(false);
    expect(url.ok).toBe(false);
  });

  it('throws a typed aggregate error through the compatibility helper', () => {
    expect(() => parseSimCsv('not csv')).toThrow(DeckCsvParseError);
    try {
      parseSimCsv('not csv');
    } catch (error) {
      expect(error).toBeInstanceOf(DeckCsvParseError);
      if (error instanceof DeckCsvParseError) {
        expect(error.issues[0]?.code).toBe('invalid_header');
      }
    }
  });

  it('treats prototype-key card names as ordinary own deck entries', () => {
    const deck = parseSimCsv(
      'QTY,Name,Type,URL\n1,__proto__,Pokémon,https://example.com/a.png'
    );
    expect(Object.keys(deck)).toEqual(['__proto__']);
    expect(deck.__proto__?.totalCount).toBe(1);
    expect(Object.getPrototypeOf(deck)).toBe(Object.prototype);
  });
});
