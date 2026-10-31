import { describe, expect, it } from 'vitest';
import { peekShift } from './hand-peek.js';

describe('peekShift', () => {
  const card = (width: number, turns: 0 | 2 = 0) => ({
    bounds: { x: 0, y: 0, width, height: width * 1.4 },
    rotationQuarterTurns: turns,
  });

  it("steps a raised card in from either edge of the screen, and leaves one in the hand's middle", () => {
    // 60px drawn 1.6 times larger about its middle (38px): -10px to 86px.
    expect(
      peekShift(card(60), { x: 8, y: 0, width: 60, height: 84 }, 1.6, 390)
    ).toBe(14);
    expect(
      peekShift(card(60), { x: 322, y: 0, width: 60, height: 84 }, 1.6, 390)
    ).toBe(-14);
    expect(
      peekShift(card(60), { x: 160, y: 0, width: 60, height: 84 }, 1.6, 390)
    ).toBe(0);
  });

  it('moves a card turned half round its own way, and a card drawn larger by its own measure', () => {
    expect(
      peekShift(card(60, 2), { x: 8, y: 0, width: 60, height: 84 }, 1.6, 390)
    ).toBe(-14);
    // The tilted table draws the 60px card 90px wide: 31px on screen is
    // 31 * 60 / 90 of its own.
    expect(
      peekShift(card(60), { x: 0, y: 0, width: 90, height: 126 }, 1.6, 390)
    ).toBeCloseTo((31 * 60) / 90);
  });

  it('centres a card drawn wider than the screen', () => {
    expect(
      peekShift(card(300), { x: 20, y: 0, width: 300, height: 420 }, 1.6, 390)
    ).toBe(25);
  });
});
