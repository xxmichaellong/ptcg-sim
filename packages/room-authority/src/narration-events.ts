import {
  findCardLocation,
  isCardKnownToViewer,
  type CardInstanceId,
  type DomainEvent,
  type EventBatch,
  type MatchState,
  type PlayerId,
  type StackId,
  type ZoneId,
} from '@ptcgsim/game-core';
import type { PresentationEvent } from '@ptcgsim/protocol';

type CardSource = Extract<
  PresentationEvent,
  { readonly type: 'CardMoved' }
>['source'];

type Narration = Extract<
  PresentationEvent,
  {
    readonly type:
      | 'CardMoved'
      | 'CardsDrawn'
      | 'ZoneShuffled'
      | 'DeckCardsLooked'
      | 'CardsResolved'
      | 'HandReplaced'
      | 'CardCategoryChanged'
      | 'AbilityUsed';
  }
>;

/**
 * v1 narrates every card action in the battle log with one grammar
 * (`move-card-message.js`, `deck-actions.js`, `zones/general.js`, ...). These
 * projections reproduce that grammar from domain events so both seats and
 * spectators read the same log. Every field is safe for the least-privileged
 * spectator: a card is named only when it is publicly known either before or
 * after the event, which is v1's "hidden zone pair" rule expressed on state
 * rather than on zone names, and the actor is the card's owner (or the event's
 * player), since the ledger does not record who submitted a command.
 */
export const narrationEventsForBatch = (
  batch: EventBatch,
  state: MatchState,
  previousState: MatchState
): readonly Narration[] => {
  // A turn's draw is already told by "drew for turn"; v1 does not also print
  // "drew a card" for it.
  const turnDraw = batch.events.some(
    (event) =>
      event.type === 'TableActionDeclared' && event.action === 'startTurn'
  );
  const compound = narrateCompound(batch, state, previousState);
  if (compound) return compound;
  return batch.events.flatMap((event) =>
    turnDraw && event.type === 'CardsDrawn'
      ? []
      : narrate(event, batch.revision, state, previousState)
  );
};

/**
 * Two v1 actions are single log lines but several domain events: shuffling
 * one card into the deck (a departure to the deck, then a deck shuffle) and
 * switching a card with the deck top (two moves through the deck top). They
 * are recognised by batch shape so the log reads as v1's one line.
 */
const narrateCompound = (
  batch: EventBatch,
  state: MatchState,
  previousState: MatchState
): readonly Narration[] | null => {
  const events = batch.events;
  const isDeckZone = (zoneId: ZoneId): boolean =>
    (state.zones[zoneId] ?? previousState.zones[zoneId])?.kind === 'deck';
  if (events.length === 2) {
    const [first, second] = events;
    // "shuffled X from hand into deck"
    if (
      first?.type === 'CardMoved' &&
      second?.type === 'ZoneShuffled' &&
      first.destinationZoneId === second.zoneId &&
      isDeckZone(second.zoneId) &&
      !isDeckZone(first.expectedSourceZoneId)
    ) {
      const playerId = ownerOf(state, previousState, first.cardId);
      const source = zoneSource(
        state,
        previousState,
        first.expectedSourceZoneId
      );
      if (!playerId || !source) return null;
      return [
        moved(batch.revision, playerId, 'shuffledIntoDeck', source, {
          cardName: publicName(state, previousState, first.cardId),
        }),
      ];
    }
    // "switched X from hand with top of deck"
    if (
      first?.type === 'CardMoved' &&
      second?.type === 'CardMoved' &&
      isDeckZone(first.destinationZoneId) &&
      first.destinationIndex === 0 &&
      second.expectedSourceZoneId === first.destinationZoneId &&
      second.destinationZoneId === first.expectedSourceZoneId
    ) {
      const playerId = ownerOf(state, previousState, first.cardId);
      const source = zoneSource(
        state,
        previousState,
        first.expectedSourceZoneId
      );
      if (!playerId || !source) return null;
      return [
        moved(batch.revision, playerId, 'switchedWithDeckTop', source, {
          cardName: publicName(state, previousState, first.cardId),
        }),
      ];
    }
  }
  return null;
};

