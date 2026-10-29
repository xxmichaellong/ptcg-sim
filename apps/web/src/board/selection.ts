import type { MatchViewState, PlayerId, ViewCardId } from '@ptcgsim/game-core';
import {
  NO_SELECTION,
  sameSelection,
  type BoardScene,
} from '@ptcgsim/renderer-contract';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';
import { visiblePieceSetOf } from './piece-sets.js';

/** The most items one selection holds: a deck's worth. */
export const MAX_SELECTION_ITEMS = 60;

/** The table a selection is made on and read against. */
export interface SelectionContext {
  readonly view: MatchViewState;
  readonly scene: BoardScene;
  /** The seat at the bottom (a flipped Solo board): its windows are worked too. */
  readonly actingPlayerId?: PlayerId;
  /**
   * Solo's one player, who moves both seats' cards, face-down ones too, and
   * works both seats' windows.
   */
  readonly controlsEverySeat?: boolean;
  /** The pile open in the viewer: its cards are items, as a pile's are not. */
  readonly openedZoneId?: string | null;
}

/**
 * Why a card can't be taken into the selection:
 * - `stale_card`: it is no longer on the table, or its pile closed;
 * - `not_an_item`: a pile's top on the table (the deck, the discard pile,
 *   the Lost Zone), which is opened to pick cards from it;
 * - `uncontrolled`: a card this seat can't move (the other player's
 *   face-down hand, or a window that is theirs);
 * - `in_selected_pokemon`: a card attached to a Pokémon already selected,
 *   which it goes with;
 * - `full`: the selection holds as many as it may.
 */
export type SelectionRefusalReason =
  | 'stale_card'
  | 'not_an_item'
  | 'uncontrolled'
  | 'in_selected_pokemon'
  | 'full';

export interface SelectionRefusal {
  readonly cardId: ViewCardId;
  readonly reason: SelectionRefusalReason;
}

/** What a card stands for in a selection. */
type ItemLookup =
  | {
      readonly item: ViewCardId;
      /** The Pokémon (its stack) when the item is a whole Pokémon. */
      readonly stackId?: string;
      /** The Pokémon an attached card lies on, which it moves without. */
      readonly attachedTo?: string;
    }
  | { readonly reason: Exclude<SelectionRefusalReason, 'full'> };

const PILE_KINDS = new Set(['deck', 'discard', 'lostZone']);

/** On the table, or in the pile open in the viewer. */
const isShown = (context: SelectionContext, cardId: ViewCardId): boolean =>
  context.scene.cards.some(
    (card) =>
      card.id === cardId &&
      (card.interactive ||
        (context.openedZoneId != null &&
          card.parentId === context.openedZoneId))
  );

/**
 * The item a card stands for: any card of a Pokémon's own line stands for
 * the whole Pokémon (by its top card), and the cards attached to it come
 * with it; any other card stands for itself.
 */
const lookUpItem = (
  context: SelectionContext,
  cardId: ViewCardId
): ItemLookup => {
  const { view } = context;
  if (view.viewer.kind !== 'player') return { reason: 'uncontrolled' };
  if (!isShown(context, cardId)) return { reason: 'stale_card' };
  const located = locateViewCardActionSource(view, cardId);
  if (!located) return { reason: 'stale_card' };
  const viewerId = view.viewer.playerId;
  const ownSeat = (playerId: string) =>
    playerId === viewerId ||
    playerId === context.actingPlayerId ||
    context.controlsEverySeat === true;
  if (
    located.card.kind === 'concealed' &&
    located.card.ownerId !== viewerId &&
    context.controlsEverySeat !== true
  ) {
    return { reason: 'uncontrolled' };
  }
  switch (located.sourceKind) {
    case 'zone': {
      const zone = view.zones[located.sourceId]!;
      if (PILE_KINDS.has(zone.kind) && zone.id !== context.openedZoneId) {
        return { reason: 'not_an_item' };
      }
      return { item: located.card.id };
    }
    case 'stack': {
      const stack = view.stacks[located.sourceId]!;
      const top = stack.evolutionCards.at(-1);
      if (stack.evolutionCards.some((card) => card.id === cardId) && top) {
        return { item: top.id, stackId: stack.id };
      }
      return { item: located.card.id, attachedTo: stack.id };
    }
    case 'inspection':
    case 'staged':
      return ownSeat(located.sourcePlayerId)
        ? { item: located.card.id }
        : { reason: 'uncontrolled' };
  }
};

