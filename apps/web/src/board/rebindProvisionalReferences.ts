import {
  MAX_DECK_CARDS,
  type MatchViewState,
  type ViewCard,
} from '@ptcgsim/game-core';
import { DEFAULT_CLIENT_SESSION_POLICY } from '@ptcgsim/client-session';
import { cardStepMakesPokemon, type WireGameCommand } from '@ptcgsim/protocol';

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
/** Full-room card generations across the standard bounded command queue. */
const REMEMBERED_CARDS =
  MAX_DECK_CARDS * 2 * DEFAULT_CLIENT_SESSION_POLICY.maximumPendingCommands;

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
    value: Value,
    limit = REMEMBERED_STACKS
  ): void => {
    memory.delete(key);
    memory.set(key, value);
    if (memory.size > limit) {
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
      /**
       * A card played in pieces in one move (a V-UNION): every piece's
       * alias, the played one first, as they lie in the Pokémon it made.
       */
      readonly pieces?: readonly string[];
      /** Restore can rotate every staged alias, including evolutions and Tools. */
      readonly restored?: {
        readonly revision: number;
        readonly evolutionCards: readonly ViewCard[];
        readonly attachmentCards: readonly ViewCard[];
      };
    }
  >();
  /**
   * A card's alias can change as it enters play (Solo shows the other
   * seat's hand under the aliases it had while concealed): the card a
   * predicted stack was named for, then the stack's card in the room.
   */
  const cards = new Map<string, string>();
  const rememberCard = (before: string, after: string): void =>
    remember(cards, before, after, REMEMBERED_CARDS);
  /** A top-card departure can rename the residual cards before restoration. */
  const staging = new WeakMap<
    WireGameCommand,
    {
      readonly revision: number;
      readonly playerId: string;
      readonly sourceStackId: string;
      readonly evolutionCards: readonly ViewCard[];
      readonly attachmentCards: readonly ViewCard[];
    }
  >();
  interface PublicArrival {
    readonly aliases: readonly string[];
    readonly sentAlias: string;
    readonly zoneId: string;
    readonly ownerId: string;
    readonly definitionId: string;
    readonly before: ReadonlySet<string>;
  }
  /** A command's cards going public; a group's, one for each of its moves. */
  const publicArrivals = new WeakMap<
    WireGameCommand,
    readonly PublicArrival[]
  >();
  /** The pairs of a move as asked for and as sent: a group's, step by step. */
  const movesOf = (
    original: WireGameCommand,
    command: WireGameCommand
  ): readonly (readonly [unknown, unknown])[] =>
    command.type === 'ApplyCardSteps' && original.type === 'ApplyCardSteps'
      ? command.steps.map((step, index) => [original.steps[index], step])
      : [[original, command]];
  const recordPublicArrival = (
    original: WireGameCommand,
    command: WireGameCommand,
    view: MatchViewState,
    predicted: MatchViewState | null
  ): void => {
    let before: ReadonlySet<string> | undefined;
    const hints = movesOf(original, command).flatMap(
      ([asked, sent]): PublicArrival[] => {
        const move = sent as WireGameCommand;
        const askedMove = asked as WireGameCommand | undefined;
        if (
          askedMove?.type !== 'MoveCard' ||
          move.type !== 'MoveCard' ||
          move.expectedSourceZoneId === move.destinationZoneId
        )
          return [];
        const zone = predicted?.zones[move.destinationZoneId];
        if (
          !zone ||
          (zone.kind !== 'board' &&
            zone.kind !== 'discard' &&
            zone.kind !== 'lostZone')
        )
          return [];
        const card = zone.cards.find(
          (candidate) => candidate.id === move.cardId
        );
        if (card?.kind !== 'known') return [];
        before ??= new Set(
          visibilityContainers(view).flatMap((container) =>
            container.cards.map((candidate) => candidate.id)
          )
        );
        return [
          {
            aliases: [...new Set([askedMove.cardId, move.cardId])],
            sentAlias: move.cardId,
            zoneId: zone.id,
            ownerId: card.ownerId,
            definitionId: card.definitionId,
            before,
          },
        ];
      }
    );
    if (hints.length > 0) publicArrivals.set(command, hints);
  };
  const settlePublicArrival = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    // Copies of one printing that went to one place together (a group's
    // two Energy discarded) are matched together, in the order they went,
    // as the hand's arrivals are: only when exactly as many came.
    const together = new Map<string, PublicArrival[]>();
    for (const hint of publicArrivals.get(command) ?? []) {
      const zone = view.zones[hint.zoneId];
      // Own-seat cards usually retain their alias. A different fresh copy
      // in the destination must never replace an unchanged, still-present
      // target.
      if (!zone || zone.cards.some((card) => card.id === hint.sentAlias))
        continue;
      const key = `${hint.zoneId}\u0000${hint.ownerId}\u0000${hint.definitionId}`;
      together.set(key, [...(together.get(key) ?? []), hint]);
    }
    for (const hints of together.values()) {
      const first = hints[0]!;
      const kept = new Set(
        (publicArrivals.get(command) ?? []).map((hint) => hint.sentAlias)
      );
      const candidates = view.zones[first.zoneId]!.cards.filter(
        (card) =>
          card.kind === 'known' &&
          card.ownerId === first.ownerId &&
          card.definitionId === first.definitionId &&
          !first.before.has(card.id) &&
          !kept.has(card.id)
      );
      if (candidates.length !== hints.length) continue;
      hints.forEach((hint, index) => {
        const arrived = candidates[index]!.id;
        for (const alias of hint.aliases)
          if (alias !== arrived) rememberCard(alias, arrived);
      });
    }
  };
  // Visibility changes keep the card in its source but may rotate its alias.
  // Never match by an old definition alone or infer a reordered source index.
  interface VisibilityHint {
    readonly source: VisibilityContainer;
    readonly targets: ReadonlySet<string>;
    readonly before: ReadonlySet<string>;
    readonly global?: readonly VisibilityContainer[];
    /** What the room must show for the match to hold. */
    readonly shows?:
      { readonly revealed: boolean } | { readonly face: 'up' | 'down' };
  }
  /** A command's hints; a group's reveal, one for each place it reveals in. */
  const visibility = new WeakMap<WireGameCommand, readonly VisibilityHint[]>();
  const visibilityHint = (
    view: MatchViewState,
    targetIds: readonly string[],
    sourceId: string | undefined,
    completeOrder: boolean,
    extra: Pick<VisibilityHint, 'shows'> & { readonly anywhere?: boolean }
  ): VisibilityHint | undefined => {
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
      return undefined;
    return {
      source,
      targets: new Set(targetIds),
      before: new Set(
        all.flatMap((container) => container.cards.map((card) => card.id))
      ),
      ...(extra.anywhere ? { global: all } : {}),
      ...(extra.shows ? { shows: extra.shows } : {}),
    };
  };
  const recordVisibility = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    let hints: readonly (VisibilityHint | undefined)[];
    switch (command.type) {
      case 'SetPublicReveal':
        hints = [
          visibilityHint(
            view,
            [command.cardId],
            command.expectedSourceId,
            false,
            {
              shows: { revealed: command.revealed },
            }
          ),
        ];
        break;
      case 'BeginCardInspection':
        hints = [
          visibilityHint(
            view,
            [command.cardId],
            command.expectedSourceId,
            false,
            {}
          ),
        ];
        break;
      case 'SetCardFace':
        hints = [
          visibilityHint(view, [command.cardId], undefined, false, {
            shows: { face: command.face },
            anywhere: true,
          }),
        ];
        break;
      case 'SetZonePublicReveal':
        hints = [
          visibilityHint(view, command.expectedCardIds, command.zoneId, true, {
            shows: { revealed: command.revealed },
          }),
        ];
        break;
      case 'BeginZoneInspection':
        hints = [
          visibilityHint(
            view,
            command.expectedCardIds,
            command.zoneId,
            true,
            {}
          ),
        ];
        break;
      case 'ApplyCardSteps': {
        // A group's reveal or hide (ADR-042 §3): one hint for each place its
        // cards lie in, as one card's would be -- only when every step is
        // one, as a move among them would change the places they are
        // matched in.
        const places = new Map<
          string,
          { readonly cardIds: string[]; readonly revealed: boolean }
        >();
        for (const step of command.steps) {
          if (step.type !== 'SetPublicReveal') return;
          const place = places.get(step.expectedSourceId);
          if (place && place.revealed !== step.revealed) return;
          if (place) place.cardIds.push(step.cardId);
          else
            places.set(step.expectedSourceId, {
              cardIds: [step.cardId],
              revealed: step.revealed,
            });
        }
        hints = [...places].map(([sourceId, place]) =>
          visibilityHint(view, place.cardIds, sourceId, false, {
            shows: { revealed: place.revealed },
          })
        );
        break;
      }
      default:
        return;
    }
    const recorded = hints.filter(
      (hint): hint is VisibilityHint => hint !== undefined
    );
    if (recorded.length > 0) visibility.set(command, recorded);
  };
  const settleVisibilityHint = (
    hint: VisibilityHint,
    view: MatchViewState
  ): void => {
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
      const shows = hint.shows;
      if (shows && 'face' in shows && after.face !== shows.face) return;
      if (
        shows &&
        'revealed' in shows &&
        (after.publiclyRevealed !== shows.revealed ||
          after.face !==
            (shows.revealed ||
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
    for (const match of matched) rememberCard(match.before, match.after);
  };
  const settleVisibility = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    for (const hint of visibility.get(command) ?? [])
      settleVisibilityHint(hint, view);
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
    /**
     * The cards it put there, from the edge inward: a group's several, the
     * ones under the top card too, each found by its place among them.
     */
    readonly aliases: readonly string[];
    readonly before: ReadonlySet<string>;
    readonly command: WireGameCommand;
  }[] = [];
  const recordArrivals = (
    command: WireGameCommand,
    view: MatchViewState,
    predicted: MatchViewState | null
  ) => {
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
    // A group's cards each, as each would go alone; the one of them left on
    // an edge is found there.
    const cardIds = isRandomizingCommand(command)
      ? []
      : command.type === 'ApplyCardSteps'
        ? command.steps.flatMap((step) =>
            'cardId' in step ? [step.cardId] : []
          )
        : 'cardId' in command
          ? [command.cardId]
          : [];
    const inserted = new Set(cardIds);
    for (const deck of Object.values(predicted.zones)) {
      if (deck.kind !== 'deck' || inserted.size === 0) continue;
      const before = new Set(
        (view.zones[deck.id]?.cards ?? []).map((card) => card.id)
      );
      let top = 0;
      for (const edge of ['top', 'bottom'] as const) {
        const cards = edge === 'top' ? deck.cards : [...deck.cards].reverse();
        const aliases: string[] = [];
        for (const card of cards) {
          if (!inserted.has(card.id) || before.has(card.id)) break;
          aliases.push(card.id);
        }
        // Into an empty deck: the cards from its top are all there are.
        if (edge === 'bottom' && top === deck.cards.length) continue;
        if (edge === 'top') top = aliases.length;
        if (aliases.length > 0)
          deckEdges.push({ zoneId: deck.id, edge, aliases, before, command });
      }
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
      const deck = view.zones[entry.zoneId]?.cards ?? [];
      const cards = entry.edge === 'top' ? deck : [...deck].reverse();
      // Only as many new cards at that edge as it put there: a card some
      // other move put beside them would shift every place.
      let fresh = 0;
      while (fresh < cards.length && !entry.before.has(cards[fresh]!.id))
        fresh += 1;
      if (fresh !== entry.aliases.length) continue;
      entry.aliases.forEach((alias, index) => {
        if (!cardInView(alias, view)) rememberCard(alias, cards[index]!.id);
      });
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
          rememberCard(aliases[index]!, card.id);
          fresh.splice(fresh.indexOf(card), 1);
        });
      }
      // Face down, a card can only be told by where it came in: taken only
      // when the new cards left are exactly as many, never guessed at.
      if (faceDown.length > 0 && faceDown.length === fresh.length) {
        faceDown.forEach((alias, index) => {
          rememberCard(alias, fresh[index]!.id);
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

  const stackIdFor = (
    id: string,
    view: MatchViewState,
    refresh = false
  ): string => {
    if (!id.startsWith(PREDICTED_STACK)) return id;
    const cardId = id.slice(PREDICTED_STACK.length);
    // A restoration sent after staging was acknowledged uses the staged
    // base's alias; an already queued action still names its earlier alias.
    // Follow only learned card links to a learned stack, never a later place
    // where that card happens to appear. Prefer the newest proven link.
    let alias = cardId;
    let remembered = stacks.get(id);
    for (let step = 0; step < REMEMBERED_CARDS; step += 1) {
      remembered = stacks.get(`${PREDICTED_STACK}${alias}`) ?? remembered;
      if (!cards.has(alias) || cardInView(alias, view)) break;
      alias = cards.get(alias)!;
    }
    if (remembered && !refresh) {
      remember(stacks, id, remembered);
      return remembered;
    }
    const found = Object.values(view.stacks).find((stack) =>
      stack.evolutionCards.some((card) => card.id === cardId)
    )?.id;
    if (found) {
      remember(stacks, id, found);
      return found;
    }
    // Not under its old alias: the stack where it was played, if that is
    // still the stack it made, of the one card (or the pieces) it played.
    const placed = placedStack(id, view);
    const placement = placements.get(id);
    const pieces = placement?.pieces ?? [cardId];
    if (
      placed &&
      !placement?.restored &&
      placed.evolutionCards.length === pieces.length
    ) {
      remember(stacks, id, placed.id);
      pieces.forEach((alias, index) =>
        rememberCard(alias, placed.evolutionCards[index]!.id)
      );
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
      step < REMEMBERED_CARDS && cards.has(card) && !cardInView(card, view);
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
  const placementOf = new WeakMap<WireGameCommand, readonly string[]>();
  const retireArrivals = (command: WireGameCommand): void => {
    arrivals = arrivals.filter((arrival) => arrival.command !== command);
    deckEdges = deckEdges.filter((entry) => entry.command !== command);
  };

  const settleRestoredStack = (id: string, view: MatchViewState): void => {
    const restored = placements.get(id)?.restored;
    // Restore guards the window ID, not its card arrays. With an intervening
    // revision a same-definition staged replacement cannot be distinguished.
    if (!restored || view.revision !== restored.revision + 1) return;
    const stack = placedStack(id, view);
    if (!stack) return;
    const matches: { readonly before: ViewCard; readonly after: ViewCard }[] =
      [];
    for (const role of ['evolutionCards', 'attachmentCards'] as const) {
      if (restored[role].length !== stack[role].length) return;
      for (const [index, before] of restored[role].entries()) {
        const after = stack[role][index]!;
        if (
          after.kind !== 'known' ||
          before.ownerId !== after.ownerId ||
          (before.kind === 'known' &&
            before.definitionId !== after.definitionId)
        )
          return;
        matches.push({ before, after });
      }
    }
    remember(stacks, id, stack.id);
    for (const { before, after } of matches) {
      if (before.id !== after.id) rememberCard(before.id, after.id);
    }
  };

  const settleStaging = (
    command: WireGameCommand,
    view: MatchViewState
  ): void => {
    const hint = staging.get(command);
    if (!hint || view.revision !== hint.revision + 1) return;
    const area = view.workAreas[hint.playerId]?.attachmentResolution;
    if (!area || area.sourceStackId !== hint.sourceStackId) return;
    const matched: { readonly before: ViewCard; readonly after: ViewCard }[] =
      [];
    for (const role of ['evolutionCards', 'attachmentCards'] as const) {
      if (hint[role].length !== area[role].length) return;
      for (const [index, before] of hint[role].entries()) {
        const after = area[role][index]!;
        if (
          after.kind !== 'known' ||
          before.ownerId !== after.ownerId ||
          (before.kind === 'known' &&
            before.definitionId !== after.definitionId)
        )
          return;
        matched.push({ before, after });
      }
    }
    for (const { before, after } of matched) {
      if (before.id !== after.id) rememberCard(before.id, after.id);
    }
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
    const placedKeys = placed ? [placed] : [];
    if (
      placed &&
      ((rebound.type === 'MoveCardToPlay' && !rebound.targetStackId) ||
        rebound.type === 'MoveInspectedCardToPlay')
    ) {
      // Prediction rebases on the actual sent command. Actions made before
      // and after this send can therefore name different provisional keys.
      const sentKey = `${PREDICTED_STACK}${rebound.cardId}`;
      if (sentKey !== placed) {
        remember(placements, sentKey, {
          ...placements.get(placed)!,
          ...definitionOf(view, rebound.cardId),
        });
        placedKeys.push(sentKey);
      }
    }
    const predicted = predictWireCommand(view, rebound);
    if (predicted) {
      for (const [playerId, areas] of Object.entries(predicted.workAreas)) {
        const area = areas.attachmentResolution;
        if (
          area?.id.startsWith(PREDICTED_WORK_AREA) &&
          view.stacks[area.sourceStackId]
        ) {
          staging.set(rebound, {
            revision: view.revision,
            playerId,
            sourceStackId: area.sourceStackId,
            evolutionCards: area.evolutionCards,
            attachmentCards: area.attachmentCards,
          });
        }
      }
    }
    // A group's move can make several Pokémon (a V-UNION from its pieces,
    // two Basics benched at once): each is remembered where the prediction
    // put it, so a move queued behind the group finds the one the room made.
    if (rebound.type === 'ApplyCardSteps' && predicted) {
      for (const [index, step] of rebound.steps.entries()) {
        if (!cardStepMakesPokemon(step)) continue;
        const key = `${PREDICTED_STACK}${step.cardId}`;
        const stack = predicted.stacks[key];
        const board = stack && predicted.boards[stack.boardPlayerId];
        if (!stack || !board) continue;
        // The later pieces the group put on it, in order.
        const pieces = rebound.steps.flatMap((later) =>
          later.type === 'PlaceCardOnPlayStack' &&
          later.mode === 'evolution' &&
          later.targetStackRef === index
            ? [later.cardId]
            : []
        );
        remember(placements, key, {
          boardPlayerId: stack.boardPlayerId,
          slot: stack.slot,
          ...(stack.slot === 'bench'
            ? { benchIndex: board.benchStackIds.indexOf(key) }
            : {}),
          before: new Set(Object.keys(view.stacks)),
          ...definitionOf(view, step.cardId),
          ...(pieces.length > 0 ? { pieces: [step.cardId, ...pieces] } : {}),
        });
        placedKeys.push(key);
      }
    }
    if (rebound.type === 'RestoreStagedStack') {
      // Use the predictor's actual base key and normalized role order. This
      // also handles a restore onto the other board or a clamped Bench index.
      const stack =
        predicted &&
        Object.values(predicted.stacks).find(
          (candidate) =>
            candidate.id.startsWith(PREDICTED_STACK) &&
            !view.stacks[candidate.id]
        );
      if (stack) {
        placed = stack.id;
        placedKeys.push(placed);
        const board = predicted!.boards[stack.boardPlayerId]!;
        remember(placements, placed, {
          boardPlayerId: stack.boardPlayerId,
          slot: stack.slot,
          ...(stack.slot === 'bench'
            ? { benchIndex: board.benchStackIds.indexOf(stack.id) }
            : {}),
          before: new Set(Object.keys(view.stacks)),
          restored: {
            revision: view.revision,
            evolutionCards: stack.evolutionCards,
            attachmentCards: stack.attachmentCards,
          },
        });
      }
    }
    recordArrivals(rebound, view, predicted);
    recordPublicArrival(command, rebound, view, predicted);
    recordVisibility(rebound, view);
    if (placedKeys.length > 0) placementOf.set(rebound, placedKeys);
    return rebound;
  };
  return Object.assign(rebinder, {
    accepted: (
      command: WireGameCommand,
      revision: number,
      view: MatchViewState
    ) => {
      const placedKeys = placementOf.get(command) ?? [];
      if (view.revision === revision) {
        settlePublicArrival(command, view);
        settleVisibility(command, view);
        settleStaging(command, view);
      }
      visibility.delete(command);
      staging.delete(command);
      publicArrivals.delete(command);
      // At a later revision, a matching new face or stack may be someone
      // else's. Keep proven mappings, retiring only this command's hints.
      if (view.revision > revision) {
        retireArrivals(command);
        for (const placed of placedKeys) placements.delete(placed);
      }
      // Learn at the exact frontier now, even with no follow-up queued: a
      // later idle view must never identify these arrivals by a new copy.
      else if (view.revision === revision) {
        settleArrivals(view, command);
        for (const placed of placedKeys) {
          if (placements.get(placed)?.restored)
            settleRestoredStack(placed, view);
          // A deliberate later play can reuse a public card alias/key. Its
          // exact completion proves a new placement, replacing the old one.
          else stackIdFor(placed, view, true);
          placements.delete(placed);
        }
      }
    },
    // Refused, the play made no stack: a move queued on its predicted one
    // goes as it is, for the room to refuse as stale, never rebound by
    // position to whatever stands there now.
    refused: (command: WireGameCommand) => {
      publicArrivals.delete(command);
      visibility.delete(command);
      staging.delete(command);
      // Nor did it bring anything into a hand: a new card there with the
      // same face is someone else's.
      retireArrivals(command);
      for (const placed of placementOf.get(command) ?? []) {
        placements.delete(placed);
        stacks.delete(placed);
      }
    },
  });
};
