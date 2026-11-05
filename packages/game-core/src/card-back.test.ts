import { describe, expect, it } from 'vitest';

import {
  CARD_BACK_REFERENCE_MAX,
  CARD_BACK_VALUE_MAX,
  canonicalCardBackEmblem,
  cardBackReference,
  isCardBackEmblem,
  isCardBackValue,
  isStandardCardBack,
  LEGACY_DEFAULT_CARD_BACK_URL,
  parseCardBack,
  STANDARD_CARD_BACK,
} from './card-back.js';
import { MAX_IMAGE_URL_CODE_UNITS } from './model.js';

const sha = 'a'.repeat(64);

describe('card-back references', () => {
  it('reads each kind of reference and writes it back the same', () => {
    for (const [value, back] of [
      ['preset:standard', { kind: 'preset', id: 'standard' }],
      ['preset:crimson-2', { kind: 'preset', id: 'crimson-2' }],
      [
        'design:1.navy.stripes.gold.ball',
        {
          kind: 'design',
          design: {
            base: 'navy',
            pattern: 'stripes',
            accent: 'gold',
            emblem: 'ball',
          },
        },
      ],
      [`img:${sha}`, { kind: 'image', sha256: sha }],
      [
        'url:https://example.test/back.png',
        { kind: 'url', url: 'https://example.test/back.png' },
      ],
    ] as const) {
      expect(parseCardBack(value), value).toEqual(back);
      expect(cardBackReference(back), value).toBe(value);
      expect(isCardBackValue(value), value).toBe(true);
    }
  });

  it('reads a value from before references as a legacy URL, and the shipped path as the standard back', () => {
    expect(parseCardBack('https://player.example/back.png?x=1#y')).toEqual({
      kind: 'url',
      url: 'https://player.example/back.png?x=1#y',
    });
    expect(parseCardBack('/red.png')).toEqual({ kind: 'url', url: '/red.png' });
    expect(parseCardBack(LEGACY_DEFAULT_CARD_BACK_URL)).toEqual({
      kind: 'preset',
      id: 'standard',
    });
    expect(isStandardCardBack(LEGACY_DEFAULT_CARD_BACK_URL)).toBe(true);
    expect(isStandardCardBack(STANDARD_CARD_BACK)).toBe(true);
    expect(isStandardCardBack(undefined)).toBe(true);
    expect(isStandardCardBack('preset:crimson')).toBe(false);
    // A legacy value keeps ADR-013's bound.
    expect(isCardBackValue('x'.repeat(MAX_IMAGE_URL_CODE_UNITS))).toBe(true);
    expect(isCardBackValue('x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1))).toBe(
      false
    );
  });

  it('refuses a malformed reference of any kind', () => {
    for (const value of [
      '',
      'preset:',
      'preset:Crimson',
      'preset:has space',
      `preset:${'a'.repeat(33)}`,
      'design:1.navy.stripes.gold',
      'design:2.navy.stripes.gold.ball',
      'design:1.navy.stripes.gold.ball.extra',
      'design:1.neon.stripes.gold.ball',
      'design:1.navy.tartan.gold.ball',
      'design:1.navy.stripes.gold.skull',
      'img:',
      `img:${'A'.repeat(64)}`,
      `img:${'a'.repeat(63)}`,
      'url:http://example.test/back.png',
      'url:javascript:alert(1)',
      'url:',
      `url:https://example.test/${'x'.repeat(MAX_IMAGE_URL_CODE_UNITS)}`,
    ]) {
      expect(parseCardBack(value), value).toBeNull();
      expect(isCardBackValue(value), value).toBe(false);
    }
    expect(isCardBackValue(42)).toBe(false);
    expect(isCardBackValue(undefined)).toBe(false);
  });

  it('bounds a value as the image URL bound does', () => {
    expect(CARD_BACK_VALUE_MAX).toBe(MAX_IMAGE_URL_CODE_UNITS);
  });

  it("takes a real Pokémon, Poké Ball or Energy as a design's emblem, and the first designer's emblems as the real ones they meant", () => {
    for (const emblem of [
      'none',
      'pokemon-1',
      'pokemon-25',
      'pokemon-1025',
      'ball-poke',
      'ball-master',
      'energy-fire',
      'energy-colorless',
      'ball',
      'moon',
    ]) {
      expect(isCardBackEmblem(emblem), emblem).toBe(true);
      expect(
        parseCardBack(`design:1.navy.swirl.cream.${emblem}`),
        emblem
      ).toMatchObject({ kind: 'design', design: { emblem } });
    }
    for (const emblem of [
      'pokemon-0',
      'pokemon-025',
      'pokemon-1026',
      'pokemon-',
      'pokemon-1e3',
      'ball-',
      'ball-poké',
      'ball-cherish',
      'energy-rainbow',
      'skull',
      'Pokemon-25',
    ]) {
      expect(isCardBackEmblem(emblem), emblem).toBe(false);
      expect(
        parseCardBack(`design:1.navy.plain.cream.${emblem}`),
        emblem
      ).toBeNull();
    }
    expect(canonicalCardBackEmblem('ball')).toBe('ball-poke');
    expect(canonicalCardBackEmblem('star')).toBe('energy-colorless');
    expect(canonicalCardBackEmblem('moon')).toBe('energy-darkness');
    expect(canonicalCardBackEmblem('pokemon-25')).toBe('pokemon-25');
    // A design is written back as it was read.
    expect(
      cardBackReference(parseCardBack('design:1.wine.plaid.sand.pokemon-150')!)
    ).toBe('design:1.wine.plaid.sand.pokemon-150');
  });

  it('keeps every reference but a legacy URL short', () => {
    const longest = 'design:1.lavender.crosshatch.lavender.pokemon-1025';
    expect(longest.length).toBeLessThanOrEqual(CARD_BACK_REFERENCE_MAX);
    expect(`img:${sha}`.length).toBeLessThanOrEqual(CARD_BACK_REFERENCE_MAX);
    expect(`preset:${'a'.repeat(32)}`.length).toBeLessThanOrEqual(
      CARD_BACK_REFERENCE_MAX
    );
  });
});
