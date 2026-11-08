import { paintedCardBounds } from './card-composition.js';
import type { CardSceneNode, Rect } from './model.js';

/** A per-card badge stays inside the visible face, compact or expanded. */
export const cardAbilityMarkerBounds = (
  card: Pick<CardSceneNode, 'bounds' | 'rotationQuarterTurns'>,
  turnedToViewer = false
): Rect => {
  const face = paintedCardBounds(card.bounds, card.rotationQuarterTurns);
  const edge = Math.min(face.width, face.height);
  const size = Math.min(edge, Math.max(14, edge * 0.22));
  return {
    x: turnedToViewer ? face.x : face.x + face.width - size,
    y: turnedToViewer ? face.y + face.height - size : face.y,
    width: size,
    height: size,
  };
};