const spectator = { kind: 'spectator' } as const;

const nameIfPublic = (
  candidate: MatchState,
  cardId: CardInstanceId
): string | undefined => {
  const card = candidate.cards[cardId];
  if (!card || !isCardKnownToViewer(candidate, spectator, card)) {
    return undefined;
  }
  return candidate.definitions[card.definitionId]?.name;
};

/** The name v1 prints: the card's, if it is public before or after the event. */
const publicName = (
  state: MatchState,
  previousState: MatchState,
  cardId: CardInstanceId
): string | undefined =>
  nameIfPublic(previousState, cardId) ?? nameIfPublic(state, cardId);

const ownerOf = (
  state: MatchState,
  previousState: MatchState,
  cardId: CardInstanceId
): PlayerId | undefined =>
  (state.cards[cardId] ?? previousState.cards[cardId])?.ownerId;

const zoneSource = (
  state: MatchState,
  previousState: MatchState,
  zoneId: ZoneId
): CardSource | undefined =>
  (state.zones[zoneId] ?? previousState.zones[zoneId])?.kind;

const stackSource = (
  state: MatchState,
  previousState: MatchState,
  stackId: StackId
): CardSource | undefined =>
  (state.stacks[stackId] ?? previousState.stacks[stackId])?.slot;

/** Where a card sat before the event, in presentation terms. */
const locationSource = (
  previousState: MatchState,
  cardId: CardInstanceId
): CardSource | undefined => {
  const location = findCardLocation(previousState, cardId);
  if (!location) return undefined;
  switch (location.kind) {
    case 'zone':
      return previousState.zones[location.zoneId]?.kind;
    case 'stackEvolution':
    case 'stackAttachment':
      return previousState.stacks[location.stackId]?.slot;
    case 'inspectionWorkArea':
      return 'inspection';
    case 'attachmentResolutionWorkArea':
      return 'attachmentResolution';
  }
};

/** Any source id a domain event may carry: a zone, a stack, or a work area. */
const anySource = (
  state: MatchState,
  previousState: MatchState,
  sourceId: string
): CardSource | undefined => {
  const zone = zoneSource(state, previousState, sourceId as ZoneId);
  if (zone) return zone;
  const stack = stackSource(state, previousState, sourceId as StackId);
  if (stack) return stack;
  for (const candidate of [previousState, state]) {
    for (const areas of Object.values(candidate.workAreas)) {
      if (areas.inspection?.id === sourceId) return 'inspection';
      if (areas.attachmentResolution?.id === sourceId) {
        return 'attachmentResolution';
      }
    }
  }
  return undefined;
};

/** The Pokémon a card was attached to or evolved from: the stack's top card. */
const stackTopName = (
  state: MatchState,
  previousState: MatchState,
  stackId: StackId,
  excluding: CardInstanceId
): string | undefined => {
  const stack = state.stacks[stackId] ?? previousState.stacks[stackId];
  if (!stack) return undefined;
  const top = [...stack.evolutionCardIds]
    .reverse()
    .find((cardId) => cardId !== excluding);
  return top ? publicName(state, previousState, top) : undefined;
};

type MoveVerb = Extract<Narration, { readonly type: 'CardMoved' }>['verb'];

const moved = (
  revision: number,
  playerId: PlayerId,
  verb: MoveVerb,
  source: CardSource,
  fields: {
    readonly destination?: CardSource;
    readonly cardName?: string;
    readonly targetCardName?: string;
  }
): Narration =>
  ({
    type: 'CardMoved',
    revision,
    playerId,
    verb,
    source,
    ...(fields.destination ? { destination: fields.destination } : {}),
    ...(fields.cardName ? { cardName: fields.cardName } : {}),
    ...(fields.targetCardName ? { targetCardName: fields.targetCardName } : {}),
  }) satisfies Narration;