/** The Pokémon (stack) a selected item is, when it is a whole Pokémon. */
const stackOfItem = (
  view: MatchViewState,
  item: ViewCardId
): string | undefined =>
  Object.values(view.stacks).find(
    (stack) => stack.evolutionCards.at(-1)?.id === item
  )?.id;

/** The Pokémon a selected item is attached to, when it is. */
const attachedToOfItem = (
  view: MatchViewState,
  item: ViewCardId
): string | undefined =>
  Object.values(view.stacks).find((stack) =>
    stack.attachmentCards.some((card) => card.id === item)
  )?.id;

/** The items a card asks for, among those already selected. */
const itemAmong = (
  context: SelectionContext,
  cardId: ViewCardId,
  selected: readonly ViewCardId[]
): ItemLookup => {
  const found = lookUpItem(context, cardId);
  if ('reason' in found || found.attachedTo === undefined) return found;
  const attachedTo = found.attachedTo;
  return selected.some((item) => stackOfItem(context.view, item) === attachedTo)
    ? { reason: 'in_selected_pokemon' }
    : found;
};

/** The selection without the cards attached to a Pokémon it now holds whole. */
const withoutAttachedTo = (
  context: SelectionContext,
  selected: readonly ViewCardId[],
  stackId: string
): readonly ViewCardId[] =>
  selected.filter((item) => attachedToOfItem(context.view, item) !== stackId);

export interface NormalizedSelection {
  /** The items, in the order their cards came, each once. */
  readonly items: readonly ViewCardId[];
  /** The cards that are no item, and why, in the order they came. */
  readonly refused: readonly SelectionRefusal[];
}

/**
 * The pieces "Play as one card" finds beside the ones asked for (ADR-042
 * §5, `visiblePieceSetOf`): face up in their owner's hand or discard pile,
 * they are items while a piece of their set that is an item is asked for
 * with them -- though a closed pile's top, or a card under it, is not one
 * alone.
 */
const piecesBeside = (
  context: SelectionContext,
  cardIds: readonly ViewCardId[]
): ReadonlySet<ViewCardId> => {
  const beside = new Set<ViewCardId>();
  for (const cardId of cardIds) {
    if ('reason' in lookUpItem(context, cardId)) continue;
    const set = visiblePieceSetOf(context.view, cardId, context.openedZoneId);
    for (const member of set?.cardIds ?? []) beside.add(member);
  }
  return beside;
};

/**
 * Cards made into items (a whole Pokémon by its top card, any other card
 * itself), each once, in the order they came, at most MAX_SELECTION_ITEMS.
 * A card attached to a Pokémon that is selected goes with it, so it is not
 * an item of its own; a piece found beside another (`piecesBeside`) is
 * one, wherever it lies.
 */
export const normalizeSelection = (
  context: SelectionContext,
  cardIds: readonly ViewCardId[]
): NormalizedSelection => {
  let items: readonly ViewCardId[] = [];
  const refused: SelectionRefusal[] = [];
  let beside: ReadonlySet<ViewCardId> | undefined;
  for (const cardId of cardIds) {
    const asked = itemAmong(context, cardId, items);
    let found = asked;
    if (
      'reason' in asked &&
      (asked.reason === 'stale_card' || asked.reason === 'not_an_item')
    ) {
      beside ??= piecesBeside(context, cardIds);
      if (beside.has(cardId)) found = { item: cardId };
    }
    if ('reason' in found) {
      refused.push({ cardId, reason: found.reason });
      continue;
    }
    if (items.includes(found.item)) continue;
    if (items.length >= MAX_SELECTION_ITEMS) {
      refused.push({ cardId, reason: 'full' });
      continue;
    }
    items = [
      ...(found.stackId === undefined
        ? items
        : withoutAttachedTo(context, items, found.stackId)),
      found.item,
    ];
  }
  return { items, refused };
};

