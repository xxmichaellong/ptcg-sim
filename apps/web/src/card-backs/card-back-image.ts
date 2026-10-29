import { parseCardBack, type PlayerId } from '@ptcgsim/game-core';
import type { BoardScene } from '@ptcgsim/renderer-contract';

import { cardBackDesignImage } from './card-back-design.js';
import {
  presetCardBackImage,
  STANDARD_CARD_BACK_IMAGE,
} from './card-back-presets.js';

/** Who is looking at a back, and what they allow of other players'. */
export interface CardBackViewer {
  /** The back is the viewer's own (both seats at a Solo table). */
  readonly own: boolean;
  /** Opponents' uploaded and designed backs show (Settings). */
  readonly opponentCustomBacks: boolean;
  /**
   * The owner's own deck screen, the one place a legacy URL back is shown
   * as it is (and imported from).
   */
  readonly ownDeckScreen?: boolean;
}

/**
 * The picture a card back draws as for this viewer (ADR-041). Nothing here
 * leaves the app's own origin but a legacy URL on its owner's deck screen;
 * anything unreadable draws as the standard back.
 */
export const cardBackImage = (
  value: string | undefined,
  viewer: CardBackViewer
): string => {
  const back = value === undefined ? null : parseCardBack(value);
  if (!back) return STANDARD_CARD_BACK_IMAGE;
  const custom = viewer.own || viewer.opponentCustomBacks;
  switch (back.kind) {
    case 'preset':
      return presetCardBackImage(back.id);
    case 'design':
      return custom
        ? cardBackDesignImage(back.design)
        : STANDARD_CARD_BACK_IMAGE;
    case 'image':
      return custom ? `/v2/images/${back.sha256}` : STANDARD_CARD_BACK_IMAGE;
    case 'url':
      return viewer.own && viewer.ownDeckScreen
        ? back.url
        : STANDARD_CARD_BACK_IMAGE;
  }
};

/**
 * The table's card backs drawn for this viewer: each back's reference in
 * the scene becomes its picture, which falls back to the standard back if
 * it fails to load. Faces are left alone.
 */
export const resolveSceneCardBacks = (
  scene: BoardScene,
  viewer: {
    readonly ownPlayerIds: ReadonlySet<PlayerId>;
    readonly opponentCustomBacks: boolean;
  }
): BoardScene => {
  let changed = false;
  const cards = scene.cards.map((card) => {
    if (!card.concealed && card.tableImageUrl === undefined) return card;
    const who: CardBackViewer = {
      own: viewer.ownPlayerIds.has(card.ownerId),
      opponentCustomBacks: viewer.opponentCustomBacks,
    };
    changed = true;
    return {
      ...card,
      ...(card.concealed
        ? { imageUrl: cardBackImage(card.imageUrl, who) }
        : {}),
      ...(card.tableImageUrl === undefined
        ? {}
        : { tableImageUrl: cardBackImage(card.tableImageUrl, who) }),
      backFallbackUrl: STANDARD_CARD_BACK_IMAGE,
    };
  });
  return changed ? { ...scene, cards } : scene;
};
