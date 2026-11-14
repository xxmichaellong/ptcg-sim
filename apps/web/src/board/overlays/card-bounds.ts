import type {
  BoardDepthProjection,
  CardSceneNode,
} from '@ptcgsim/renderer-contract';

/**
 * Where a card is painted, in table terms: projected on the tilted table,
 * and turned with it on the flat one (a sideways card's box is its upright
 * rectangle turned about its centre).
 */
export const visualCardBounds = (
  card: CardSceneNode,
  depth?: BoardDepthProjection
) => {
  if (depth) return depth.bounds(card);
  if (card.rotationQuarterTurns % 2 === 0) return card.bounds;
  const centerX = card.bounds.x + card.bounds.width / 2;
  const centerY = card.bounds.y + card.bounds.height / 2;
  return {
    x: centerX - card.bounds.height / 2,
    y: centerY - card.bounds.width / 2,
    width: card.bounds.height,
    height: card.bounds.width,
  };
};