const narrate = (
  event: DomainEvent,
  revision: number,
  state: MatchState,
  previousState: MatchState
): readonly Narration[] => {
  switch (event.type) {
    case 'CardMoved': {
      const playerId = ownerOf(state, previousState, event.cardId);
      const source = zoneSource(
        state,
        previousState,
        event.expectedSourceZoneId
      );
      const destination = zoneSource(
        state,
        previousState,
        event.destinationZoneId
      );
      if (!playerId || !source || !destination) return [];
      return [
        moved(revision, playerId, 'moved', source, {
          destination,
          cardName: publicName(state, previousState, event.cardId),
        }),
      ];
    }
    case 'CardMovedToPlay': {
      const playerId = ownerOf(state, previousState, event.cardId);
      const source = zoneSource(
        state,
        previousState,
        event.expectedSourceZoneId
      );
      if (!playerId || !source) return [];
      const cardName = publicName(state, previousState, event.cardId);
      if (event.mode === 'newStack') {
        return [
          moved(revision, playerId, 'moved', source, {
            destination: event.slot,
            cardName,
          }),
        ];
      }
      const targetCardName = stackTopName(
        state,
        previousState,
        event.stackId,
        event.cardId
      );
      return [
        moved(
          revision,
          playerId,
          event.mode === 'evolution' ? 'evolved' : 'attached',
          source,
          { destination: event.slot, cardName, targetCardName }
        ),
      ];
    }
    case 'CardAttachedToPlayStack': {
      const playerId = ownerOf(state, previousState, event.cardId);
      const source = zoneSource(
        state,
        previousState,
        event.expectedSourceZoneId
      );
      const destination = stackSource(state, previousState, event.stackId);
      if (!playerId || !source) return [];
      return [
        moved(revision, playerId, 'attached', source, {
          ...(destination ? { destination } : {}),
          cardName: publicName(state, previousState, event.cardId),
          targetCardName: stackTopName(
            state,
            previousState,
            event.stackId,
            event.cardId
          ),
        }),
      ];
    }
    case 'CardPlacedOnPlayStack': {
      const source = anySource(state, previousState, event.expectedSourceId);
      const destination = stackSource(
        state,
        previousState,
        event.targetStackId
      );
      if (!source) return [];
      return [
        moved(
          revision,
          event.playerId,
          event.mode === 'evolution' ? 'evolved' : 'attached',
          source,
          {
            ...(destination ? { destination } : {}),
            cardName: publicName(state, previousState, event.cardId),
            targetCardName: stackTopName(
              state,
              previousState,
              event.targetStackId,
              event.cardId
            ),
          }
        ),
      ];
    }
    case 'CardMovedFromStack':
    case 'PlayStackDeparted': {
      const playerId = ownerOf(state, previousState, event.cardId);
      const source = stackSource(state, previousState, event.expectedStackId);
      const destination = zoneSource(
        state,
        previousState,
        event.destinationZoneId
      );
      if (!playerId || !source || !destination) return [];
      return [
        moved(revision, playerId, 'moved', source, {
          destination,
          cardName: publicName(state, previousState, event.cardId),
        }),
      ];
    }
    case 'InspectedCardMoved':
    case 'StagedCardMoved': {
      const destination = zoneSource(
        state,
        previousState,
        event.destinationZoneId
      );
      if (!destination) return [];
      return [
        moved(
          revision,
          event.playerId,
          'moved',
          event.type === 'InspectedCardMoved'
            ? 'inspection'
            : 'attachmentResolution',
          {
            destination,
            cardName: publicName(state, previousState, event.cardId),
          }
        ),
      ];
    }
    case 'InspectionCardSwappedWithDeckTop':
    case 'StagedCardSwappedWithDeckTop':
      return [
        moved(
          revision,
          event.playerId,
          'switchedWithDeckTop',
          event.type === 'InspectionCardSwappedWithDeckTop'
            ? 'inspection'
            : 'attachmentResolution',
          { cardName: publicName(state, previousState, event.cardId) }
        ),
      ];
    case 'CardsDrawn':
      return event.cardIds.length === 0
        ? []
        : [
            {
              type: 'CardsDrawn',
              revision,
              playerId: event.playerId,
              cardCount: event.cardIds.length,
            },
          ];
    case 'ZoneShuffled': {
      const zone =
        state.zones[event.zoneId] ?? previousState.zones[event.zoneId];
      if (!zone?.ownerId) return [];
      return [
        {
          type: 'ZoneShuffled',
          revision,
          playerId: zone.ownerId,
          source: zone.kind,
        },
      ];
    }
    case 'InspectionOpened':
    case 'InspectionExtended': {
      const deck = previousState.zones[event.sourceZoneId];
      const count = event.cardIds.length;
      if (!deck || deck.kind !== 'deck' || count === 0) return [];
      // The event does not say which end was taken; the previous deck order
      // does.
      const fromTop = event.cardIds.every(
        (cardId, index) => deck.cardIds[index] === cardId
      );
      return [
        {
          type: 'DeckCardsLooked',
          revision,
          playerId: event.playerId,
          cardCount: count,
          edge: fromTop ? 'top' : 'bottom',
        },
      ];
    }
    case 'LooseBoardCardsResolved': {
      const count = event.expectedBoardCardIds.length;
      if (count === 0) return [];
      return [
        {
          type: 'CardsResolved',
          revision,
          playerId: event.playerId,
          verb: event.destination === 'shuffleIntoDeck' ? 'shuffled' : 'moved',
          cardCount: count,
          source: 'board',
          destination:
            event.destination === 'shuffleIntoDeck'
              ? 'deck'
              : event.destination,
        },
      ];
    }
    case 'StagedCardsResolved':
    case 'InspectionCardsResolved': {
      const count =
        event.type === 'StagedCardsResolved'
          ? event.expectedEvolutionCardIds.length +
            event.expectedAttachmentCardIds.length
          : event.expectedCardIds.length;
      if (count === 0) return [];
      const source: CardSource =
        event.type === 'StagedCardsResolved'
          ? 'attachmentResolution'
          : 'inspection';
      const destination =
        event.destination === 'shuffleIntoDeck'
          ? 'deck'
          : event.destination === 'shuffleToDeckBottom'
            ? 'deckBottom'
            : event.destination;
      return [
        {
          type: 'CardsResolved',
          revision,
          playerId: event.playerId,
          verb:
            event.destination === 'shuffleIntoDeck' ||
            event.destination === 'shuffleToDeckBottom'
              ? 'shuffled'
              : event.destination === 'discard'
                ? 'discarded'
                : 'moved',
          cardCount: count,
          source,
          destination,
        },
      ];
    }
    case 'StagedStackRestored':
    case 'StagedStackRestoredToPlayStack': {
      const count =
        event.expectedEvolutionCardIds.length +
        event.expectedAttachmentCardIds.length;
      if (count === 0) return [];
      return [
        {
          type: 'CardsResolved',
          revision,
          playerId: event.playerId,
          verb: 'left',
          cardCount: count,
          source: 'attachmentResolution',
          destination: 'play',
        },
      ];
    }
    case 'ZoneOrdersSet':
      return narrateZoneOrders(event, revision, state, previousState);
    case 'CardCategorySet': {
      const playerId = ownerOf(state, previousState, event.cardId);
      if (!playerId) return [];
      const cardName = publicName(state, previousState, event.cardId);
      return [
        {
          type: 'CardCategoryChanged',
          revision,
          playerId,
          category: event.category,
          ...(cardName ? { cardName } : {}),
        },
      ];
    }
    case 'CardAbilitySet': {
      if (!event.used) return [];
      const playerId = ownerOf(state, previousState, event.cardId);
      const source = locationSource(previousState, event.cardId);
      if (!playerId || !source) return [];
      const cardName = publicName(state, previousState, event.cardId);
      return [
        {
          type: 'AbilityUsed',
          revision,
          playerId,
          source,
          ...(cardName ? { cardName } : {}),
        },
      ];
    }
    case 'StackAbilitySet': {
      if (!event.used) return [];
      const stack =
        state.stacks[event.stackId] ?? previousState.stacks[event.stackId];
      const top = stack?.evolutionCardIds.at(-1);
      if (!stack || !top) return [];
      const cardName = publicName(state, previousState, top);
      return [
        {
          type: 'AbilityUsed',
          revision,
          playerId: stack.boardPlayerId,
          source: stack.slot,
          ...(cardName ? { cardName } : {}),
        },
      ];
    }
    default:
      return [];
  }
};

