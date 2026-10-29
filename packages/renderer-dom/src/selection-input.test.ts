import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import type { BoardScene, CardSceneNode } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { addsToSelection, sweepRect, sweptItems } from './selection-input.js';

const playerId = asPlayerId('p1');
const card = (id: string, x: number, y: number): CardSceneNode => ({
  id: asViewCardId(id),
  ownerId: playerId,
  parentId: 'zone:p1:board',
  side: 'local',
  role: 'zone',
  bounds: { x, y, width: 60, height: 84 },
  zIndex: 100,
  rotationQuarterTurns: 0,
  imageUrl: `/${id}.png`,
  concealed: false,
  label: id,
  interactive: true,
  renderKey: `card:${id}`,
});

describe('picking several cards', () => {
  it('adds with Shift anywhere, ⌘ on Apple platforms and Ctrl elsewhere', () => {
    const keys = (shiftKey: boolean, metaKey: boolean, ctrlKey: boolean) => ({
      shiftKey,
      metaKey,
      ctrlKey,
    });
    expect(addsToSelection(keys(true, false, false), true)).toBe(true);
    expect(addsToSelection(keys(true, false, false), false)).toBe(true);
    expect(addsToSelection(keys(false, true, false), true)).toBe(true);
    expect(addsToSelection(keys(false, false, true), true)).toBe(false);
    expect(addsToSelection(keys(false, false, true), false)).toBe(true);
    expect(addsToSelection(keys(false, true, false), false)).toBe(false);
  });

  it('reads a rectangle row by row, a card a little lower still in its row', () => {
    // Two rows: the second card of the first sits a little lower, as cards
    // put down by hand do; the second row starts left of the first.
    const cards = [
      card('right-low', 200, 112),
      card('below', 10, 300),
      card('left', 100, 100),
    ];
    const scene = { cards } as unknown as BoardScene;
    const candidates = cards.map((item) => ({ card: item, box: item.bounds }));
    const swept = sweptItems(scene, candidates, {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    expect(swept.items).toEqual(['left', 'right-low', 'below']);
    // Only what it touches.
    expect(
      sweptItems(scene, candidates, { x: 170, y: 0, width: 200, height: 200 })
        .items
    ).toEqual(['right-low']);
  });

  it('keeps a rectangle to its half', () => {
    expect(
      sweepRect({ x: 50, y: 500 }, { x: 10, y: 100 }, { top: 388, bottom: 844 })
    ).toEqual({ x: 10, y: 388, width: 40, height: 112 });
  });
});
