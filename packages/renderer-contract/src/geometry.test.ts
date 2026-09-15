import { describe, expect, it } from 'vitest';

import { containsPoint, containsPointInRotatedRect } from './geometry.js';

const portrait = { x: 100, y: 200, width: 60, height: 100 };

describe('renderer geometry containment', () => {
  it('keeps inclusive axis-aligned rectangle edges', () => {
    expect(containsPoint(portrait, 100, 200)).toBe(true);
    expect(containsPoint(portrait, 160, 300)).toBe(true);
    expect(containsPoint(portrait, 99.999, 250)).toBe(false);
    expect(containsPoint(portrait, 130, 300.001)).toBe(false);
  });

  it('matches the layout box at zero and two quarter turns', () => {
    for (const rotationQuarterTurns of [0, 2] as const) {
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 101, 201)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 90, 250)
      ).toBe(false);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 170, 250)
      ).toBe(false);
    }
  });

  it('swaps the center-origin footprint at one and three quarter turns', () => {
    for (const rotationQuarterTurns of [1, 3] as const) {
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 81, 250)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 179, 250)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 130, 219)
      ).toBe(false);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 130, 281)
      ).toBe(false);
    }
  });

  it('retains the shared center and transformed inclusive edges', () => {
    for (const rotationQuarterTurns of [0, 1, 2, 3] as const) {
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 130, 250)
      ).toBe(true);
    }
    for (const rotationQuarterTurns of [1, 3] as const) {
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 80, 250)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 180, 250)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 130, 220)
      ).toBe(true);
      expect(
        containsPointInRotatedRect(portrait, rotationQuarterTurns, 130, 280)
      ).toBe(true);
    }
  });

  it('rejects non-finite points for every quarter turn', () => {
    for (const rotationQuarterTurns of [0, 1, 2, 3] as const) {
      expect(
        containsPointInRotatedRect(
          portrait,
          rotationQuarterTurns,
          Number.NaN,
          250
        )
      ).toBe(false);
      expect(
        containsPointInRotatedRect(
          portrait,
          rotationQuarterTurns,
          130,
          Number.POSITIVE_INFINITY
        )
      ).toBe(false);
    }
  });

  it('fails closed for a forged runtime rotation', () => {
    expect(
      containsPointInRotatedRect(
        portrait,
        4 as Parameters<typeof containsPointInRotatedRect>[1],
        130,
        250
      )
    ).toBe(false);
  });
});