const narrateZoneOrders = (
  event: Extract<DomainEvent, { readonly type: 'ZoneOrdersSet' }>,
  revision: number,
  state: MatchState,
  previousState: MatchState
): readonly Narration[] => {
  const zones = event.zones.map((entry) => ({
    ...entry,
    zone: state.zones[entry.zoneId] ?? previousState.zones[entry.zoneId],
  }));
  const first = zones[0];
  const playerId = first?.zone?.ownerId;
  if (!first?.zone || !playerId) return [];
  switch (event.reason) {
    case 'move-card-to-deck-top':
    case 'move-card-to-deck-bottom': {
      // Reordering within the deck: the moved card is the one whose position
      // changed to the named end.
      const cardId =
        event.reason === 'move-card-to-deck-top'
          ? first.cardIds[0]
          : first.cardIds.at(-1);
      if (!cardId) return [];
      return [
        moved(
          revision,
          playerId,
          event.reason === 'move-card-to-deck-top'
            ? 'movedToDeckTop'
            : 'movedToDeckBottom',
          'deck',
          { cardName: publicName(state, previousState, cardId) }
        ),
      ];
    }
    case 'move-prizes-to-deck-bottom': {
      const count = first.expectedCardIds.length - first.cardIds.length;
      return count <= 0
        ? []
        : [
            {
              type: 'CardsResolved',
              revision,
              playerId,
              verb: 'shuffled',
              cardCount: count,
              source: 'prizes',
              destination: 'deckBottom',
            },
          ];
    }
    case 'move-zone-contents': {
      const destination = zones[1]?.zone;
      const count = first.expectedCardIds.length;
      if (!destination || count === 0) return [];
      if (
        destination.kind !== 'hand' &&
        destination.kind !== 'discard' &&
        destination.kind !== 'lostZone' &&
        destination.kind !== 'deck'
      ) {
        return [];
      }
      return [
        {
          type: 'CardsResolved',
          revision,
          playerId,
          verb: destination.kind === 'discard' ? 'discarded' : 'moved',
          cardCount: count,
          source: first.zone.kind,
          destination: destination.kind,
        },
      ];
    }
    case 'shuffle-zone-into-deck':
    case 'shuffle-zone-to-deck-bottom': {
      const count = first.expectedCardIds.length;
      if (count === 0) return [];
      return [
        {
          type: 'CardsResolved',
          revision,
          playerId,
          verb: 'shuffled',
          cardCount: count,
          source: first.zone.kind,
          destination:
            event.reason === 'shuffle-zone-into-deck' ? 'deck' : 'deckBottom',
        },
      ];
    }
    case 'discard-hand-and-draw':
    case 'shuffle-hand-into-deck-and-draw':
    case 'shuffle-hand-to-deck-bottom-and-draw': {
      // The hand zone is listed first; its new contents are the drawn cards.
      return [
        {
          type: 'HandReplaced',
          revision,
          playerId,
          mode:
            event.reason === 'discard-hand-and-draw'
              ? 'discard'
              : event.reason === 'shuffle-hand-into-deck-and-draw'
                ? 'shuffleIntoDeck'
                : 'shuffleToDeckBottom',
          drawCount: first.cardIds.length,
        },
      ];
    }
  }
};
