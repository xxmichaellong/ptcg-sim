import {
  countBadgeAnchorWithin,
  type BoardDepthProjection,
  type BoardSceneLayout,
  type ZoneCountSceneNode,
} from '@ptcgsim/renderer-contract';

/**
 * A count as the table draws it: tilted, where the projection puts its
 * anchor (the hand's flat at the screen's edge); a pile's badge, kept on
 * the table, as a pile at the screen's edge would have it stand out past
 * its corner and off the screen.
 */
export const tableCountNode = (
  node: ZoneCountSceneNode,
  depth: BoardDepthProjection | undefined,
  table: boolean,
  layout: BoardSceneLayout
): ZoneCountSceneNode => {
  const projected = depth
    ? { ...node, anchor: depth.point(node.anchor, 0, node.kind === 'hand') }
    : node;
  if (!table || node.kind === 'hand') return projected;
  const anchor = countBadgeAnchorWithin(projected, layout.playAreaBounds);
  return anchor.x === projected.anchor.x && anchor.y === projected.anchor.y
    ? projected
    : { ...projected, anchor };
};
