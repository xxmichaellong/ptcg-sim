import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  isRandomizingCommand,
  predictWireCommand,
} from './predictWireCommand.js';

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

interface VisibilityContainer {
  readonly key: string;
  readonly id: string;
  readonly cards: readonly ViewCard[];
  readonly zoneKind?: MatchViewState['zones'][string]['kind'];
}

const visibilityContainers = (view: MatchViewState): VisibilityContainer[] => [
  ...Object.values(view.zones).map((zone) => ({
    key: `zone:${zone.id}`,
    id: zone.id,
    cards: zone.cards,
    zoneKind: zone.kind,
  })),
  ...Object.values(view.stacks).map((stack) => ({
    key: `stack:${stack.id}`,
    id: stack.id,
    cards: [...stack.evolutionCards, ...stack.attachmentCards],
  })),
  ...Object.values(view.workAreas).flatMap((areas) => [
    ...(areas.inspection
      ? [
          {
            key: `inspection:${areas.inspection.id}`,
            id: areas.inspection.id,
            cards: areas.inspection.cards,
          },
        ]
      : []),
    ...(areas.attachmentResolution
      ? [
          {
            key: `staged:${areas.attachmentResolution.id}`,
            id: areas.attachmentResolution.id,
            cards: areas.attachmentResolution.cards,
          },
        ]
      : []),
  ]),
];

export type ProvisionalRebinder = ((
  command: WireGameCommand,
  view: MatchViewState
) => WireGameCommand) & {
  /** An accepted command completed against this revision of the room view. */
  readonly accepted: (
    command: WireGameCommand,
    revision: number,
    view: MatchViewState
  ) => void;
  /** A command the room refused: the stack its play would have made isn't. */
  readonly refused: (command: WireGameCommand) => void;
};

/**
 * A command built on a prediction (Energy attached to a Pokémon played a
 * moment before) names what it targets by its predicted ID. Just before it
 * is sent, the room has published the real one; this swaps them. A stack
 * once found is remembered, so a window later made by taking it apart is
 * found too, after the stack itself is gone. Anything not found is left
 * for the room to refuse as stale. One per session.
 */