/**
 * A change to the selection:
 * - `replace`: these items alone (a rectangle, Select all, or one press);
 * - `toggle`: a plain press, v1's click: this item alone, or none when it
 *   was the one item selected;
 * - `add`: a press with Shift or ⌘/Ctrl: this item joins, or leaves if it
 *   was in, and the rest stay;
 * - `addMany`: these items join, the rest stay (a rectangle drawn with
 *   Shift or ⌘/Ctrl); none leaves;
 * - `clear`: none;
 * - `reconcile`: the items still on the table, after it changed (a
 *   Pokémon evolved stays selected by its new top card);
 * - `restore`: the items a refused move took, those still on the table.
 */
export type SelectionOperation =
  | { readonly kind: 'replace'; readonly cardIds: readonly ViewCardId[] }
  | { readonly kind: 'toggle'; readonly cardId: ViewCardId }
  | { readonly kind: 'add'; readonly cardId: ViewCardId }
  | { readonly kind: 'addMany'; readonly cardIds: readonly ViewCardId[] }
  | { readonly kind: 'clear' }
  | { readonly kind: 'reconcile' }
  | { readonly kind: 'restore'; readonly cardIds: readonly ViewCardId[] };

export interface SelectionChange {
  /** The new selection: the one passed in when nothing changed. */
  readonly selection: readonly ViewCardId[];
  /** Cards asked for that could not be taken, and why. */
  readonly refused: readonly SelectionRefusal[];
  /** Items that left the selection because they left the table. */
  readonly dropped: readonly ViewCardId[];
}

const settled = (
  previous: readonly ViewCardId[],
  next: readonly ViewCardId[],
  refused: readonly SelectionRefusal[] = [],
  dropped: readonly ViewCardId[] = []
): SelectionChange => ({
  selection: sameSelection(previous, next)
    ? previous
    : next.length === 0
      ? NO_SELECTION
      : next,
  refused,
  dropped,
});

/** The selection after one change, against the table as it stands. */
export const reduceSelection = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  operation: SelectionOperation
): SelectionChange => {
  switch (operation.kind) {
    case 'replace': {
      const { items, refused } = normalizeSelection(context, operation.cardIds);
      return settled(selection, items, refused);
    }
    case 'toggle': {
      const found = lookUpItem(context, operation.cardId);
      if ('reason' in found) {
        return settled(selection, selection, [
          { cardId: operation.cardId, reason: found.reason },
        ]);
      }
      return settled(
        selection,
        selection.length === 1 && selection[0] === found.item
          ? []
          : [found.item]
      );
    }
    case 'add': {
      const found = itemAmong(context, operation.cardId, selection);
      if ('reason' in found) {
        return settled(selection, selection, [
          { cardId: operation.cardId, reason: found.reason },
        ]);
      }
      if (selection.includes(found.item)) {
        return settled(
          selection,
          selection.filter((item) => item !== found.item)
        );
      }
      if (selection.length >= MAX_SELECTION_ITEMS) {
        return settled(selection, selection, [
          { cardId: operation.cardId, reason: 'full' },
        ]);
      }
      return settled(selection, [
        ...(found.stackId === undefined
          ? selection
          : withoutAttachedTo(context, selection, found.stackId)),
        found.item,
      ]);
    }
    case 'addMany': {
      const { items, refused } = normalizeSelection(context, [
        ...selection,
        ...operation.cardIds,
      ]);
      // The ones already selected were taken before: what was refused is
      // of the new cards only.
      return settled(
        selection,
        items,
        refused.filter((entry) => operation.cardIds.includes(entry.cardId))
      );
    }
    case 'clear':
      return settled(selection, []);
    case 'reconcile': {
      const { items, refused } = normalizeSelection(context, selection);
      return settled(
        selection,
        items,
        [],
        refused.map((entry) => entry.cardId)
      );
    }
    case 'restore':
      return settled(
        selection,
        normalizeSelection(context, operation.cardIds).items
      );
  }
};
