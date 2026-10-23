import { describe, expect, it } from 'vitest';

import {
  MAX_DECK_CARD_QUANTITY,
  MAX_DECK_IMAGE_URL_CODE_UNITS,
  cardCategoryOf,
  formatSimCsv,
  parseSimCsvResult,
} from './csv-adapter.js';
import { deckListOf, type DeckCard } from './deck-list.js';
import { formatDecklistText } from './decklist-text.js';

const card = (
  overrides: Partial<DeckCard> & Pick<DeckCard, 'name'>
): DeckCard => ({
  id: `custom:${overrides.name}`,
  category: 'Pokémon',
  image: `https://example.com/${overrides.name}.png`,
  ...overrides,
});

describe('simulator CSV files', () => {
  it('writes the v1 header and a row per card', () => {
    const csv = formatSimCsv(
      deckListOf([
        { card: card({ name: 'Pikachu' }), count: 2 },
        { card: card({ name: 'Switch', category: 'Trainer' }), count: 4 },
      ])
    );
    expect(csv).toBe(
      'QTY,Name,Type,URL\n2,Pikachu,Pokémon,https://example.com/Pikachu.png\n4,Switch,Trainer,https://example.com/Switch.png'
    );
  });

  it('reads rows into deck cards, merging repeats of one card', () => {
    const result = parseSimCsvResult(
      'QTY,Name,Type,URL\n2,Pikachu,Pokemon,https://x/p.png\n3,Pikachu,Pokémon,https://x/p.png\n1,Switch,Trainer,https://x/s.png'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      count: 5,
      card: { name: 'Pikachu', category: 'Pokémon', image: 'https://x/p.png' },
    });
    expect(result.cards[0]!.card.id).toMatch(/^custom:/u);
    expect(result.cards[1]!.card.category).toBe('Trainer');
  });

  it('round trips commas, quotes and newlines', () => {
    const original = deckListOf([
      {
        card: card({
          name: 'Misty, Determined',
          category: 'Trainer',
          image: 'https://example.com/"quoted",image\nline.png',
        }),
        count: 1,
      },
    ]);
    const result = parseSimCsvResult(formatSimCsv(original));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cards[0]!.card).toMatchObject({
        name: 'Misty, Determined',
        image: 'https://example.com/"quoted",image\nline.png',
      });
    }
  });

  it('reads a name a quoted cell breaks over lines as one line, so the text list keeps it', () => {
    const result = parseSimCsvResult(
      'QTY,Name,Type,URL\n2,"two\nlines",Pokémon,url\n'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards[0]!.card.name).toBe('two lines');
    // A name kept from before, line break and all, is still one line.
    const kept = deckListOf([
      { card: card({ id: 'kept', name: 'two\nlines' }), count: 2 },
    ]);
    expect(formatDecklistText(kept)).toContain('2 two lines');
  });

  it('accepts a BOM and CRLF line ends', () => {
    expect(
      parseSimCsvResult('﻿QTY,Name,Type,URL\r\n1,Pikachu,Pokémon,url\r\n').ok
    ).toBe(true);
  });

  it.each([
    [
      'an unterminated quote',
      'QTY,Name,Type,URL\n1,"Pikachu,Pokémon,url',
      'unterminated_quote',
    ],
    ['a wrong header', 'QTY,Name,URL\n1,Pikachu,url', 'invalid_header'],
    [
      'missing columns',
      'QTY,Name,Type,URL\n1,Pikachu,Pokémon',
      'invalid_column_count',
    ],
    [
      'a zero count',
      'QTY,Name,Type,URL\n0,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    [
      'a fractional count',
      'QTY,Name,Type,URL\n1.5,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    [
      'an exponent count',
      'QTY,Name,Type,URL\n1e2,Pikachu,Pokémon,url',
      'invalid_quantity',
    ],
    ['a missing name', 'QTY,Name,Type,URL\n1,,Pokémon,url', 'missing_name'],
    ['a missing type', 'QTY,Name,Type,URL\n1,Pikachu,,url', 'missing_type'],
    [
      'an unknown type',
      'QTY,Name,Type,URL\n1,Pikachu,Item,url',
      'invalid_type',
    ],
    ['a missing URL', 'QTY,Name,Type,URL\n1,Pikachu,Pokémon,', 'missing_url'],
  ])('refuses %s and returns no partial deck', (_name, source, code) => {
    const result = parseSimCsvResult(source);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map((issue) => issue.code)).toContain(code);
  });

  it('bounds counts and image URLs', () => {
    expect(
      parseSimCsvResult(
        `QTY,Name,Type,URL\n${MAX_DECK_CARD_QUANTITY + 1},Pikachu,Pokémon,url`
      ).ok
    ).toBe(false);
    expect(
      parseSimCsvResult(
        `QTY,Name,Type,URL\n1,Pikachu,Pokémon,${'x'.repeat(MAX_DECK_IMAGE_URL_CODE_UNITS + 1)}`
      ).ok
    ).toBe(false);
  });

  it('keeps a card named like an object key an ordinary card', () => {
    const result = parseSimCsvResult(
      'QTY,Name,Type,URL\n1,__proto__,Pokémon,url'
    );
    expect(result.ok && result.cards[0]!.card.name).toBe('__proto__');
  });

  it('round trips custom layouts, keeping two pieces of one artwork apart', () => {
    const left = {
      readingQuarterTurns: 0,
      join: { key: 'art', columns: 2, rows: 1, part: 0 },
    };
    const right = {
      readingQuarterTurns: 0,
      join: { key: 'art', columns: 2, rows: 1, part: 1 },
    };
    const original = deckListOf([
      {
        card: card({ id: 'custom:a', name: 'Composite', presentation: left }),
        count: 1,
      },
      {
        card: card({ id: 'custom:b', name: 'Composite', presentation: right }),
        count: 1,
      },
    ]);
    const csv = formatSimCsv(original);
    expect(csv.split('\n')[0]).toBe('QTY,Name,Type,URL,Presentation');
    const restored = parseSimCsvResult(csv);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.cards.map((entry) => entry.card.presentation)).toEqual([
      left,
      right,
    ]);
    expect(formatSimCsv(restored.cards)).toBe(csv);
  });

  it('reads card types as v1 and decklists spell them', () => {
    expect(cardCategoryOf('Pokemon')).toBe('Pokémon');
    expect(cardCategoryOf(' trainer ')).toBe('Trainer');
    expect(cardCategoryOf('ENERGY')).toBe('Energy');
    expect(cardCategoryOf('Item')).toBeUndefined();
  });
});
