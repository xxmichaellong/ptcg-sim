import type { ViewCardId } from '@ptcgsim/game-core';

import { containsPoint } from './geometry.js';
import { groupArrivalWidth, groupCardsOf } from './group-carry.js';
import {
  layoutTableHand,
  layoutTablePrizes,
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
 * bench, the loose board, the Prizes -- a card goes exactly where it is
 * put, as on a real table. A drop into one of these zones takes its place
 * from the pointer, and while the card is held the zone opens a gap there.
 *
 * Indices count the zone's own order (its first card is 0, whichever way
 * its owner's half is turned) among the items that stay: a card moved
 * within its zone is not counted, which is what the game's moves expect.
 *
 * A row's place is worked out across it; the Prizes' grid (filled row by
 * row from its owner's top left, `layoutTablePrizes`) takes the cell under
 * the pointer, and its other cards reflow around the gap in that order.
 */

const ARRANGED_KINDS = new Set(['hand', 'board', 'bench', 'prizes']);

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
 * The cards a zone moves aside to open a gap for a card held over it: those
 * of each hand, loose board and Prizes, and each benched Pokémon's.
 */
export const arrangedCardIds = (scene: BoardScene): ReadonlySet<ViewCardId> => {
  const ids = new Set<ViewCardId>();
  for (const zone of scene.zones) {
    if (!arrangedZone(scene, zone.id)) continue;
    if (zone.kind === 'bench') {
      for (const item of benchItems(scene, zone))
        for (const id of item.cardIds) ids.add(id);
      continue;
    }
    for (const card of scene.cards)
      if (card.parentId === zone.id && card.renderKey !== null)
        ids.add(card.id);
  }
  return ids;
};

/**
 * The zone's items in its own order, without the one being moved: the card
 * itself, or the whole Pokémon when its top card is carried; nor any card
 * of a group carried with it (`exclude`).
 */
const rowItems = (
  scene: BoardScene,
  zone: ZoneSceneNode,
  sourceCardId: ViewCardId,
  exclude?: ReadonlySet<ViewCardId>
): RowItem[] => {
  const source = scene.cards.find((card) => card.id === sourceCardId);
  const stays = (cardIds: readonly ViewCardId[]) =>
    !exclude || cardIds.every((cardId) => !exclude.has(cardId));
  if (zone.kind === 'prizes') {
    // A grid's order is its own (row by row), not across the screen: a
    // zone's cards are painted in it, one above the next.
    return scene.cards
      .filter(
        (card) =>
          card.parentId === zone.id &&
          card.renderKey !== null &&
          card.id !== sourceCardId &&
          stays([card.id])
      )
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((card) => ({
        key: String(card.id),
        cardIds: [card.id],
        rect: card.bounds,
      }));
  }
  const items =
    zone.kind === 'bench'
      ? benchItems(scene, zone).filter(
          (item) =>
            !(
              source?.role === 'stackEvolution' && item.key === source.parentId
            ) && stays(item.cardIds)
        )
      : scene.cards
          .filter(
            (card) =>
              card.parentId === zone.id &&
              card.renderKey !== null &&
              card.id !== sourceCardId &&
              stays([card.id])
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

/** The Prizes' cells for `count` cards, as the scene lays them out. */
const prizeCells = (zone: ZoneSceneNode, count: number): Rect[] =>
  layoutTablePrizes(
    zone.contentBounds,
    zone.side === 'opponent' ? 'opponent' : 'local',
    count
  );

/**
 * The cell nearest a point: the one it is in, within the grid (cells are
 * alike and evenly spaced, so the nearest centre is the cell's own), else
 * the closest -- past the last card, the last place.
 */
const nearestCell = (cells: readonly Rect[], x: number, y: number): number => {
  let nearest = 0;
  let distance = Infinity;
  cells.forEach((cell, index) => {
    const next = Math.hypot(
      cell.x + cell.width / 2 - x,
      cell.y + cell.height / 2 - y
    );
    if (next < distance) {
      nearest = index;
      distance = next;
    }
  });
  return nearest;
};

/**
 * Where among the zone's items a card dropped at (x, y) goes, or null when
 * the zone keeps no order a player sets (a pile, the Active Spot).
 *
 * On the tilted table (x, y) is where the drop lands on the card under the
 * pointer, which may be painted aside from its place to open a gap; `aim`
 * is the point on the mat under the pointer itself. A row compares the
 * point with its cards' middles, which reads the same either way; a grid
 * takes the cell the pointer is over, so it needs `aim`.
 *
 * A group (`groupCardIds`, the items carried with the card) counts only
 * the items that stay, as a group's move does (`MovePlayStack.benchIndex`).
 */
export const arrangementIndexAt = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  targetId: string | null | undefined,
  x: number,
  y: number,
  aim?: { readonly x: number; readonly y: number },
  groupCardIds?: readonly ViewCardId[]
): number | null => {
  const zone = arrangedZone(scene, targetId);
  if (!zone) return null;
  const group =
    groupCardIds && groupCardIds.length > 1
      ? groupCardsOf(scene, groupCardIds)
      : undefined;
  const items = rowItems(scene, zone, sourceCardId, group);
  if (zone.kind === 'prizes') {
    const point = aim ?? { x, y };
    return nearestCell(
      prizeCells(
        zone,
        items.length + groupArrivalWidth(scene, groupCardIds, zone)
      ),
      point.x,
      point.y
    );
  }
  const forward = zone.side === 'local' ? 1 : -1;
  return items.filter((item) => forward * (centreX(item.rect) - x) < 0).length;
};

/** A card being put into a place: held over a zone, or just let go there. */
export interface ArrangementHold {
  readonly cardId: ViewCardId;
  readonly targetId: string;
  readonly index: number;
  /** How many places it takes: more than one for a group (ADR-042). */
  readonly width?: number;
  /** The group's cards, which the row does not count among those staying. */
  readonly exclude?: ReadonlySet<ViewCardId>;
}

/** The cards settling entries hold: each entry's card, a whole Pokémon's all. */
const settlingCards = (
  scene: BoardScene,
  entries: BoardPresentation['settling']
): ReadonlySet<ViewCardId> => {
  const cards = new Set<ViewCardId>();
  for (const entry of entries) {
    cards.add(entry.cardId);
    if (!entry.wholeStack) continue;
    const anchor = scene.cards.find((card) => card.id === entry.cardId);
    if (anchor?.role !== 'stackEvolution') continue;
    for (const card of scene.cards)
      if (card.parentId === anchor.parentId) cards.add(card.id);
  }
  return cards;
};

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
    if (drag.index === undefined || drag.targetId === null) return null;
    const zone = arrangedZone(scene, drag.targetId);
    const group = drag.groupCardIds;
    return {
      cardId: drag.cardId,
      targetId: drag.targetId,
      index: drag.index,
      ...(zone && group && group.length > 1
        ? {
            width: groupArrivalWidth(scene, group, zone),
            exclude: groupCardsOf(scene, group),
          }
        : {}),
    };
  }
  for (const entry of [...presentation.settling].reverse()) {
    const arrangement = entry.arrangement;
    if (arrangement && arrangement.revision === scene.revision) {
      // A group's drop: the cards settling with it are not among those
      // staying either.
      const together =
        entry.dropId === undefined
          ? []
          : presentation.settling.filter(
              (other) => other.dropId === entry.dropId
            );
      return {
        cardId: entry.cardId,
        targetId: arrangement.targetId,
        index: arrangement.index,
        ...(arrangement.width !== undefined && arrangement.width > 1
          ? { width: arrangement.width }
          : {}),
        ...(together.length > 1
          ? { exclude: settlingCards(scene, together) }
          : {}),
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
  const items = rowItems(scene, zone, hold.cardId, hold.exclude);
  const index = Math.max(0, Math.min(hold.index, items.length));
  // A group opens one place for each card or Pokémon it brings.
  const width = Math.max(1, hold.width ?? 1);
  const count = items.length + width;
  const slotOf = (position: number) =>
    position < index ? position : position + width;
  if (zone.kind === 'prizes') {
    // The grid as it will be: each card one cell on from the gap onwards.
    const cells = prizeCells(zone, count);
    items.forEach((item, position) => {
      const cell = cells[slotOf(position)];
      if (!cell) return;
      for (const cardId of item.cardIds)
        offsets.set(cardId, {
          x: cell.x - item.rect.x,
          y: cell.y - item.rect.y,
        });
    });
    return offsets;
  }
  if (zone.kind === 'hand' || zone.kind === 'board') {
    const side = zone.side === 'shared' ? 'local' : zone.side;
    const play = scene.layout.playAreaBounds;
    const slots =
      zone.kind === 'hand'
        ? layoutTableHand(
            zone.contentBounds,
            side,
            count,
            play.x + play.width / 2
          )
        : layoutTableRow(zone.contentBounds, side, count);
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
 * A card lifted off its Pokémon alone (`detached`, by a long press) is not
 * that Pokémon: it goes onto the one it is dropped on.
 */
export const benchRearrangementTarget = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  hitCard: CardSceneNode,
  detached = false
): string | null => {
  const source = scene.cards.find((card) => card.id === sourceCardId);
  if (
    detached ||
    source?.role !== 'stackEvolution' ||
    !STACK_ROLES.has(hitCard.role)
  )
    return null;
  const bench = scene.zones.find(
    (zone) =>
      zone.kind === 'bench' &&
      zone.interactive &&
      benchItems(scene, zone).some((item) => item.key === hitCard.parentId)
  );
  if (!bench) return null;
  if (benchItems(scene, bench).some((item) => item.key === source.parentId))
    return bench.id;
  // From the other board, a Pokémon joins this Bench where it is put, as
  // the room places it, rather than trading places with the one under it.
  const sourceCards = scene.cards.filter(
    (card) => card.parentId === source.parentId && STACK_ROLES.has(card.role)
  );
  const home = unionRect(sourceCards.map((card) => card.bounds));
  const homeZone = scene.zones.find(
    (zone) =>
      (zone.kind === 'active' || zone.kind === 'bench') &&
      containsPoint(zone.bounds, centreX(home), home.y + home.height / 2)
  );
  return homeZone?.playerId &&
    bench.playerId &&
    homeZone.playerId !== bench.playerId
    ? bench.id
    : null;
};
