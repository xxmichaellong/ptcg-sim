import type { ViewCardId } from '@ptcgsim/game-core';

import type { BoardScene, CardSceneNode, ZoneSceneNode } from './model.js';

/**
 * The most items a group drag carries in the hand (ADR-042 §8): the one
 * gripped, and four more fanned out behind it. The rest stay where they
 * lie, ringed, and fly to their places once the room has moved them.
 */
export const MAX_CARRIED_ITEMS = 5;

/**
 * How far each carried item lies behind the one before it, as parts of the
 * gripped card's size: down and to the right, as a few cards held spread in
 * one hand.
 */
const FAN = { x: 0.16, y: 0.07 } as const;

const STACK_ROLES = new Set(['stackEvolution', 'stackAttachment']);

const sceneCard = (
  scene: BoardScene,
  cardId: ViewCardId
): CardSceneNode | undefined =>
  scene.cards.find((candidate) => candidate.id === cardId);

/**
 * The item a card stands for in a selection, as the table shows it: any card
 * of a Pokémon's own line is the whole Pokémon, by its top card (the last of
 * its line); any other card -- an attached Energy among them -- itself.
 * The scene's reading of `normalizeSelection`, which decides for the room.
 */
export const selectionItemOf = (
  scene: BoardScene,
  cardId: ViewCardId
): ViewCardId => {
  const card = sceneCard(scene, cardId);
  if (card?.role !== 'stackEvolution') return cardId;
  let top = card;
  for (const other of scene.cards)
    if (other.parentId === card.parentId && other.role === 'stackEvolution')
      top = other;
  return top.id;
};

/** The cards an item moves: a whole Pokémon's, or the card alone. */
export const selectionItemCardIds = (
  scene: BoardScene,
  itemId: ViewCardId
): readonly ViewCardId[] => {
  const card = sceneCard(scene, itemId);
  if (card?.role !== 'stackEvolution') return [itemId];
  return scene.cards
    .filter(
      (other) => other.parentId === card.parentId && STACK_ROLES.has(other.role)
    )
    .map((other) => other.id);
};

const groupCardsMemo = new WeakMap<
  readonly ViewCardId[],
  { readonly scene: BoardScene; readonly cards: ReadonlySet<ViewCardId> }
>();

/**
 * Every card a group's items move: none of them is a place the group can
 * be put down on, and a row the group is put into counts none of them
 * among the cards that stay.
 */
export const groupCardsOf = (
  scene: BoardScene,
  groupCardIds: readonly ViewCardId[] | undefined
): ReadonlySet<ViewCardId> => {
  if (!groupCardIds || groupCardIds.length === 0) return new Set();
  const known = groupCardsMemo.get(groupCardIds);
  if (known?.scene === scene) return known.cards;
  const cards = new Set<ViewCardId>();
  for (const itemId of groupCardIds)
    for (const cardId of selectionItemCardIds(scene, itemId)) cards.add(cardId);
  groupCardsMemo.set(groupCardIds, { scene, cards });
  return cards;
};

/** One item a group drag carries in the hand. */
export interface CarriedItem {
  /** The item: a card, or a whole Pokémon by its top card. */
  readonly itemId: ViewCardId;
  /** 0 for the one gripped; 1 to 4 for those fanned out behind it. */
  readonly layer: number;
  /** Where its card's centre is held, from the gripped card's centre. */
  readonly dx: number;
  readonly dy: number;
}

/** A drag, or anything held like one, that may carry a group. */
export interface GroupHold {
  readonly cardId: ViewCardId;
  readonly groupCardIds?: readonly ViewCardId[];
  readonly detached?: boolean;
}

/**
 * The items a group drag carries in the hand: the gripped card's item
 * first, then the next items of the selection in its order, at most
 * MAX_CARRIED_ITEMS, each fanned out a little further behind. A card
 * lifted off its Pokémon by a long press, and a drag of no group, carry
 * only the card. The controller settles a group's drop from these, so the
 * cards come down where they were held.
 */