/** The definition of a card the sender can read, wherever it lies. */
const definitionOf = (
  view: MatchViewState,
  cardId: string
): { readonly definitionId?: string } => {
  const cards = [
    ...Object.values(view.zones).flatMap((zone) => zone.cards),
    ...Object.values(view.workAreas).flatMap((areas) => [
      ...(areas.inspection?.cards ?? []),
      ...(areas.attachmentResolution?.cards ?? []),
    ]),
  ];
  const card = cards.find((candidate) => candidate.id === cardId);
  return card?.kind === 'known' ? { definitionId: card.definitionId } : {};
};

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
      /** What the played card is, when the sender could read it. */
      readonly definitionId?: string;
    }
  >();
  /**
   * A card's alias can change as it enters play (Solo shows the other
   * seat's hand under the aliases it had while concealed): the card a
   * predicted stack was named for, then the stack's card in the room.
   */
  const cards = new Map<string, string>();
  // Visibility changes keep the card in its source but may rotate its alias.
  // Never match by an old definition alone or infer a reordered source index.
  const visibility = new WeakMap<
    WireGameCommand,
    {
      readonly source: VisibilityContainer;
      readonly targets: ReadonlySet<string>;
      readonly before: ReadonlySet<string>;
      readonly global?: readonly VisibilityContainer[];
    }
  >();
  const recordVisibility = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    let targetIds: readonly string[];
    let sourceId: string | undefined;
    let completeOrder = false;
    switch (command.type) {
      case 'SetPublicReveal':
      case 'BeginCardInspection':
        targetIds = [command.cardId];
        sourceId = command.expectedSourceId;
        break;
      case 'SetCardFace':
        targetIds = [command.cardId];
        break;
      case 'SetZonePublicReveal':
      case 'BeginZoneInspection':
        targetIds = command.expectedCardIds;
        sourceId = command.zoneId;
        completeOrder = true;
        break;
      default:
        return;
    }
    const all = visibilityContainers(view);
    const source = all.find(
      (container) =>
        (sourceId === undefined || container.id === sourceId) &&
        targetIds.every((id) => container.cards.some((card) => card.id === id))
    );
    if (
      !source ||
      targetIds.length === 0 ||
      (completeOrder &&
        (targetIds.length !== source.cards.length ||
          targetIds.some((id, index) => source.cards[index]?.id !== id)))
    )
      return;
    visibility.set(command, {
      source,
      targets: new Set(targetIds),
      before: new Set(
        all.flatMap((container) => container.cards.map((card) => card.id))
      ),
      ...(command.type === 'SetCardFace' ? { global: all } : {}),
    });
  };
  const settleVisibility = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    const hint = visibility.get(command);
    if (!hint) return;
    const all = visibilityContainers(view);
    const source = all.find((container) => container.key === hint.source.key);
    if (
      !source ||
      source.cards.length !== hint.source.cards.length ||
      new Set(source.cards.map((card) => card.id)).size !== source.cards.length
    )
      return;
    // SetCardFace has no source precondition: decline a relocation anywhere.
    if (
      hint.global &&
      (all.length !== hint.global.length ||
        hint.global.some((before) => {
          if (before.key === source.key) return false;
          const current = all.find((container) => container.key === before.key);
          return (
            !current ||
            current.cards.length !== before.cards.length ||
            current.cards.some(
              (card, index) => card.id !== before.cards[index]?.id
            )
          );
        }))
    )
      return;
    const matched: { readonly before: string; readonly after: string }[] = [];
    for (const [index, before] of hint.source.cards.entries()) {
      const after = source.cards[index]!;
      if (before.id === after.id) continue;
      if (
        !hint.targets.has(before.id) ||
        hint.before.has(after.id) ||
        before.ownerId !== after.ownerId
      )
        return;
      // Losing disclosure is not an opportunity to bind some known copy.
      if (after.kind !== 'known') continue;
      if (before.kind === 'known' && before.definitionId !== after.definitionId)
        return;
      if (command.type === 'SetCardFace' && after.face !== command.face) return;
      if (
        (command.type === 'SetPublicReveal' ||
          command.type === 'SetZonePublicReveal') &&
        (after.publiclyRevealed !== command.revealed ||
          after.face !==
            (command.revealed ||
            hint.source.zoneKind === 'hand' ||
            hint.source.zoneKind === 'prizes'
              ? 'up'
              : 'down'))
      )
        return;
      matched.push({ before: before.id, after: after.id });
    }
    // For a whole-zone command, expectedCardIds guards the complete native
    // order; a competing reorder makes that command fail before completion.
    for (const match of matched) remember(cards, match.before, match.after);
  };

  /**
   * Cards a sent command brings into a hand (a draw, a card taken back from
   * the discard, a Pokémon picked up, or an unindexed move within the hand,
   * which the room renames so the other player can't follow it): the hand
   * gets them under new aliases, so a move made on one before then names
   * the old. Each is matched by its definition among the hand's new cards
   * at the next send, once the command has landed; one that came face
   * down (a prize, a draw for Solo's other seat) by its place among the
   * new cards left, when as many came as were sent for.
   */
  let arrivals: {
    readonly zoneId: string;
    readonly before: ReadonlySet<string>;
    readonly cards: readonly {
      readonly alias: string;
      /** Absent for a card that came face down. */
      readonly definitionId?: string;
    }[];
    /** The command, as sent, that would bring them. */
    readonly command: WireGameCommand;
  }[] = [];
  /**
   * Cards a sent command puts on top of a deck or at its bottom: the deck
   * takes them face down under new aliases, so a move queued on one (drawn
   * back, then played) names the old. Each is matched by its place at the
   * next send; a draw's arrival then follows it on into the hand.
   */
  let deckEdges: {
    readonly zoneId: string;
    readonly edge: 'top' | 'bottom';
    readonly alias: string;
    readonly before: ReadonlySet<string>;
    readonly command: WireGameCommand;
  }[] = [];
  const recordArrivals = (command: WireGameCommand, view: MatchViewState) => {
    const predicted = predictWireCommand(view, command);
    if (!predicted) return;
    // An indexed hand arrangement preserves its alias. Treating it as an
    // arrival could later mistake a different copy for a card that left.
    if (
      command.type === 'MoveCard' &&
      command.expectedSourceZoneId === command.destinationZoneId &&
      command.destinationIndex !== undefined &&
      view.zones[command.destinationZoneId]?.kind === 'hand'
    )
      return;
    // Any command that puts its card on a deck's edge: the shortcuts, or
    // the card dragged onto the pile. Never one the room shuffles in: where
    // it lands is chance, and a card found there by its place would be
    // another card.
    const cardId =
      'cardId' in command && !isRandomizingCommand(command)
        ? command.cardId
        : undefined;
    const deck =
      cardId === undefined
        ? undefined
        : Object.values(predicted.zones).find(
            (zone) =>
              zone.kind === 'deck' &&
              zone.cards.some((card) => card.id === cardId) &&
              !view.zones[zone.id]?.cards.some((card) => card.id === cardId)
          );
    const edge =
      deck?.cards[0]?.id === cardId
        ? 'top'
        : deck?.cards.at(-1)?.id === cardId
          ? 'bottom'
          : undefined;
    if (cardId !== undefined && deck && edge) {
      deckEdges.push({
        zoneId: deck.id,
        edge,
        alias: cardId,
        before: new Set(
          (view.zones[deck.id]?.cards ?? []).map((card) => card.id)
        ),
        command,
      });
    }
    const moved = command.type === 'MoveCard' ? command.cardId : undefined;
    for (const zone of Object.values(predicted.zones)) {
      if (zone.kind !== 'hand') continue;
      const before = new Set(
        (view.zones[zone.id]?.cards ?? []).map((card) => card.id)
      );
      const cards = zone.cards.flatMap((card) =>
        !before.has(card.id) || card.id === moved
          ? [
              card.kind === 'known'
                ? { alias: card.id, definitionId: card.definitionId }
                : { alias: card.id },
            ]
          : []
      );
      if (cards.length > 0) {
        arrivals.push({ zoneId: zone.id, before, cards, command });
      }
    }
  };
  const settleArrivals = (view: MatchViewState, command?: WireGameCommand) => {
    const settles = (candidate: WireGameCommand) =>
      command === undefined || candidate === command;
    for (const entry of deckEdges) {
      if (!settles(entry.command)) continue;
      if (cardInView(entry.alias, view)) continue;
      const deck = view.zones[entry.zoneId]?.cards ?? [];
      const landed = entry.edge === 'top' ? deck[0] : deck.at(-1);
      if (landed && !entry.before.has(landed.id)) {
        remember(cards, entry.alias, landed.id);
      }
    }
    deckEdges = deckEdges.filter((entry) => !settles(entry.command));
    for (const arrival of arrivals) {
      if (!settles(arrival.command)) continue;
      const hand = view.zones[arrival.zoneId]?.cards ?? [];
      const present = new Set<string>(hand.map((card) => card.id));
      const fresh = hand.filter((card) => !arrival.before.has(card.id));
      const faceDown: string[] = [];
      const unresolved = new Map<string, string[]>();
      for (const { alias, definitionId } of arrival.cards) {
        if (present.has(alias)) continue;
        if (definitionId === undefined) {
          faceDown.push(alias);
          continue;
        }
        const group = unresolved.get(definitionId) ?? [];
        group.push(alias);
        unresolved.set(definitionId, group);
      }
      for (const [definitionId, aliases] of unresolved) {
        const matching = fresh.filter(
          (card) => card.kind === 'known' && card.definitionId === definitionId
        );
        // Even at the accepted revision, an identical copy may have arrived
        // before this command ran. Match only an exact group, in arrival order.
        if (matching.length !== aliases.length) continue;
        matching.forEach((card, index) => {
          remember(cards, aliases[index]!, card.id);
          fresh.splice(fresh.indexOf(card), 1);
        });
      }
      // Face down, a card can only be told by where it came in: taken only
      // when the new cards left are exactly as many, never guessed at.
      if (faceDown.length > 0 && faceDown.length === fresh.length) {
        faceDown.forEach((alias, index) => {
          remember(cards, alias, fresh[index]!.id);
        });
      }
    }
    arrivals = arrivals.filter((arrival) => !settles(arrival.command));
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
    if (!stackId || placement.before.has(stackId)) return undefined;
    const stack = view.stacks[stackId];
    // Nor is one of another card someone put there since (the play refused,
    // the spot filled by another): its card must be the one played.
    const card = stack?.evolutionCards[0];
    if (
      placement.definitionId !== undefined &&
      (card?.kind !== 'known' || card.definitionId !== placement.definitionId)
    ) {
      return undefined;
    }
    return stack;
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
    // Renamed more than once (unindexed hand moves, say): follow each
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

  /** The placement a sent play recorded, by the command as it was sent. */
  const placementOf = new WeakMap<WireGameCommand, string>();
  const retireArrivals = (command: WireGameCommand): void => {
    arrivals = arrivals.filter((arrival) => arrival.command !== command);
    deckEdges = deckEdges.filter((entry) => entry.command !== command);
  };

  const rebinder = (command: WireGameCommand, view: MatchViewState) => {
    settleArrivals(view);
    // A Pokémon played into a new stack: remember where, in case its card
    // comes back under another alias (as one played from the viewer does,
    // having passed through its owner's hand).
    let placed: string | undefined;
    if (
      (command.type === 'MoveCardToPlay' && !command.targetStackId) ||
      command.type === 'MoveInspectedCardToPlay'
    ) {
      placed = `${PREDICTED_STACK}${command.cardId}`;
      remember(placements, placed, {
        boardPlayerId: command.boardPlayerId,
        slot: command.slot,
        ...(command.benchIndex === undefined
          ? {}
          : { benchIndex: command.benchIndex }),
        before: new Set(Object.keys(view.stacks)),
        ...definitionOf(view, command.cardId),
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
    recordVisibility(rebound, view);
    if (placed) placementOf.set(rebound, placed);
    return rebound;
  };
  return Object.assign(rebinder, {
    accepted: (
      command: WireGameCommand,
      revision: number,
      view: MatchViewState
    ) => {
      const placed = placementOf.get(command);
      if (view.revision === revision) settleVisibility(command, view);
      visibility.delete(command);
      // At a later revision, a matching new face or stack may be someone
      // else's. Keep proven mappings, retiring only this command's hints.
      if (view.revision > revision) {
        retireArrivals(command);
        if (placed) placements.delete(placed);
      }
      // Learn at the exact frontier now, even with no follow-up queued: a
      // later idle view must never identify these arrivals by a new copy.
      else if (view.revision === revision) {
        settleArrivals(view, command);
        if (placed) {
          stackIdFor(placed, view);
          placements.delete(placed);
        }
      }
    },
    // Refused, the play made no stack: a move queued on its predicted one
    // goes as it is, for the room to refuse as stale, never rebound by
    // position to whatever stands there now.
    refused: (command: WireGameCommand) => {
      visibility.delete(command);
      // Nor did it bring anything into a hand: a new card there with the
      // same face is someone else's.
      retireArrivals(command);
      const placed = placementOf.get(command);
      if (placed === undefined) return;
      placements.delete(placed);
      stacks.delete(placed);
    },
  });
};
