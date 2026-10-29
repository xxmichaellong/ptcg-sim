import type { CardSceneNode, Rect } from '@ptcgsim/renderer-contract';

/** The least room a raised hand card keeps from the surface's sides. */
const PEEK_EDGE_PX = 4;

/**
 * How far a raised hand card moves sideways to stay whole on the surface,
 * which clips it: drawn `scale` times larger about its middle, a card at
 * the hand's end would reach past the screen's edge. In the card's own
 * pixels (`painted` is where the table draws it, the card's own box drawn
 * larger on the tilted table), turned with a card turned half round.
 */
export const peekShift = (
  card: Pick<CardSceneNode, 'bounds' | 'rotationQuarterTurns'>,
  painted: Rect,
  scale: number,
  surfaceWidth: number
): number => {
  if (painted.width <= 0) return 0;
  const middle = painted.x + painted.width / 2;
  const half = (painted.width * scale) / 2;
  const shift =
    2 * half > surfaceWidth - 2 * PEEK_EDGE_PX
      ? surfaceWidth / 2 - middle
      : middle - half < PEEK_EDGE_PX
        ? PEEK_EDGE_PX - (middle - half)
        : middle + half > surfaceWidth - PEEK_EDGE_PX
          ? surfaceWidth - PEEK_EDGE_PX - (middle + half)
          : 0;
  const own = (shift * card.bounds.width) / painted.width;
  return card.rotationQuarterTurns === 2 ? -own : own;
};
