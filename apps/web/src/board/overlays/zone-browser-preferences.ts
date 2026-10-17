import type { CardSceneNode } from '@ptcgsim/renderer-contract';

import { definePreference } from '../../preferences/preference-store.js';

/** How the player likes a pile's viewer laid out, kept between visits. */
export interface ZoneBrowserPreferences {
  /**
   * Piles -- the deck, discard, Lost Zone, prizes, the Board -- show copies
   * of one card as a single stacked tile with their count.
   */
  readonly stackPiles: boolean;
  /** The hand does the same; off by default, a hand is read card by card. */
  readonly stackHand: boolean;
  /**
   * How large the viewer draws its cards, as a multiple of the size it would
   * fit them at on its own. 1 is that size; the scale is linear.
   */
  readonly zoom: number;
}

export const ZONE_BROWSER_ZOOM_MIN = 0.5;
export const ZONE_BROWSER_ZOOM_MAX = 2;
export const ZONE_BROWSER_ZOOM_STEP = 0.1;

const STEPS_PER_UNIT = Math.round(1 / ZONE_BROWSER_ZOOM_STEP);

/** A zoom kept on the scale's steps and inside its range. */
export const clampZoneBrowserZoom = (zoom: number): number =>
  Number.isFinite(zoom)
    ? Math.min(
        ZONE_BROWSER_ZOOM_MAX,
        Math.max(
          ZONE_BROWSER_ZOOM_MIN,
          Math.round(zoom / ZONE_BROWSER_ZOOM_STEP) / STEPS_PER_UNIT
        )
      )
    : 1;

const ZONE_BROWSER_DEFAULTS: ZoneBrowserPreferences = Object.freeze({
  stackPiles: true,
  stackHand: false,
  zoom: 1,
});

export const ZONE_BROWSER_PREFERENCES =
  definePreference<ZoneBrowserPreferences>({
    key: 'ptcgsim.zone-browser.v1',
    defaults: ZONE_BROWSER_DEFAULTS,
    parse: (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return ZONE_BROWSER_DEFAULTS;
      const flag = (key: string, fallback: boolean): boolean => {
        const stored = Reflect.get(value, key);
        return typeof stored === 'boolean' ? stored : fallback;
      };
      // Before 2026-10-16 one switch stacked every viewer and was off by
      // default, so only a stored `true` was a choice: stacking everywhere.
      const legacy = Reflect.get(value, 'stackCopies') === true;
      const zoom = Reflect.get(value, 'zoom');
      return {
        stackPiles: flag('stackPiles', ZONE_BROWSER_DEFAULTS.stackPiles),
        stackHand: flag('stackHand', legacy),
        zoom: typeof zoom === 'number' ? clampZoneBrowserZoom(zoom) : 1,
      };
    },
  });

/** Which of the two stacking choices a zone's viewer follows. */
export const zoneBrowserStackKey = (
  zoneKind: string
): 'stackHand' | 'stackPiles' =>
  zoneKind === 'hand' ? 'stackHand' : 'stackPiles';

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
