/**
 * Returns nodes from visually topmost to bottommost without mutating scene
 * order. Equal z-index nodes paint in array order, so the later node wins.
 */
export const topmostFirst = <T extends { readonly zIndex: number }>(
  nodes: readonly T[]
): T[] =>
  nodes
    .map((node, paintIndex) => ({ node, paintIndex }))
    .sort(
      (left, right) =>
        right.node.zIndex - left.node.zIndex ||
        right.paintIndex - left.paintIndex
    )
    .map(({ node }) => node);
