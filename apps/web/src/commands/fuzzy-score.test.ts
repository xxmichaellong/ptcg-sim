import { describe, expect, it } from 'vitest';

import { createFuzzyScorer, EMPTY_QUERY_SCORE } from './fuzzy-score.js';

describe('createFuzzyScorer', () => {
  it('orders exact, prefix, word-start and scattered matches', () => {
    const score = createFuzzyScorer('draw');
    const exact = score('Draw');
    const prefix = score('Draw cards');
    const wordStart = score('Discard your hand and draw');
    const scattered = score('Do raise a wall');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
    expect(score('Shuffle deck')).toBe(0);
  });

  it('reads initials and runs as word starts', () => {
    const score = createFuzzyScorer('sd');
    expect(score('Shuffle deck')).toBeGreaterThan(score('sad'));
  });

  it("doesn't need accents or case typed", () => {
    expect(createFuzzyScorer('pokemon')('Pokémon')).toBeGreaterThan(0);
    expect(createFuzzyScorer('ÉNERGIE')('énergie')).toBeGreaterThan(0);
  });

  it('matches everything with one score for an empty query', () => {
    expect(createFuzzyScorer('')('anything')).toBe(EMPTY_QUERY_SCORE);
  });

  it('leaves the prefix and exact bonuses out without tiers', () => {
    const tiered = createFuzzyScorer('draw');
    const loose = createFuzzyScorer('draw', false);
    // A keyword "draw" never beats a title starting with "draw".
    expect(loose('draw')).toBeLessThan(tiered('Draw cards'));
    expect(loose('draw')).toBeGreaterThan(0);
  });
});
