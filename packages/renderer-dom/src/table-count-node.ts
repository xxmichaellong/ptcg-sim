import {
  countBadgeAnchorWithin,
  type BoardDepthProjection,
  type BoardSceneLayout,
  type CardSceneNode,
  type ZoneCountSceneNode,
} from '@ptcgsim/renderer-contract';

/**
 * A count as the table draws it: tilted, where the projection puts its
 * anchor (the hand's flat at the screen's edge). A pile's badge sits on
 * the corner of its top card (`top`), as high as the pile stands, so a
 * full deck wears it on its top and not at its foot; an empty pile's on
 * the corner of its place. Kept on the table, as a pile at the screen's
 * edge would have it stand out past its corner and off the screen.
 */
export const tableCountNode = (
  node: ZoneCountSceneNode,
  depth: BoardDepthProjection | undefined,
  table: boolean,
  layout: BoardSceneLayout,
  top?: CardSceneNode
): ZoneCountSceneNode => {
  const pile = table && node.kind !== 'hand' ? top : undefined;
  const pose = pile && depth ? depth.pose(pile) : undefined;
  const face = pose?.bounds ?? pile?.bounds;
  const corner = face
    ? {
        x: node.horizontalAlign === 'right' ? face.x + face.width : face.x,
        y: node.verticalAlign === 'bottom' ? face.y + face.height : face.y,
      }
    : node.anchor;
  const at = depth
    ? depth.point(corner, pose?.elevation ?? 0, node.kind === 'hand')
    : corner;
  const projected =
    at.x === node.anchor.x && at.y === node.anchor.y
      ? node
      : { ...node, anchor: at };
  if (!table || node.kind === 'hand') return projected;
  const anchor = countBadgeAnchorWithin(projected, layout.playAreaBounds);
  return anchor.x === projected.anchor.x && anchor.y === projected.anchor.y
    ? projected
    : { ...projected, anchor };
};
