import type { ViewCardId } from '@ptcgsim/game-core';

import { containsPoint } from './geometry.js';
import {
  layoutTableHand,
  layoutTableRow,
  TABLE_LAYOUT_GEOMETRY_VERSION,
} from './layout-table.js';
import type {
  BoardPresentation,
  BoardScene,
  CardSceneNode,
  Rect,
  ZoneSceneNode,
} from './model.js';

/**
 * Free arrangement: where order carries no game meaning -- a hand, the
 * bench, the loose board -- a card goes exactly where it is put, as on a
 * real table. A drop into one of these zones takes its place from the
 * pointer, and while the card is held the zone opens a gap there.
 *
 * Indices count the zone's own order (its first card is 0, whichever way
 * its owner's half is turned) among the items that stay: a card moved
 * within its zone is not counted, which is what the game's moves expect.
 */

const ARRANGED_KINDS = new Set(['hand', 'board', 'bench']);

/** One thing in a row: a card, or a benched Pokémon with what it holds. */
interface RowItem {
  readonly key: string;
  readonly cardIds: readonly ViewCardId[];
  readonly rect: Rect;
}

const unionRect = (rects: readonly Rect[]): Rect => {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const centreX = (rect: Rect): number => rect.x + rect.width / 2;

const STACK_ROLES = new Set(['stackEvolution', 'stackAttachment']);

/**
 * The zone a card is being arranged in, when `targetId` is one. Only the
 * redesigned table (geometry v2) arranges freely; v1's geometry keeps v1's
 * order, where a card dropped back in its own zone stays put.
 */
export const arrangedZone = (
  scene: BoardScene,
  targetId: string | null | undefined
): ZoneSceneNode | undefined =>
  targetId && scene.layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION
    ? scene.zones.find(
        (zone) =>
          zone.id === targetId &&
          zone.interactive &&
          zone.side !== 'shared' &&
          ARRANGED_KINDS.has(zone.kind)
      )
    : undefined;

/** The benched stacks a bench zone holds, each as one item. */
const benchItems = (scene: BoardScene, zone: ZoneSceneNode): RowItem[] => {
  const groups = new Map<string, CardSceneNode[]>();
  for (const card of scene.cards) {
    if (card.renderKey === null || !STACK_ROLES.has(card.role)) continue;
    const group = groups.get(card.parentId) ?? [];
    group.push(card);
    groups.set(card.parentId, group);
  }
  const items: RowItem[] = [];
  for (const [key, cards] of groups) {
    const rect = unionRect(cards.map((card) => card.bounds));
    if (!containsPoint(zone.bounds, centreX(rect), rect.y + rect.height / 2)) {
      continue;
    }
    items.push({ key, cardIds: cards.map((card) => card.id), rect });
  }
  return items;
};

/**
 * The zone's items in its own order, without the one being moved: the card
 * itself, or the whole Pokémon when its top card is carried.
 */
const rowItems = (
  scene: BoardScene,
  zone: ZoneSceneNode,
  sourceCardId: ViewCardId
): RowItem[] => {
  const source = scene.cards.find((card) => card.id === sourceCardId);
  const items =
    zone.kind === 'bench'
      ? benchItems(scene, zone).filter(
          (item) =>
            !(source?.role === 'stackEvolution' && item.key === source.parentId)
        )
      : scene.cards
          .filter(
            (card) =>
              card.parentId === zone.id &&
              card.renderKey !== null &&
              card.id !== sourceCardId
          )
          .map((card) => ({
            key: String(card.id),
            cardIds: [card.id],
            rect: card.bounds,
          }));
  // A turned half runs the other way across the screen.
  const forward = zone.side === 'local' ? 1 : -1;
  return items.sort(
    (left, right) => forward * (centreX(left.rect) - centreX(right.rect))
  );
};

/**
 * Where among the zone's items a card dropped at (x, y) goes, or null when
 * the zone keeps no order a player sets (a pile, the Active Spot, Prizes).
 */
export const arrangementIndexAt = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  targetId: string | null | undefined,
  x: number,
  _y: number
): number | null => {
  const zone = arrangedZone(scene, targetId);
  if (!zone) return null;
  const forward = zone.side === 'local' ? 1 : -1;
  return rowItems(scene, zone, sourceCardId).filter(
    (item) => forward * (centreX(item.rect) - x) < 0
  ).length;
};

