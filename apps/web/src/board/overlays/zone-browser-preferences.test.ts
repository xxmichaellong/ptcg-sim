import type { CardSceneNode } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  ZONE_BROWSER_PREFERENCES,
  zoneBrowserTiles,
} from './zone-browser-preferences.js';

const card = (id: string, label: string, concealed = false): CardSceneNode =>
  ({
    id,
    label,
    imageUrl: `https://cards.example/${label}.png`,
    concealed,
  }) as unknown as CardSceneNode;

describe('zone browser tiles', () => {
  const cards = [
    card('a', 'Energy'),
    card('b', 'Switch'),
    card('c', 'Energy'),
    card('d', 'Back', true),
    card('e', 'Back', true),
    card('f', 'Energy'),
  ];

  it('shows every copy on its own unless copies are stacked', () => {
    expect(zoneBrowserTiles(cards, false)).toEqual(
      cards.map((entry) => ({ card: entry, count: 1 }))
    );
  });

  it('stacks copies on the first one shown, and never stacks hidden cards', () => {
    expect(
      zoneBrowserTiles(cards, true).map((tile) => [tile.card.id, tile.count])
    ).toEqual([
      ['a', 3],
      ['b', 1],
      ['d', 1],
      ['e', 1],
    ]);
  });

  it('remembers the choice and reads anything else as off', () => {
    expect(ZONE_BROWSER_PREFERENCES.defaults).toEqual({ stackCopies: false });
    expect(ZONE_BROWSER_PREFERENCES.parse({ stackCopies: true })).toEqual({
      stackCopies: true,
    });
    for (const stored of [null, 'yes', { stackCopies: 'true' }, []])
      expect(ZONE_BROWSER_PREFERENCES.parse(stored)).toEqual({
        stackCopies: false,
      });
  });
});