export const carriedGroup = (
  scene: BoardScene,
  hold: GroupHold
): readonly CarriedItem[] => {
  const lead = sceneCard(scene, hold.cardId);
  const leadItem = selectionItemOf(scene, hold.cardId);
  const first: CarriedItem = { itemId: leadItem, layer: 0, dx: 0, dy: 0 };
  const group = hold.groupCardIds;
  if (!lead || hold.detached || !group || group.length < 2) return [first];
  const carried: CarriedItem[] = [first];
  for (const itemId of group) {
    if (carried.length >= MAX_CARRIED_ITEMS) break;
    if (itemId === leadItem || !sceneCard(scene, itemId)) continue;
    const layer = carried.length;
    carried.push({
      itemId,
      layer,
      dx: layer * FAN.x * lead.bounds.width,
      dy: layer * FAN.y * lead.bounds.height,
    });
  }
  return carried;
};

interface FannedCard {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

const fannedMemo = new WeakMap<
  object,
  {
    readonly scene: BoardScene;
    readonly cards: ReadonlyMap<ViewCardId, FannedCard>;
  }
>();

const centreOf = (card: CardSceneNode) => ({
  x: card.bounds.x + card.bounds.width / 2,
  y: card.bounds.y + card.bounds.height / 2,
});

/**
 * Where a card fanned out behind the gripped one is held, when it is one:
 * its item's place in the fan, a Pokémon's other cards around its top card
 * as they lie. The gripped card's own item is not here (its Pokémon
 * travels with it as it always has). Worked out once per drag position.
 */
export const fannedHoldOf = (
  scene: BoardScene,
  card: CardSceneNode,
  hold: GroupHold & { readonly x: number; readonly y: number }
): FannedCard | null => {
  if (!hold.groupCardIds || hold.groupCardIds.length < 2 || hold.detached)
    return null;
  let known = fannedMemo.get(hold);
  if (known?.scene !== scene) {
    const cards = new Map<ViewCardId, FannedCard>();
    for (const item of carriedGroup(scene, hold)) {
      if (item.layer === 0) continue;
      const anchor = sceneCard(scene, item.itemId);
      if (!anchor) continue;
      const at = centreOf(anchor);
      for (const cardId of selectionItemCardIds(scene, item.itemId)) {
        const member = sceneCard(scene, cardId);
        if (!member) continue;
        const centre = centreOf(member);
        cards.set(cardId, {
          x: hold.x + item.dx + centre.x - at.x,
          y: hold.y + item.dy + centre.y - at.y,
          layer: item.layer,
        });
      }
    }
    known = { scene, cards };
    fannedMemo.set(hold, known);
  }
  return known.cards.get(card.id) ?? null;
};

/**
 * How many places a group opens in a row it is held over (ADR-042 §3): in a
 * hand, the loose board or the Prizes, one for each card that arrives (a
 * whole Pokémon's cards each have their own); on the Bench, one for each
 * Pokémon it makes -- a card printed in pieces makes one Pokémon of one of
 * each piece, so two copies of a LEGEND's halves make two.
 */
export const groupArrivalWidth = (
  scene: BoardScene,
  groupCardIds: readonly ViewCardId[] | undefined,
  zone: Pick<ZoneSceneNode, 'kind'>
): number => {
  if (!groupCardIds || groupCardIds.length < 2) return 1;
  if (zone.kind !== 'bench')
    return Math.max(1, groupCardsOf(scene, groupCardIds).size);
  let loose = 0;
  const pieces = new Map<string, number[]>();
  for (const itemId of groupCardIds) {
    const join = sceneCard(scene, itemId)?.presentation?.join;
    if (!join) {
      loose += 1;
      continue;
    }
    const parts = pieces.get(join.key) ?? [0, 0, 0, 0];
    parts[join.part] = (parts[join.part] ?? 0) + 1;
    pieces.set(join.key, parts);
  }
  let made = loose;
  for (const parts of pieces.values()) made += Math.max(...parts);
  return Math.max(1, made);
};