/** A card being put into a place: held over a zone, or just let go there. */
export interface ArrangementHold {
  readonly cardId: ViewCardId;
  readonly targetId: string;
  readonly index: number;
}

/**
 * The place a zone is opening a gap for: the held card's, or the one just
 * let go of while its move settles -- on the scene it was dropped on only,
 * since the next scene already shows it in its place.
 */
export const arrangementHold = (
  scene: BoardScene,
  presentation: BoardPresentation
): ArrangementHold | null => {
  const drag = presentation.drag;
  if (drag) {
    return drag.index !== undefined && drag.targetId !== null
      ? { cardId: drag.cardId, targetId: drag.targetId, index: drag.index }
      : null;
  }
  for (const entry of [...presentation.settling].reverse()) {
    const arrangement = entry.arrangement;
    if (arrangement && arrangement.revision === scene.revision) {
      return {
        cardId: entry.cardId,
        targetId: arrangement.targetId,
        index: arrangement.index,
      };
    }
  }
  return null;
};

/**
 * How far each card of the target zone moves aside while a card is held over
 * it: the row as it will be once the card is put down, with its gap open.
 */
export const arrangementOffsets = (
  scene: BoardScene,
  hold: ArrangementHold | null
): ReadonlyMap<ViewCardId, { readonly x: number; readonly y: number }> => {
  const offsets = new Map<ViewCardId, { x: number; y: number }>();
  if (!hold) return offsets;
  const zone = arrangedZone(scene, hold.targetId);
  if (!zone) return offsets;
  const items = rowItems(scene, zone, hold.cardId);
  const index = Math.max(0, Math.min(hold.index, items.length));
  const count = items.length + 1;
  const slotOf = (position: number) =>
    position < index ? position : position + 1;
  if (zone.kind === 'hand' || zone.kind === 'board') {
    const side = zone.side === 'shared' ? 'local' : zone.side;
    const slots = (zone.kind === 'hand' ? layoutTableHand : layoutTableRow)(
      zone.contentBounds,
      side,
      count
    );
    items.forEach((item, position) => {
      const slot = slots[slotOf(position)];
      if (!slot) return;
      for (const cardId of item.cardIds)
        offsets.set(cardId, { x: slot.x - item.rect.x, y: 0 });
    });
    return offsets;
  }
  // The bench: its Pokémon keep their spacing, centred, the gap among them.
  const forward = zone.side === 'local' ? 1 : -1;
  const centres = items.map((item) => centreX(item.rect));
  const widest = Math.max(0, ...items.map((item) => item.rect.width));
  const spacing =
    centres.length > 1
      ? Math.abs(centres[1]! - centres[0]!)
      : Math.max(widest, zone.contentBounds.height * 0.75) * 1.1;
  const pitch = Math.min(
    spacing,
    count > 1
      ? Math.max(0, (zone.contentBounds.width - widest) / (count - 1))
      : 0
  );
  const middle = zone.contentBounds.x + zone.contentBounds.width / 2;
  items.forEach((item, position) => {
    const slot = slotOf(position);
    const target = middle + forward * (slot - (count - 1) / 2) * pitch;
    for (const cardId of item.cardIds)
      offsets.set(cardId, { x: target - centreX(item.rect), y: 0 });
  });
  return offsets;
};

/**
 * Over a benched Pokémon, a benched Pokémon being carried is being put in
 * a new place on the bench, not swapped with that one: its bench, or null.
 */
export const benchRearrangementTarget = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  hitCard: CardSceneNode
): string | null => {
  const source = scene.cards.find((card) => card.id === sourceCardId);
  if (source?.role !== 'stackEvolution' || !STACK_ROLES.has(hitCard.role))
    return null;
  const bench = scene.zones.find(
    (zone) =>
      zone.kind === 'bench' &&
      zone.interactive &&
      benchItems(scene, zone).some((item) => item.key === hitCard.parentId) &&
      benchItems(scene, zone).some((item) => item.key === source.parentId)
  );
  return bench?.id ?? null;
};
