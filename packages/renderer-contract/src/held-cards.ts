import { arrangementIndexAt } from './arrangement.js';
import type { BoardDepthProjection } from './board-depth.js';
import type { BoardPointerInput } from './drag.js';
import type { BoardPresentation, BoardScene, CardSceneNode } from './model.js';

/** The deck's cover, left on the pile while its top card is in the hand. */
const COVER_STAND_IN = '\u0000pile';

/**
 * Whether a card is the stand-in a pile's cover is painted as while its top
 * card is held: no card of the match, only the pile keeping its height.
 */
export const isPileStandIn = (card: Pick<CardSceneNode, 'id'>): boolean =>
  String(card.id).endsWith(COVER_STAND_IN);

/**
 * The card itself, painted face up as it will be once it lands; settling,
 * it lies where it was dropped, so whatever the next scene makes of it --
 * the same card, or the card under a new alias once it has crossed into a
 * hand -- flies on from there (motion-plan.ts pairs it from these bounds).
 */
const asHeldCard = (
  card: CardSceneNode,
  droppedAt: { readonly x: number; readonly y: number } | undefined
): CardSceneNode => {
  const {
    tableImageUrl: _cover,
    primaryAction: _openPile,
    clipBounds: _clip,
    ...rest
  } = card;
  return {
    ...rest,
    renderKey: `card:${String(card.id)}`,
    interactive: true,
    ...(droppedAt
      ? {
          bounds: {
            ...card.bounds,
            x: droppedAt.x - card.bounds.width / 2,
            y: droppedAt.y - card.bounds.height / 2,
          },
        }
      : {}),
  };
};

/**
 * The scene the table paints while cards are in the hand. A card held or
 * settling that the table does not otherwise draw -- one picked out of a
 * pile's viewer, buried in the pile, or the top card under the cover of a
 * pile open in its viewer -- is painted as the card it is (`card:<id>`, its own face, no pile), where
 * it lies until the pointer moves it. It then follows the pointer, lifts,
 * lights the targets it would land on, makes room in a row and settles like
 * any card dragged on the table; and the next scene finds it painted under
 * the same key, so it flies on from where it was dropped rather than
 * appearing in its new place. The deck's cover stays on the pile under a
 * stand-in id, so the pile keeps its height while its top card is away.
 */
export const withHeldCards = (
  scene: BoardScene,
  presentation: Pick<BoardPresentation, 'drag' | 'settling' | 'openedZoneId'>
): BoardScene => {
  const held = new Set<string>();
  if (presentation.drag) held.add(String(presentation.drag.cardId));
  const dropped = new Map<string, { readonly x: number; readonly y: number }>();
  for (const entry of presentation.settling) {
    held.add(String(entry.cardId));
    if (String(entry.cardId) !== String(presentation.drag?.cardId))
      dropped.set(String(entry.cardId), entry);
  }
  if (held.size === 0) return scene;
  const lifted: CardSceneNode[] = [];
  let changed = false;
  const cards = scene.cards.map((card) => {
    if (!held.has(String(card.id))) return card;
    const droppedAt = dropped.get(String(card.id));
    if (card.renderKey === null) {
      changed = true;
      return asHeldCard(card, droppedAt);
    }
    // The top card taken from the open pile's viewer; on the table the cover
    // itself is lifted, as it always has been.
    if (
      card.renderKey.startsWith('cover:') &&
      card.parentId === presentation.openedZoneId
    ) {
      changed = true;
      lifted.push(asHeldCard(card, droppedAt));
      return {
        ...card,
        id: `${String(card.id)}${COVER_STAND_IN}` as CardSceneNode['id'],
        interactive: false,
      };
    }
    return card;
  });
  return changed ? { ...scene, cards: [...cards, ...lifted] } : scene;
};

/** Where on its face a card is gripped: 0..1 across and down. */
export interface CardGrip {
  readonly x: number;
  readonly y: number;
}

/** The grip's offset from the card's centre, turned as the card is. */
const gripOffset = (
  card: CardSceneNode,
  grip: CardGrip
): { readonly x: number; readonly y: number } => {
  const u = (grip.x - 0.5) * card.bounds.width;
  const v = (grip.y - 0.5) * card.bounds.height;
  const turn = (card.rotationQuarterTurns * Math.PI) / 2;
  return {
    x: u * Math.cos(turn) - v * Math.sin(turn),
    y: u * Math.sin(turn) + v * Math.cos(turn),
  };
};

/**
 * The pointer input a drag reads for a card picked up anywhere -- on the
 * table or out of a viewer -- worked out as the table works it out. `point`
 * is the pointer in the board's own coordinates. Starting, the card is
 * gripped where it was pressed, so it never jumps to centre on the pointer.
 * On the tilted table a held card rises to its lifted height and stays under
 * the pointer there; the pointer aims the drop by projected picking, the
 * row under it opens a gap, and the card comes down centred straight below
 * where it is held. Flat, the drag controller resolves the target itself.
 */
export const boardDragInput = (
  scene: BoardScene,
  depth: BoardDepthProjection | undefined,
  card: CardSceneNode,
  pointerId: number,
  point: { readonly x: number; readonly y: number },
  grip: CardGrip,
  starting = false
): BoardPointerInput => {
  const offset = gripOffset(card, grip);
  if (starting) {
    // Pressed: the grip on the card where it lies, so the drag keeps it.
    return {
      pointerId,
      button: 0,
      x: card.bounds.x + card.bounds.width / 2 + offset.x,
      y: card.bounds.y + card.bounds.height / 2 + offset.y,
      screenPoint: point,
    };
  }
  // The drag starts once the pointer has moved from where it pressed, wherever
  // the card itself lies (a viewer shows it far from its pile).
  if (!depth)
    return { pointerId, button: 0, x: point.x, y: point.y, screenPoint: point };
  const base = depth.pose(card);
  const grabPoint = depth.cardPoint(card, point, {
    ...base,
    plane: 1,
    elevation: base.elevation + depth.liftFor(base.bounds.width),
  });
  const hit = depth.drop(point, card.id);
  return {
    pointerId,
    button: 0,
    x: grabPoint.x,
    y: grabPoint.y,
    screenPoint: point,
    dropPoint: { x: grabPoint.x - offset.x, y: grabPoint.y - offset.y },
    targetId: hit.targetId,
    arrangementIndex: arrangementIndexAt(
      scene,
      card.id,
      hit.targetId,
      hit.point.x,
      hit.point.y
    ),
  };
};
