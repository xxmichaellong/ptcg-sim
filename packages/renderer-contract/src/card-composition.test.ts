import { describe, expect, it } from 'vitest';
import {
  composeCardArtwork,
  fitCardComposition,
  paintedCardBounds,
  turnCardComposition,
} from './card-composition.js';
import type { CardPresentation, QuarterTurns } from '@ptcgsim/game-core';

const union = [0, 1, 2, 3].map((part) => ({
  id: `piece-${part}`,
  presentation: {
    readingQuarterTurns: 0,
    join: { key: 'mewtwo-print', columns: 2, rows: 2, part },
  } as CardPresentation,
}));
describe('physical card composition', () => {
  it('joins V-UNION pieces by position even when played out of order', () => {
    const result = composeCardArtwork([
      union[3]!,
      union[0]!,
      union[2]!,
      union[1]!,
    ])!;
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 126, height: 176 });
    expect(result.cards.find((card) => card.id === 'piece-1')!.bounds).toEqual({
      x: 63,
      y: 0,
      width: 63,
      height: 88,
    });
    for (const turn of [0, 1, 2, 3] as const) {
      const turned = fitCardComposition(turnCardComposition(result, turn), {
        x: 10,
        y: 20,
        width: 240,
        height: 180,
      });
      for (const card of turned.cards) {
        const bounds = paintedCardBounds(
          card.bounds,
          card.rotationQuarterTurns
        );
        expect(bounds.x).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(bounds.y).toBeGreaterThanOrEqual(20 - 1e-6);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(250 + 1e-6);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(200 + 1e-6);
      }
    }
  });
  it('keeps missing positions and refuses duplicate, hidden, or mixed artwork', () => {
    expect(composeCardArtwork([union[3]!])!.cards[0]!.bounds).toMatchObject({
      x: 63,
      y: 88,
    });
    expect(composeCardArtwork([union[0]!, union[0]!])).toBeNull();
    expect(composeCardArtwork([{ id: 'concealed' }, union[0]!])).toBeNull();
    expect(
      composeCardArtwork([
        {
          ...union[0]!,
          presentation: {
            ...union[0]!.presentation,
            join: { ...union[0]!.presentation.join!, key: 'other-print' },
          },
        },
        union[1]!,
      ])
    ).toBeNull();
  });
  it.each([
    [1, 2, 1, 88, 126],
    [2, 1, 0, 126, 88],
    [3, 1, 0, 189, 88],
  ] as const)(
    'supports a %sx%s grid of quarter-turn %s scans',
    (columns, rows, rotation, width, height) => {
      const cards = Array.from({ length: columns * rows }, (_, part) => ({
        id: String(part),
        presentation: {
          readingQuarterTurns: rotation as QuarterTurns,
          join: { key: 'artwork', columns, rows, part },
        } as CardPresentation,
      }));
      expect(composeCardArtwork(cards)?.bounds).toEqual({
        x: 0,
        y: 0,
        width,
        height,
      });
    }
  );
  it('places BREAK above the previous text box without stretching either scan', () => {
    const result = composeCardArtwork([
      { id: 'greninja' },
      {
        id: 'break',
        presentation: { readingQuarterTurns: 1, overlay: 'upper-half' },
      },
    ])!;
    const overlay = paintedCardBounds(result.cards[1]!.bounds, 1);
    expect(overlay.width / overlay.height).toBeCloseTo(88 / 63);
    expect(overlay.y + overlay.height).toBe(44);
    expect(result.cards[0]!.bounds.height).toBe(88);
  });
});
