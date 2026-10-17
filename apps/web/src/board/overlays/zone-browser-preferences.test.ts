import type { CardSceneNode } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  clampZoneBrowserZoom,
  ZONE_BROWSER_PREFERENCES,
  ZONE_BROWSER_ZOOM_MAX,
  ZONE_BROWSER_ZOOM_MIN,
  zoneBrowserStackKey,
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

  it('stacks piles but not the hand by default, at the fitted size', () => {
    expect(ZONE_BROWSER_PREFERENCES.defaults).toEqual({
      stackPiles: true,
      stackHand: false,
      zoom: 1,
    });
    expect(zoneBrowserStackKey('hand')).toBe('stackHand');
    for (const kind of ['deck', 'discard', 'lostZone', 'prizes', 'board'])
      expect(zoneBrowserStackKey(kind)).toBe('stackPiles');
  });

  it('remembers each choice and reads anything else as the default', () => {
    expect(
      ZONE_BROWSER_PREFERENCES.parse({
        stackPiles: false,
        stackHand: true,
        zoom: 1.5,
      })
    ).toEqual({ stackPiles: false, stackHand: true, zoom: 1.5 });
    for (const stored of [
      null,
      'yes',
      [],
      { stackPiles: 'false', stackHand: 1, zoom: 'big' },
    ])
      expect(ZONE_BROWSER_PREFERENCES.parse(stored)).toEqual(
        ZONE_BROWSER_PREFERENCES.defaults
      );
  });

  it('keeps a stored "stack copies" from the one-switch days as stacking everywhere', () => {
    expect(ZONE_BROWSER_PREFERENCES.parse({ stackCopies: true })).toEqual({
      stackPiles: true,
      stackHand: true,
      zoom: 1,
    });
    // It was off by default, so a stored "off" was never a choice.
    expect(ZONE_BROWSER_PREFERENCES.parse({ stackCopies: false })).toEqual(
      ZONE_BROWSER_PREFERENCES.defaults
    );
  });

  it('keeps zoom on its steps and inside its range', () => {
    expect(clampZoneBrowserZoom(1.04)).toBe(1);
    expect(clampZoneBrowserZoom(1.26)).toBe(1.3);
    expect(clampZoneBrowserZoom(9)).toBe(ZONE_BROWSER_ZOOM_MAX);
    expect(clampZoneBrowserZoom(0)).toBe(ZONE_BROWSER_ZOOM_MIN);
    expect(clampZoneBrowserZoom(Number.NaN)).toBe(1);
    expect(ZONE_BROWSER_PREFERENCES.parse({ zoom: 7 }).zoom).toBe(
      ZONE_BROWSER_ZOOM_MAX
    );
  });
});
