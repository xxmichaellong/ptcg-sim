import type { CardSceneNode } from '@ptcgsim/renderer-contract';

import { definePreference } from '../../preferences/preference-store.js';

/** How the player likes a pile's viewer laid out, kept between visits. */
export interface ZoneBrowserPreferences {
  /**
   * Copies of one card share a single stacked tile with their count, rather
   * than one tile each.
   */
  readonly stackCopies: boolean;
}

export const ZONE_BROWSER_PREFERENCES =
  definePreference<ZoneBrowserPreferences>({
    key: 'ptcgsim.zone-browser.v1',
    defaults: Object.freeze({ stackCopies: false }),
    parse: (value) => ({
      stackCopies:
        typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, 'stackCopies') === true,
    }),
  });

/** One tile in a pile's viewer: a card, and the copies stacked under it. */
export interface ZoneBrowserTile {
  readonly card: CardSceneNode;
  /** How many copies the tile stands for (1 when copies are not stacked). */
  readonly count: number;
}

/**
 * A pile's cards as the viewer's tiles. Stacked, the copies of a card --
 * cards the viewer can read, alike in name and face, as the copy badges
 * count them -- share the tile of the first one in the shown order, which is
 * the one picked up or read from it; concealed cards always stand alone, so
 * a stack discloses nothing their faces do not.
 */
export const zoneBrowserTiles = (
  cards: readonly CardSceneNode[],
  stackCopies: boolean
): readonly ZoneBrowserTile[] => {
  if (!stackCopies) return cards.map((card) => ({ card, count: 1 }));
  const tiles: { card: CardSceneNode; count: number }[] = [];
  const byFace = new Map<string, { card: CardSceneNode; count: number }>();
  for (const card of cards) {
    if (card.concealed) {
      tiles.push({ card, count: 1 });
      continue;
    }
    const key = `${card.label}\u0000${card.imageUrl}`;
    const tile = byFace.get(key);
    if (tile) {
      tile.count += 1;
      continue;
    }
    const created = { card, count: 1 };
    byFace.set(key, created);
    tiles.push(created);
  }
  return tiles;
};
