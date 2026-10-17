import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { predictWireCommand } from './predictWireCommand.js';

/**
 * The IDs predictWireCommand gives what a predicted command creates, until
 * the room publishes it: a Pokémon played into a new stack, a stack taken
 * apart into a window, a look at a deck.
 */
const PREDICTED_STACK = 'predicted-stack:';
const PREDICTED_WORK_AREA = 'predicted-work-area:';
const PREDICTED_INSPECTION = 'predicted-inspection:';
/** Entries remembered, newest last: far more than a queue of moves needs. */
const REMEMBERED_STACKS = 64;

export type ProvisionalRebinder = (
  command: WireGameCommand,
  view: MatchViewState
) => WireGameCommand;

/**
 * A command built on a prediction (Energy attached to a Pokémon played a
 * moment before) names what it targets by its predicted ID. Just before it
 * is sent, the room has published the real one; this swaps them. A stack
 * once found is remembered, so a window later made by taking it apart is
 * found too, after the stack itself is gone. Anything not found is left
 * for the room to refuse as stale. One per session.
 */
export const createProvisionalRebinder = (): ProvisionalRebinder => {
  const remember = <Value>(
    memory: Map<string, Value>,
    key: string,
    value: Value
  ): void => {
    memory.delete(key);
    memory.set(key, value);
    if (memory.size > REMEMBERED_STACKS) {
      memory.delete(memory.keys().next().value!);
    }
  };
  const stacks = new Map<string, string>();
  /** Where each predicted Pokémon was played, from the command that did. */
  const placements = new Map<
    string,
    {
      readonly boardPlayerId: string;
      readonly slot: 'active' | 'bench';
      readonly benchIndex?: number;
      /** The stacks there were as it was sent; the play made none of them. */
      readonly before: ReadonlySet<string>;
    }
  >();
  /**
   * A card's alias can change as it enters play (Solo shows the other
   * seat's hand under the aliases it had while concealed): the card a
   * predicted stack was named for, then the stack's card in the room.
   */
  const cards = new Map<string, string>();

  /**
   * Cards a sent command brings into a hand (a draw, a card taken back from
   * the discard, a Pokémon picked up, or one moved within the hand, which
   * the room renames too so the other player can't follow it): the hand
   * gets them under new aliases, so a move made on one before then names
   * the old. Each is matched by its definition among the hand's new cards
   * at the next send, once the command has landed.
   */
  let arrivals: {
    readonly zoneId: string;
    readonly before: ReadonlySet<string>;
    readonly cards: readonly {
      readonly alias: string;
      readonly definitionId: string;
    }[];
  }[] = [];
  const recordArrivals = (command: WireGameCommand, view: MatchViewState) => {
    const predicted = predictWireCommand(view, command);
    if (!predicted) return;
    const moved = command.type === 'MoveCard' ? command.cardId : undefined;
    for (const zone of Object.values(predicted.zones)) {
      if (zone.kind !== 'hand') continue;
      const before = new Set(
        (view.zones[zone.id]?.cards ?? []).map((card) => card.id)
      );
      const cards = zone.cards.flatMap((card) =>
        card.kind === 'known' && (!before.has(card.id) || card.id === moved)
          ? [{ alias: card.id, definitionId: card.definitionId }]
          : []
      );
      if (cards.length > 0) arrivals.push({ zoneId: zone.id, before, cards });
    }
  };
  const settleArrivals = (view: MatchViewState) => {
    for (const arrival of arrivals) {
      const hand = view.zones[arrival.zoneId]?.cards ?? [];
      const present = new Set<string>(hand.map((card) => card.id));
      const fresh = hand.filter(
        (card) => card.kind === 'known' && !arrival.before.has(card.id)
      );
      for (const { alias, definitionId } of arrival.cards) {
        if (present.has(alias)) continue;
        const index = fresh.findIndex(
          (card) => card.kind === 'known' && card.definitionId === definitionId
        );
        if (index < 0) continue;
        remember(cards, alias, fresh[index]!.id);
        fresh.splice(index, 1);
      }
    }
    arrivals = [];
  };

  const placedStack = (id: string, view: MatchViewState) => {
    const placement = placements.get(id);
    const board = placement ? view.boards[placement.boardPlayerId] : undefined;
    if (!placement || !board) return undefined;
    const stackId =
      placement.slot === 'active'
        ? board.activeStackId
        : placement.benchIndex === undefined
          ? board.benchStackIds.at(-1)
          : board.benchStackIds[placement.benchIndex];
    // A stack that was already there is not the one it made: the play was
    // refused, and the move that named it must be refused as stale too.
    return stackId && !placement.before.has(stackId)
      ? view.stacks[stackId]
      : undefined;
  };

  const stackIdFor = (id: string, view: MatchViewState): string => {
    if (!id.startsWith(PREDICTED_STACK)) return id;
    const cardId = id.slice(PREDICTED_STACK.length);
    const found = Object.values(view.stacks).find((stack) =>
      stack.evolutionCards.some((card) => card.id === cardId)
    )?.id;
    if (found) {
      remember(stacks, id, found);
      return found;
    }
    const remembered = stacks.get(id);
    if (remembered) return remembered;
    // Not under its old alias: the stack where it was played, if that is
    // still the one-card stack it made.
    const placed = placedStack(id, view);
    if (placed && placed.evolutionCards.length === 1) {
      remember(stacks, id, placed.id);
      remember(cards, cardId, placed.evolutionCards[0]!.id);
      return placed.id;
    }
    return id;
  };

  const cardInView = (cardId: string, view: MatchViewState): boolean =>
    Object.values(view.zones).some((zone) =>
      zone.cards.some((card) => card.id === cardId)
    ) ||
    Object.values(view.stacks).some(
      (stack) =>
        stack.evolutionCards.some((card) => card.id === cardId) ||
        stack.attachmentCards.some((card) => card.id === cardId)
    ) ||
    Object.values(view.workAreas).some(
      (areas) =>
        areas.inspection?.cards.some((card) => card.id === cardId) === true ||
        areas.attachmentResolution?.cards.some((card) => card.id === cardId) ===
          true
    );

  const roomIdFor = (id: string, view: MatchViewState): string => {
    if (id.startsWith(PREDICTED_STACK)) return stackIdFor(id, view);
    if (id.startsWith(PREDICTED_WORK_AREA)) {
      const stackId = stackIdFor(id.slice(PREDICTED_WORK_AREA.length), view);
      return (
        Object.values(view.workAreas).find(
          (areas) => areas.attachmentResolution?.sourceStackId === stackId
        )?.attachmentResolution?.id ?? id
      );
    }
    if (id.startsWith(PREDICTED_INSPECTION)) {
      const ownerId = id.slice(PREDICTED_INSPECTION.length);
      return view.workAreas[ownerId]?.inspection?.id ?? id;
    }
    if (!cards.has(id) || cardInView(id, view)) return id;
    // Renamed more than once (moved within the hand twice): follow each
    // rename to the name the room has it under now.
    let card = cards.get(id)!;
    for (
      let step = 0;
      step < REMEMBERED_STACKS && cards.has(card) && !cardInView(card, view);
      step += 1
    ) {
      card = cards.get(card)!;
    }
    return card;
  };

  const collect = (value: unknown, view: MatchViewState): void => {
    if (typeof value === 'string') {
      if (value.startsWith(PREDICTED_STACK)) stackIdFor(value, view);
      if (value.startsWith(PREDICTED_WORK_AREA))
        stackIdFor(value.slice(PREDICTED_WORK_AREA.length), view);
    } else if (Array.isArray(value)) {
      for (const child of value) collect(child, view);
    } else if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) collect(child, view);
    }
  };

  return (command, view) => {
    settleArrivals(view);
    // A Pokémon played into a new stack: remember where, in case its card
    // comes back under another alias.
    if (command.type === 'MoveCardToPlay' && !command.targetStackId) {
      remember(placements, `${PREDICTED_STACK}${command.cardId}`, {
        boardPlayerId: command.boardPlayerId,
        slot: command.slot,
        ...(command.benchIndex === undefined
          ? {}
          : { benchIndex: command.benchIndex }),
        before: new Set(Object.keys(view.stacks)),
      });
    }
    // Stacks first, so a card alias they reveal is known for every field.
    collect(command, view);
    let changed = false;
    const rebind = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const id = roomIdFor(value, view);
        if (id !== value) changed = true;
        return id;
      }
      if (Array.isArray(value)) return value.map(rebind);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, rebind(child)])
        );
      }
      return value;
    };
    const walked = rebind(command) as WireGameCommand;
    const rebound = changed ? walked : command;
    recordArrivals(rebound, view);
    return rebound;
  };
};
