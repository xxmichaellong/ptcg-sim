import { playerZoneId } from './create-match.js';
import type { DomainEvent, EventBatch } from './events.js';
import type { CardInstanceId, PlayerId, StackId } from './ids.js';
import {
  analyzePlayerReset,
  resetReturnCapacityIsValid,
} from './lifecycle-reset.js';
import { findCardLocation } from './location.js';
import type { CardInstance, CardZone, MatchState, PlayStack } from './model.js';
import {
  cardSourceSnapshot,
  publicVisibilityFace,
} from './public-visibility.js';

const incrementVisibility = (card: CardInstance): CardInstance => ({
  ...card,
  visibilityGeneration: card.visibilityGeneration + 1,
});

const sameCardOrder = <Value>(
  left: readonly Value[],
  right: readonly Value[]
): boolean =>
  left.length === right.length &&
  left.every((cardId, index) => cardId === right[index]);

const sameDefinition = (
  left: MatchState['definitions'][string],
  right: MatchState['definitions'][string]
): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.category === right.category &&
  left.imageUrl === right.imageUrl &&
  left.imageUrlSmall === right.imageUrlSmall;

const removeStackFromBoards = (
  state: MatchState,
  removedStackIds: ReadonlySet<StackId>
): MatchState['boards'] =>
  Object.fromEntries(
    Object.entries(state.boards).map(([playerId, board]) => [
      playerId,
      {
        activeStackId:
          board.activeStackId && removedStackIds.has(board.activeStackId)
            ? null
            : board.activeStackId,
        benchStackIds: board.benchStackIds.filter(
          (stackId) => !removedStackIds.has(stackId)
        ),
      },
    ])
  );

const removeCardsFromAllLocations = (
  state: MatchState,
  cardIds: ReadonlySet<CardInstanceId>
): MatchState => {
  const zones: Record<string, CardZone> = Object.fromEntries(
    Object.entries(state.zones).map(([zoneId, zone]) => [
      zoneId,
      {
        ...zone,
        cardIds: zone.cardIds.filter((cardId) => !cardIds.has(cardId)),
      },
    ])
  );

  const stacks: Record<string, PlayStack> = {};
  const removedStackIds = new Set<StackId>();
  const orphanedCardIds: CardInstanceId[] = [];
  for (const stack of Object.values(state.stacks)) {
    const evolutionCardIds = stack.evolutionCardIds.filter(
      (cardId) => !cardIds.has(cardId)
    );
    const attachmentCardIds = stack.attachmentCardIds.filter(
      (cardId) => !cardIds.has(cardId)
    );
    if (evolutionCardIds.length === 0) {
      removedStackIds.add(stack.id);
      orphanedCardIds.push(...attachmentCardIds);
      continue;
    }
    stacks[stack.id] = {
      ...stack,
      evolutionCardIds,
      attachmentCardIds,
    };
  }

  for (const cardId of orphanedCardIds) {
    const card = state.cards[cardId];
    if (!card) continue;
    const discardId = playerZoneId(card.ownerId, 'discard');
    const discard = zones[discardId];
    if (!discard) {
      throw new Error(`Missing discard zone for orphaned card ${cardId}`);
    }
    zones[discardId] = {
      ...discard,
      cardIds: [...discard.cardIds, cardId],
    };
  }

  const workAreas = Object.fromEntries(
    Object.entries(state.workAreas).map(([playerId, areas]) => {
      const stagedEvolutionCardIds =
        areas.attachmentResolution?.evolutionCardIds.filter(
          (cardId) => !cardIds.has(cardId)
        ) ?? [];
      const stagedAttachmentCardIds =
        areas.attachmentResolution?.attachmentCardIds.filter(
          (cardId) => !cardIds.has(cardId)
        ) ?? [];
      return [
        playerId,
        {
          inspection: areas.inspection
            ? {
                ...areas.inspection,
                cardIds: areas.inspection.cardIds.filter(
                  (cardId) => !cardIds.has(cardId)
                ),
              }
            : null,
          attachmentResolution:
            areas.attachmentResolution &&
            (stagedEvolutionCardIds.length > 0 ||
              stagedAttachmentCardIds.length > 0)
              ? {
                  ...areas.attachmentResolution,
                  evolutionCardIds: stagedEvolutionCardIds,
                  attachmentCardIds: stagedAttachmentCardIds,
                }
              : null,
        },
      ];
    })
  ) as MatchState['workAreas'];

  const publicCardIds = state.visibility.publicCardIds.filter(
    (cardId) => !cardIds.has(cardId)
  );
  const inspectionGrants = Object.fromEntries(
    Object.entries(state.visibility.inspectionGrants)
      .map(([inspectionId, grant]) => [
        inspectionId,
        {
          ...grant,
          cardIds: grant.cardIds.filter((cardId) => !cardIds.has(cardId)),
        },
      ])
      .filter(([, grant]) =>
        Boolean(
          (grant as { cardIds: readonly CardInstanceId[] }).cardIds.length
        )
      )
  ) as MatchState['visibility']['inspectionGrants'];

  return {
    ...state,
    zones,
    stacks,
    boards: removeStackFromBoards(state, removedStackIds),
    workAreas,
    visibility: { publicCardIds, inspectionGrants },
  };
};

const resetPlayerCards = (
  state: MatchState,
  playerId: PlayerId,
  incrementOwnedVisibility: boolean
): MatchState => {
  const analysis = analyzePlayerReset(state, playerId);
  if (!resetReturnCapacityIsValid(state, analysis)) {
    throw new Error('Reset cannot safely return displaced cards');
  }
  const removed = removeCardsFromAllLocations(state, analysis.removedCardIds);
  const zones = { ...removed.zones };
  for (const cardId of analysis.foreignSurfaceCardIds) {
    const card = state.cards[cardId];
    if (!card) throw new Error(`Reset references missing card ${cardId}`);
    const discardId = playerZoneId(card.ownerId, 'discard');
    const discard = zones[discardId];
    if (!discard)
      throw new Error(`Reset references missing discard ${discardId}`);
    zones[discardId] = {
      ...discard,
      cardIds: [...discard.cardIds, cardId],
    };
  }
  const returnedCardIds = new Set(analysis.returnedCardIds);
  return {
    ...removed,
    cards: Object.fromEntries(
      Object.entries(removed.cards).map(([cardId, card]) => [
        cardId,
        card.ownerId === playerId
          ? {
              ...card,
              currentCategory: card.originalCategory,
              face: 'up' as const,
              orientationQuarterTurns: 0 as const,
              abilityUsed: false,
              visibilityGeneration:
                card.visibilityGeneration + (incrementOwnedVisibility ? 1 : 0),
            }
          : returnedCardIds.has(card.id)
            ? {
                ...card,
                currentCategory: card.originalCategory,
                face: 'up' as const,
                orientationQuarterTurns: 0 as const,
                abilityUsed: false,
              }
            : card,
      ])
    ),
    zones,
    players: {
      ...removed.players,
      [playerId]: {
        ...removed.players[playerId]!,
        oncePerGame: { gxUsed: false, vstarUsed: false },
      },
    },
    workAreas: {
      ...removed.workAreas,
      [playerId]: { inspection: null, attachmentResolution: null },
    },
    turn: { number: 0, currentPlayerId: null },
  };
};

const requireZone = (state: MatchState, zoneId: string) => {
  const zone = state.zones[zoneId];
  if (!zone) throw new Error(`Event references missing zone ${zoneId}`);
  return zone;
};

const requireStack = (state: MatchState, stackId: string) => {
  const stack = state.stacks[stackId];
  if (!stack) throw new Error(`Event references missing stack ${stackId}`);
  return stack;
};

type WorkAreaCardsResolvedEvent = Extract<
  DomainEvent,
  { readonly type: 'StagedCardsResolved' | 'InspectionCardsResolved' }
>;

const applyWorkAreaCardsResolved = (
  state: MatchState,
  event: WorkAreaCardsResolvedEvent,
  workAreaCardIds: readonly CardInstanceId[]
): MatchState => {
  const expectedDestinationKind =
    event.destination === 'shuffleIntoDeck' ||
    event.destination === 'shuffleToDeckBottom'
      ? 'deck'
      : event.destination;
  const expectedDestinationZoneId = playerZoneId(
    event.playerId,
    expectedDestinationKind
  );
  if (event.destinationZoneId !== expectedDestinationZoneId) {
    throw new Error('Work-area resolution has an invalid destination');
  }
  const destination = requireZone(state, event.destinationZoneId);
  if (
    destination.cardIds.length !== event.expectedDestinationCardIds.length ||
    destination.cardIds.some(
      (cardId, index) => cardId !== event.expectedDestinationCardIds[index]
    )
  ) {
    throw new Error('Work-area destination order changed');
  }
  const before = [...destination.cardIds, ...workAreaCardIds].sort();
  const after = [...event.destinationCardIds].sort();
  if (
    event.destinationCardIds.length > 200 ||
    before.length !== after.length ||
    before.some((cardId, index) => cardId !== after[index]) ||
    new Set(event.destinationCardIds).size !== event.destinationCardIds.length
  ) {
    throw new Error('Work-area resolution changes the destination card set');
  }
  if (
    event.destination !== 'shuffleIntoDeck' &&
    event.destination !== 'shuffleToDeckBottom' &&
    (event.destinationCardIds.length !==
      destination.cardIds.length + workAreaCardIds.length ||
      [...destination.cardIds, ...workAreaCardIds].some(
        (cardId, index) => cardId !== event.destinationCardIds[index]
      ))
  ) {
    throw new Error('Work-area resolution changes append ordering');
  }
  if (
    event.destination === 'shuffleToDeckBottom' &&
    destination.cardIds.some(
      (cardId, index) => cardId !== event.destinationCardIds[index]
    )
  ) {
    throw new Error('Deck-bottom resolution changes the existing deck');
  }
  const concealed = new Set(event.concealedCardIds);
  if (
    concealed.size !== event.concealedCardIds.length ||
    event.concealedCardIds.some(
      (cardId) => !event.destinationCardIds.includes(cardId)
    )
  ) {
    throw new Error('Work-area resolution conceals an invalid card');
  }
  const expectedConcealedCardIds =
    event.destination === 'shuffleIntoDeck'
      ? [...event.destinationCardIds]
      : event.destination === 'hand' ||
          event.destination === 'shuffleToDeckBottom'
        ? [...workAreaCardIds]
        : [];
  const sortedConcealed = [...concealed].sort();
  const sortedExpectedConcealed = expectedConcealedCardIds.sort();
  if (
    sortedConcealed.length !== sortedExpectedConcealed.length ||
    sortedConcealed.some(
      (cardId, index) => cardId !== sortedExpectedConcealed[index]
    )
  ) {
    throw new Error('Work-area resolution has invalid concealment');
  }
  const workAreaCards = new Set(workAreaCardIds);
  return {
    ...state,
    cards: Object.fromEntries(
      Object.entries(state.cards).map(([cardId, card]) => {
        const normalized = workAreaCards.has(card.id)
          ? {
              ...card,
              currentCategory: card.originalCategory,
              face: 'up' as const,
              orientationQuarterTurns: 0 as const,
              abilityUsed: false,
            }
          : card;
        return [
          cardId,
          concealed.has(card.id) ? incrementVisibility(normalized) : normalized,
        ];
      })
    ),
    zones: {
      ...state.zones,
      [destination.id]: {
        ...destination,
        cardIds: [...event.destinationCardIds],
      },
    },
    visibility: {
      ...state.visibility,
      publicCardIds: state.visibility.publicCardIds.filter(
        (cardId) => !workAreaCards.has(cardId) && !concealed.has(cardId)
      ),
    },
  };
};

export const applyEvent = (
  state: MatchState,
  event: DomainEvent
): MatchState => {
  switch (event.type) {
    case 'DeckLoaded': {
      if (
        !state.players[event.playerId] ||
        event.cards.length > 200 ||
        event.deckOrder.length !== event.cards.length ||
        new Set(event.deckOrder).size !== event.deckOrder.length ||
        event.cards.some(
          (card) =>
            Boolean(state.cards[card.id]) ||
            card.ownerId !== event.playerId ||
            !event.deckOrder.includes(card.id) ||
            card.face !== 'up' ||
            card.orientationQuarterTurns !== 0 ||
            card.abilityUsed ||
            card.visibilityGeneration !== 0 ||
            event.definitions.every(
              (definition) =>
                definition.id !== card.definitionId ||
                definition.category !== card.originalCategory ||
                definition.category !== card.currentCategory
            )
        ) ||
        new Set(event.cards.map((card) => card.id)).size !==
          event.cards.length ||
        new Set(event.definitions.map((definition) => definition.id)).size !==
          event.definitions.length ||
        event.definitions.some((definition) =>
          event.cards.every((card) => card.definitionId !== definition.id)
        ) ||
        event.definitions.some((definition) => {
          const existing = state.definitions[definition.id];
          return (
            existing !== undefined &&
            Object.values(state.cards).some(
              (card) =>
                card.ownerId !== event.playerId &&
                card.definitionId === definition.id
            ) &&
            !sameDefinition(existing, definition)
          );
        })
      ) {
        throw new Error('Loaded deck event is malformed');
      }
      const oldCardIds = new Set(
        Object.values(state.cards)
          .filter((card) => card.ownerId === event.playerId)
          .map((card) => card.id)
      );
      const reset = resetPlayerCards(state, event.playerId, false);
      const cards = { ...reset.cards };
      for (const oldCardId of oldCardIds) delete cards[oldCardId];
      for (const card of event.cards) cards[card.id] = card;
      const referencedDefinitionIds = new Set<string>(
        Object.values(cards).map((card) => card.definitionId)
      );
      const definitions = Object.fromEntries([
        ...Object.entries(reset.definitions).filter(([definitionId]) =>
          referencedDefinitionIds.has(definitionId)
        ),
        ...event.definitions.map(
          (definition) => [definition.id, definition] as const
        ),
      ]) as MatchState['definitions'];
      const deckId = playerZoneId(event.playerId, 'deck');
      return {
        ...reset,
        lifecycle: 'lobby',
        definitions,
        cards,
        deckLists: {
          ...reset.deckLists,
          [event.playerId]: [...event.deckOrder],
        },
        zones: {
          ...reset.zones,
          [deckId]: {
            ...requireZone(reset, deckId),
            cardIds: [...event.deckOrder],
          },
        },
      };
    }
    case 'PlayerReset': {
      const baseline = state.deckLists[event.playerId];
      if (!baseline || !sameCardOrder(event.deckOrder, baseline)) {
        throw new Error('Reset deck does not match the loaded deck baseline');
      }
      const reset = resetPlayerCards(state, event.playerId, true);
      const deckId = playerZoneId(event.playerId, 'deck');
      return {
        ...reset,
        lifecycle: 'lobby',
        zones: {
          ...reset.zones,
          [deckId]: {
            ...requireZone(reset, deckId),
            cardIds: [...event.deckOrder],
          },
        },
      };
    }
    case 'PlayerSetup': {
      const baseline = state.deckLists[event.playerId];
      const combined = [
        ...event.handOrder,
        ...event.prizeOrder,
        ...event.deckOrder,
      ];
      const sortedBaseline = [...(baseline ?? [])].sort();
      const sortedCombined = [...combined].sort();
      const expectedHandCount = Math.min(7, sortedBaseline.length);
      const expectedPrizeCount = Math.min(
        6,
        sortedBaseline.length - expectedHandCount
      );
      if (
        !baseline ||
        combined.length !== baseline.length ||
        new Set(combined).size !== combined.length ||
        !sameCardOrder(sortedCombined, sortedBaseline) ||
        event.handOrder.length !== expectedHandCount ||
        event.prizeOrder.length !== expectedPrizeCount
      ) {
        throw new Error('Setup event does not partition the loaded deck');
      }
      const reset = resetPlayerCards(state, event.playerId, false);
      const deckId = playerZoneId(event.playerId, 'deck');
      const handId = playerZoneId(event.playerId, 'hand');
      const prizesId = playerZoneId(event.playerId, 'prizes');
      const concealedIds = new Set([
        ...event.deckOrder,
        ...event.handOrder,
        ...event.prizeOrder,
      ]);
      return {
        ...reset,
        lifecycle: 'playing',
        cards: Object.fromEntries(
          Object.entries(reset.cards).map(([cardId, card]) => [
            cardId,
            concealedIds.has(card.id) ? incrementVisibility(card) : card,
          ])
        ),
        zones: {
          ...reset.zones,
          [deckId]: {
            ...requireZone(reset, deckId),
            cardIds: [...event.deckOrder],
          },
          [handId]: {
            ...requireZone(reset, handId),
            cardIds: [...event.handOrder],
          },
          [prizesId]: {
            ...requireZone(reset, prizesId),
            cardIds: [...event.prizeOrder],
          },
        },
      };
    }
    case 'CardMoved': {
      const source = requireZone(state, event.expectedSourceZoneId);
      const sourceIndex = source.cardIds.indexOf(event.cardId);
      if (sourceIndex < 0) {
        throw new Error(`Card ${event.cardId} is not in expected source zone`);
      }
      const destination = requireZone(state, event.destinationZoneId);
      const sourceCards = [...source.cardIds];
      sourceCards.splice(sourceIndex, 1);
      const destinationCards =
        source.id === destination.id ? sourceCards : [...destination.cardIds];
      const destinationIndex = Math.min(
        event.destinationIndex,
        destinationCards.length
      );
      destinationCards.splice(destinationIndex, 0, event.cardId);
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing moved card ${event.cardId}`);
      const normalizedCard =
        destination.kind === 'board'
          ? { ...card, face: 'up' as const, abilityUsed: false }
          : {
              ...card,
              currentCategory: card.originalCategory,
              face: 'up' as const,
              orientationQuarterTurns: 0 as const,
              abilityUsed: false,
            };
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      return {
        ...state,
        cards: { ...state.cards, [event.cardId]: nextCard },
        zones: {
          ...state.zones,
          [source.id]: { ...source, cardIds: sourceCards },
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== event.cardId
          ),
        },
      };
    }
    case 'CardsDrawn': {
      const deckId = playerZoneId(event.playerId, 'deck');
      const handId = playerZoneId(event.playerId, 'hand');
      const deck = requireZone(state, deckId);
      const hand = requireZone(state, handId);
      if (
        event.cardIds.some((cardId, index) => deck.cardIds[index] !== cardId)
      ) {
        throw new Error('Draw event does not match current deck top');
      }
      const drawn = new Set(event.cardIds);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            drawn.has(card.id) ? incrementVisibility(card) : card,
          ])
        ),
        zones: {
          ...state.zones,
          [deckId]: {
            ...deck,
            cardIds: deck.cardIds.slice(event.cardIds.length),
          },
          [handId]: { ...hand, cardIds: [...hand.cardIds, ...event.cardIds] },
        },
      };
    }
    case 'AbilityMarkersReset': {
      const currentStackIds = Object.values(state.stacks)
        .filter((stack) => stack.abilityUsed)
        .map((stack) => stack.id)
        .sort();
      const currentCardIds = Object.values(state.cards)
        .filter((card) => card.abilityUsed)
        .map((card) => card.id)
        .sort();
      if (
        !sameCardOrder(currentStackIds, [...event.stackIds].sort()) ||
        !sameCardOrder(currentCardIds, [...event.cardIds].sort())
      ) {
        throw new Error('Ability reset event does not match current markers');
      }
      const resetStacks = new Set(event.stackIds);
      const resetCards = new Set(event.cardIds);
      return {
        ...state,
        stacks: Object.fromEntries(
          Object.entries(state.stacks).map(([stackId, stack]) => [
            stackId,
            resetStacks.has(stack.id)
              ? { ...stack, abilityUsed: false }
              : stack,
          ])
        ),
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            resetCards.has(card.id) ? { ...card, abilityUsed: false } : card,
          ])
        ),
      };
    }
    case 'InPlayCardsRevealed': {
      const currentCardIds = Object.values(state.stacks)
        .flatMap((stack) => [
          ...stack.evolutionCardIds,
          ...stack.attachmentCardIds,
        ])
        .filter((cardId) => state.cards[cardId]?.face === 'down')
        .sort();
      if (!sameCardOrder(currentCardIds, [...event.cardIds].sort())) {
        throw new Error('In-play reveal event does not match face-down cards');
      }
      const revealed = new Set(event.cardIds);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            revealed.has(card.id) ? { ...card, face: 'up' as const } : card,
          ])
        ),
      };
    }
    case 'TurnAdvanced': {
      if (
        state.turn.number !== event.expectedTurnNumber ||
        state.turn.currentPlayerId !== event.expectedCurrentPlayerId ||
        event.turnNumber !== event.expectedTurnNumber + 1 ||
        !Number.isSafeInteger(event.turnNumber) ||
        !state.players[event.playerId]
      ) {
        throw new Error('Turn event does not match current turn state');
      }
      return {
        ...state,
        turn: {
          number: event.turnNumber,
          currentPlayerId: event.playerId,
        },
      };
    }
    case 'TableActionDeclared': {
      if (
        !state.players[event.playerId] ||
        event.turnNumber !== state.turn.number
      ) {
        throw new Error('Table action does not match current match state');
      }
      if (
        (event.action === 'startTurn' && event.outcome === 'declared') ||
        (event.action !== 'startTurn' && event.outcome !== 'declared')
      ) {
        throw new Error('Table action has an invalid outcome');
      }
      if (
        event.action === 'startTurn' &&
        event.outcome === 'drawn' &&
        state.turn.currentPlayerId !== event.playerId
      ) {
        throw new Error('Started turn does not belong to the declared player');
      }
      if (
        event.action === 'startTurn' &&
        event.outcome === 'emptyDeck' &&
        requireZone(state, playerZoneId(event.playerId, 'deck')).cardIds
          .length !== 0
      ) {
        throw new Error('Empty-deck turn action has a non-empty deck');
      }
      return state;
    }
    case 'ZoneShuffled': {
      const zone = requireZone(state, event.zoneId);
      const before = [...zone.cardIds].sort();
      const after = [...event.cardOrder].sort();
      if (
        before.length !== after.length ||
        before.some((cardId, index) => cardId !== after[index])
      ) {
        throw new Error('Shuffle event is not a permutation of the zone');
      }
      const concealed = new Set(event.concealedCardIds);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            concealed.has(card.id) ? incrementVisibility(card) : card,
          ])
        ),
        zones: {
          ...state.zones,
          [event.zoneId]: { ...zone, cardIds: [...event.cardOrder] },
        },
      };
    }
    case 'ZoneOrdersSet': {
      const zoneIds = event.zones.map((zone) => zone.zoneId);
      if (new Set(zoneIds).size !== zoneIds.length) {
        throw new Error('Zone order event contains a duplicate zone');
      }
      const before: CardInstanceId[] = [];
      const after: CardInstanceId[] = [];
      for (const update of event.zones) {
        const zone = requireZone(state, update.zoneId);
        if (
          zone.cardIds.length !== update.expectedCardIds.length ||
          zone.cardIds.some(
            (cardId, index) => cardId !== update.expectedCardIds[index]
          )
        ) {
          throw new Error(`Zone ${zone.id} does not match expected order`);
        }
        before.push(...zone.cardIds);
        after.push(...update.cardIds);
      }
      const sortedBefore = [...before].sort();
      const sortedAfter = [...after].sort();
      if (
        sortedBefore.length !== sortedAfter.length ||
        sortedBefore.some((cardId, index) => cardId !== sortedAfter[index])
      ) {
        throw new Error('Zone order event changes the affected card set');
      }
      const concealed = new Set(event.concealedCardIds);
      if ([...concealed].some((cardId) => !after.includes(cardId))) {
        throw new Error(
          'Zone order event conceals a card outside affected zones'
        );
      }
      const zones = { ...state.zones };
      for (const update of event.zones) {
        const zone = requireZone(state, update.zoneId);
        zones[zone.id] = { ...zone, cardIds: [...update.cardIds] };
      }
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            concealed.has(card.id)
              ? incrementVisibility({ ...card, face: 'up' as const })
              : card,
          ])
        ),
        zones,
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => !concealed.has(cardId)
          ),
        },
      };
    }
    case 'LooseBoardCardsResolved': {
      const board = requireZone(state, event.boardZoneId);
      const destination = requireZone(state, event.destinationZoneId);
      if (
        board.kind !== 'board' ||
        board.ownerId !== event.playerId ||
        destination.ownerId !== event.playerId
      ) {
        throw new Error('Loose-board event has invalid zone ownership');
      }
      if (!(
        (event.destination === 'shuffleIntoDeck' &&
          destination.kind === 'deck') ||
        event.destination === destination.kind
      )) {
        throw new Error('Loose-board event destination does not match mode');
      }
      if (
        !sameCardOrder(board.cardIds, event.expectedBoardCardIds) ||
        !sameCardOrder(destination.cardIds, event.expectedDestinationCardIds)
      ) {
        throw new Error('Loose-board event has stale zone contents');
      }
      if (event.expectedBoardCardIds.length === 0) {
        throw new Error('Loose-board event cannot resolve an empty board');
      }
      if (event.destinationCardIds.length > 200) {
        throw new Error('Loose-board event exceeds destination capacity');
      }
      const before = [
        ...event.expectedDestinationCardIds,
        ...event.expectedBoardCardIds,
      ].sort();
      const after = [...event.destinationCardIds].sort();
      if (
        before.length !== after.length ||
        before.some((cardId, index) => cardId !== after[index])
      ) {
        throw new Error('Loose-board event changes the affected card set');
      }
      const moved = new Set(event.expectedBoardCardIds);
      const concealed = new Set(event.concealedCardIds);
      const expectedConcealed = new Set(
        event.destination === 'shuffleIntoDeck'
          ? event.destinationCardIds
          : event.destination === 'hand'
            ? event.expectedBoardCardIds
            : []
      );
      if (
        concealed.size !== expectedConcealed.size ||
        [...concealed].some((cardId) => !expectedConcealed.has(cardId))
      ) {
        throw new Error('Loose-board event has invalid concealed cards');
      }
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => {
            const normalized = moved.has(card.id)
              ? {
                  ...card,
                  currentCategory: card.originalCategory,
                  face: 'up' as const,
                  orientationQuarterTurns: 0 as const,
                  abilityUsed: false,
                }
              : card;
            return [
              cardId,
              concealed.has(card.id)
                ? incrementVisibility(normalized)
                : normalized,
            ];
          })
        ),
        zones: {
          ...state.zones,
          [board.id]: { ...board, cardIds: [] },
          [destination.id]: {
            ...destination,
            cardIds: [...event.destinationCardIds],
          },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => !moved.has(cardId) && !concealed.has(cardId)
          ),
        },
      };
    }
    case 'CardMovedToPlay': {
      const source = requireZone(state, event.expectedSourceZoneId);
      if (!source.cardIds.includes(event.cardId)) {
        throw new Error(`Card ${event.cardId} is not in expected source zone`);
      }
      const sourceCards = source.cardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      if (event.mode === 'newStack') {
        const board = state.boards[event.boardPlayerId];
        if (!board) throw new Error(`Missing board ${event.boardPlayerId}`);
        const nextStack: PlayStack = {
          id: event.stackId,
          boardPlayerId: event.boardPlayerId,
          slot: event.slot,
          evolutionCardIds: [event.cardId],
          attachmentCardIds: [],
          rotationQuarterTurns: 0,
          damage: null,
          specialCondition: null,
          abilityUsed: card.abilityUsed,
        };
        let activeStackId = board.activeStackId;
        let benchStackIds = [...board.benchStackIds];
        if (event.slot === 'active') {
          if (activeStackId && event.previousActiveToBench) {
            const priorStack = requireStack(state, activeStackId);
            benchStackIds.push(activeStackId);
            const stacks = {
              ...state.stacks,
              [priorStack.id]: {
                ...priorStack,
                slot: 'bench' as const,
                specialCondition: null,
              },
              [nextStack.id]: nextStack,
            };
            return {
              ...state,
              cards: {
                ...state.cards,
                [event.cardId]: {
                  ...card,
                  currentCategory: 'Pokémon',
                  face: 'up',
                  abilityUsed: false,
                },
              },
              zones: {
                ...state.zones,
                [source.id]: { ...source, cardIds: sourceCards },
              },
              stacks,
              boards: {
                ...state.boards,
                [event.boardPlayerId]: {
                  activeStackId: nextStack.id,
                  benchStackIds,
                },
              },
            };
          }
          activeStackId = nextStack.id;
        } else {
          benchStackIds.splice(
            Math.min(event.benchIndex, benchStackIds.length),
            0,
            nextStack.id
          );
        }
        return {
          ...state,
          cards: {
            ...state.cards,
            [event.cardId]: {
              ...card,
              currentCategory: 'Pokémon',
              face: 'up',
              abilityUsed: false,
            },
          },
          zones: {
            ...state.zones,
            [source.id]: { ...source, cardIds: sourceCards },
          },
          stacks: { ...state.stacks, [nextStack.id]: nextStack },
          boards: {
            ...state.boards,
            [event.boardPlayerId]: { activeStackId, benchStackIds },
          },
        };
      }
      const stack = requireStack(state, event.stackId);
      return {
        ...state,
        cards: {
          ...state.cards,
          [event.cardId]: {
            ...card,
            face: 'up',
            ...(event.mode === 'attachment' ? {} : { abilityUsed: false }),
          },
        },
        zones: {
          ...state.zones,
          [source.id]: { ...source, cardIds: sourceCards },
        },
        stacks: {
          ...state.stacks,
          [stack.id]: {
            ...stack,
            evolutionCardIds:
              event.mode === 'evolution'
                ? [...stack.evolutionCardIds, event.cardId]
                : stack.evolutionCardIds,
            attachmentCardIds:
              event.mode === 'attachment'
                ? [...stack.attachmentCardIds, event.cardId]
                : stack.attachmentCardIds,
            ...(event.mode === 'evolution'
              ? {
                  rotationQuarterTurns: 0 as const,
                  specialCondition: null,
                  abilityUsed: card.abilityUsed,
                }
              : {}),
          },
        },
      };
    }
    case 'CardMovedFromStack': {
      const stack = requireStack(state, event.expectedStackId);
      const sourceIndex = stack.attachmentCardIds.indexOf(event.cardId);
      if (sourceIndex < 0) {
        throw new Error(
          `Attachment ${event.cardId} is not in the expected stack`
        );
      }
      const destination = requireZone(state, event.destinationZoneId);
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        throw new Error('Stack departure would replace an occupied stadium');
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing moved card ${event.cardId}`);
      const normalizedCard = {
        ...card,
        currentCategory: card.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      const attachmentCardIds = stack.attachmentCardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      return {
        ...state,
        cards: { ...state.cards, [card.id]: nextCard },
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        stacks: {
          ...state.stacks,
          [stack.id]: { ...stack, attachmentCardIds },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== event.cardId
          ),
        },
      };
    }
    case 'PlayStackDeparted': {
      const stack = requireStack(state, event.expectedStackId);
      if (
        stack.boardPlayerId !== event.boardPlayerId ||
        stack.evolutionCardIds.length !==
          event.expectedEvolutionCardIds.length ||
        stack.evolutionCardIds.some(
          (cardId, index) => cardId !== event.expectedEvolutionCardIds[index]
        ) ||
        stack.attachmentCardIds.length !==
          event.expectedAttachmentCardIds.length ||
        stack.attachmentCardIds.some(
          (cardId, index) => cardId !== event.expectedAttachmentCardIds[index]
        ) ||
        stack.evolutionCardIds.at(-1) !== event.cardId
      ) {
        throw new Error('Play stack departure does not match expected stack');
      }
      const remainingEvolutionCardIds = stack.evolutionCardIds.slice(0, -1);
      const remainingAttachmentCardIds = [...stack.attachmentCardIds];
      const dependentCount =
        remainingEvolutionCardIds.length + remainingAttachmentCardIds.length;
      if (
        dependentCount === 0
          ? event.attachmentResolution !== null
          : !event.attachmentResolution ||
            event.attachmentResolution.suggestedSlot !== stack.slot ||
            event.attachmentResolution.evolutionCardIds.length !==
              remainingEvolutionCardIds.length ||
            event.attachmentResolution.evolutionCardIds.some(
              (cardId, index) => cardId !== remainingEvolutionCardIds[index]
            ) ||
            event.attachmentResolution.attachmentCardIds.length !==
              remainingAttachmentCardIds.length ||
            event.attachmentResolution.attachmentCardIds.some(
              (cardId, index) => cardId !== remainingAttachmentCardIds[index]
            )
      ) {
        throw new Error('Play stack departure has invalid dependent cards');
      }
      const areas = state.workAreas[event.boardPlayerId];
      if (!areas) {
        throw new Error(`Missing work areas for ${event.boardPlayerId}`);
      }
      if (event.attachmentResolution && areas.attachmentResolution) {
        throw new Error('Attachment resolution work area is already occupied');
      }
      const destination = requireZone(state, event.destinationZoneId);
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        throw new Error(
          'Play stack departure would replace an occupied stadium'
        );
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const departedCard = state.cards[event.cardId];
      if (!departedCard) throw new Error(`Missing moved card ${event.cardId}`);
      const normalizedCard = {
        ...departedCard,
        currentCategory: departedCard.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const nextDepartedCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      const stacks = { ...state.stacks };
      delete stacks[stack.id];
      const affectedCardIds = new Set([
        event.cardId,
        ...remainingEvolutionCardIds,
        ...remainingAttachmentCardIds,
      ]);
      return {
        ...state,
        cards: {
          ...state.cards,
          [event.cardId]: nextDepartedCard,
        },
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        stacks,
        boards: removeStackFromBoards(state, new Set([stack.id])),
        workAreas: {
          ...state.workAreas,
          [event.boardPlayerId]: {
            ...areas,
            attachmentResolution: event.attachmentResolution
              ? {
                  id: event.attachmentResolution.id,
                  sourceStackId: stack.id,
                  evolutionCardIds: [
                    ...event.attachmentResolution.evolutionCardIds,
                  ],
                  attachmentCardIds: [
                    ...event.attachmentResolution.attachmentCardIds,
                  ],
                  suggestedSlot: event.attachmentResolution.suggestedSlot,
                }
              : areas.attachmentResolution,
          },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => !affectedCardIds.has(cardId)
          ),
        },
      };
    }
    case 'PlayStackLayoutSet': {
      const board = state.boards[event.boardPlayerId];
      if (!board) throw new Error(`Missing board ${event.boardPlayerId}`);
      if (
        board.activeStackId !== event.expectedActiveStackId ||
        board.benchStackIds.length !== event.expectedBenchStackIds.length ||
        board.benchStackIds.some(
          (stackId, index) => stackId !== event.expectedBenchStackIds[index]
        )
      ) {
        throw new Error('Play stack layout does not match expected placement');
      }
      const before = [
        ...(board.activeStackId ? [board.activeStackId] : []),
        ...board.benchStackIds,
      ].sort();
      const after = [
        ...(event.activeStackId ? [event.activeStackId] : []),
        ...event.benchStackIds,
      ].sort();
      if (
        before.length !== after.length ||
        before.some((stackId, index) => stackId !== after[index]) ||
        new Set(after).size !== after.length
      ) {
        throw new Error('Play stack layout changes the board stack set');
      }
      const stacks = { ...state.stacks };
      for (const stackId of event.benchStackIds) {
        const stack = requireStack(state, stackId);
        if (stack.boardPlayerId !== event.boardPlayerId) {
          throw new Error(`Stack ${stackId} belongs to another board`);
        }
        stacks[stackId] = {
          ...stack,
          slot: 'bench',
          specialCondition: null,
        };
      }
      if (event.activeStackId) {
        const active = requireStack(state, event.activeStackId);
        if (active.boardPlayerId !== event.boardPlayerId) {
          throw new Error(
            `Stack ${event.activeStackId} belongs to another board`
          );
        }
        stacks[event.activeStackId] = { ...active, slot: 'active' };
      }
      return {
        ...state,
        boards: {
          ...state.boards,
          [event.boardPlayerId]: {
            activeStackId: event.activeStackId,
            benchStackIds: [...event.benchStackIds],
          },
        },
        stacks,
      };
    }
    case 'InspectedCardMoved': {
      const areas = state.workAreas[event.playerId];
      const inspection = areas?.inspection;
      if (
        !inspection ||
        inspection.id !== event.expectedWorkAreaId ||
        inspection.inspectionId !== event.inspectionId ||
        !inspection.cardIds.includes(event.cardId)
      ) {
        throw new Error('Inspected card departure does not match work area');
      }
      const destination = requireZone(state, event.destinationZoneId);
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        throw new Error('Inspected card would replace an occupied stadium');
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const remaining = inspection.cardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing inspected card ${event.cardId}`);
      const normalizedCard = {
        ...card,
        currentCategory: card.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      const inspectionGrants = Object.fromEntries(
        Object.entries(state.visibility.inspectionGrants)
          .map(([inspectionId, grant]) => [
            inspectionId,
            {
              ...grant,
              cardIds: grant.cardIds.filter(
                (cardId) => cardId !== event.cardId
              ),
            },
          ])
          .filter(([, grant]) =>
            Boolean(
              (grant as { readonly cardIds: readonly CardInstanceId[] }).cardIds
                .length
            )
          )
      ) as MatchState['visibility']['inspectionGrants'];
      return {
        ...state,
        cards: { ...state.cards, [card.id]: nextCard },
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: {
            ...areas,
            inspection:
              remaining.length === 0
                ? null
                : { ...inspection, cardIds: remaining },
          },
        },
        visibility: {
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== event.cardId
          ),
          inspectionGrants,
        },
      };
    }
    case 'StagedCardMoved': {
      const areas = state.workAreas[event.playerId];
      const resolution = areas?.attachmentResolution;
      if (!areas || !resolution || resolution.id !== event.expectedWorkAreaId) {
        throw new Error('Staged card departure does not match work area');
      }
      const sourceIds =
        event.source === 'evolution'
          ? resolution.evolutionCardIds
          : resolution.attachmentCardIds;
      if (!sourceIds.includes(event.cardId)) {
        throw new Error('Staged card is not in the expected sequence');
      }
      const destination = requireZone(state, event.destinationZoneId);
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        throw new Error('Staged card would replace an occupied stadium');
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing staged card ${event.cardId}`);
      const normalizedCard = {
        ...card,
        currentCategory: card.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      const evolutionCardIds = resolution.evolutionCardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      const attachmentCardIds = resolution.attachmentCardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      return {
        ...state,
        cards: { ...state.cards, [card.id]: nextCard },
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: {
            ...areas,
            attachmentResolution:
              evolutionCardIds.length + attachmentCardIds.length === 0
                ? null
                : {
                    ...resolution,
                    evolutionCardIds,
                    attachmentCardIds,
                  },
          },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== event.cardId
          ),
        },
      };
    }
    case 'StagedStackRestored': {
      const areas = state.workAreas[event.playerId];
      const resolution = areas?.attachmentResolution;
      const board = state.boards[event.playerId];
      if (!areas || !resolution || resolution.id !== event.expectedWorkAreaId) {
        throw new Error('Staged stack restore does not match work area');
      }
      if (
        resolution.evolutionCardIds.length === 0 ||
        resolution.evolutionCardIds.length !==
          event.expectedEvolutionCardIds.length ||
        resolution.evolutionCardIds.some(
          (cardId, index) => cardId !== event.expectedEvolutionCardIds[index]
        ) ||
        resolution.attachmentCardIds.length !==
          event.expectedAttachmentCardIds.length ||
        resolution.attachmentCardIds.some(
          (cardId, index) => cardId !== event.expectedAttachmentCardIds[index]
        )
      ) {
        throw new Error('Staged stack restore has stale card ordering');
      }
      if (
        !board ||
        board.activeStackId !== event.expectedActiveStackId ||
        board.benchStackIds.length !== event.expectedBenchStackIds.length ||
        board.benchStackIds.some(
          (stackId, index) => stackId !== event.expectedBenchStackIds[index]
        )
      ) {
        throw new Error('Staged stack restore has stale board layout');
      }
      if (state.stacks[event.stackId]) {
        throw new Error(`Restored stack ${event.stackId} already exists`);
      }
      const nextStack: PlayStack = {
        id: event.stackId,
        boardPlayerId: event.playerId,
        slot: event.destinationSlot,
        evolutionCardIds: [...resolution.evolutionCardIds],
        attachmentCardIds: [...resolution.attachmentCardIds],
        rotationQuarterTurns: 0,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
      let activeStackId = board.activeStackId;
      const benchStackIds = [...board.benchStackIds];
      const stacks = { ...state.stacks, [nextStack.id]: nextStack };
      if (event.destinationSlot === 'active') {
        if (activeStackId) {
          const previousActive = requireStack(state, activeStackId);
          if (previousActive.boardPlayerId !== event.playerId) {
            throw new Error('Previous active stack belongs to another board');
          }
          stacks[previousActive.id] = {
            ...previousActive,
            slot: 'bench',
            specialCondition: null,
          };
          benchStackIds.push(previousActive.id);
        }
        activeStackId = nextStack.id;
      } else {
        benchStackIds.splice(
          Math.min(event.benchIndex, benchStackIds.length),
          0,
          nextStack.id
        );
      }
      const restoredEvolutionIds = new Set(resolution.evolutionCardIds);
      const restoredIds = new Set([
        ...resolution.evolutionCardIds,
        ...resolution.attachmentCardIds,
      ]);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            restoredIds.has(card.id)
              ? {
                  ...card,
                  currentCategory: restoredEvolutionIds.has(card.id)
                    ? ('Pokémon' as const)
                    : card.currentCategory,
                  face: 'up' as const,
                  orientationQuarterTurns: 0 as const,
                  abilityUsed: restoredEvolutionIds.has(card.id)
                    ? false
                    : card.abilityUsed,
                }
              : card,
          ])
        ),
        boards: {
          ...state.boards,
          [event.playerId]: { activeStackId, benchStackIds },
        },
        stacks,
        workAreas: {
          ...state.workAreas,
          [event.playerId]: { ...areas, attachmentResolution: null },
        },
      };
    }
    case 'StagedCardsResolved': {
      const areas = state.workAreas[event.playerId];
      const resolution = areas?.attachmentResolution;
      if (!areas || !resolution || resolution.id !== event.expectedWorkAreaId) {
        throw new Error('Staged-card resolution does not match work area');
      }
      if (
        resolution.evolutionCardIds.length !==
          event.expectedEvolutionCardIds.length ||
        resolution.evolutionCardIds.some(
          (cardId, index) => cardId !== event.expectedEvolutionCardIds[index]
        ) ||
        resolution.attachmentCardIds.length !==
          event.expectedAttachmentCardIds.length ||
        resolution.attachmentCardIds.some(
          (cardId, index) => cardId !== event.expectedAttachmentCardIds[index]
        )
      ) {
        throw new Error('Staged-card resolution has stale card ordering');
      }
      const stagedCardIds = [
        ...resolution.evolutionCardIds,
        ...resolution.attachmentCardIds,
      ];
      const resolved = applyWorkAreaCardsResolved(state, event, stagedCardIds);
      return {
        ...resolved,
        workAreas: {
          ...resolved.workAreas,
          [event.playerId]: { ...areas, attachmentResolution: null },
        },
      };
    }
    case 'InspectionCardsResolved': {
      const areas = state.workAreas[event.playerId];
      const inspection = areas?.inspection;
      if (
        !areas ||
        !inspection ||
        inspection.id !== event.expectedWorkAreaId ||
        inspection.inspectionId !== event.inspectionId ||
        inspection.cardIds.length !== event.expectedCardIds.length ||
        inspection.cardIds.some(
          (cardId, index) => cardId !== event.expectedCardIds[index]
        )
      ) {
        throw new Error('Inspection-card resolution has stale card ordering');
      }
      const resolved = applyWorkAreaCardsResolved(
        state,
        event,
        inspection.cardIds
      );
      return {
        ...resolved,
        workAreas: {
          ...resolved.workAreas,
          [event.playerId]: { ...areas, inspection: null },
        },
        visibility: {
          ...resolved.visibility,
          inspectionGrants: Object.fromEntries(
            Object.entries(resolved.visibility.inspectionGrants).filter(
              ([inspectionId]) => inspectionId !== event.inspectionId
            )
          ),
        },
      };
    }
    case 'InspectionCardSwappedWithDeckTop': {
      const areas = state.workAreas[event.playerId];
      const inspection = areas?.inspection;
      const deckId = playerZoneId(event.playerId, 'deck');
      const deck = requireZone(state, deckId);
      if (
        !areas ||
        !inspection ||
        inspection.id !== event.expectedWorkAreaId ||
        inspection.inspectionId !== event.inspectionId ||
        inspection.cardIds.length !== event.expectedInspectionCardIds.length ||
        inspection.cardIds.some(
          (cardId, index) => cardId !== event.expectedInspectionCardIds[index]
        ) ||
        !inspection.cardIds.includes(event.cardId)
      ) {
        throw new Error('Inspection deck-top swap has a stale work area');
      }
      if (
        deck.cardIds.length !== event.expectedDeckCardIds.length ||
        deck.cardIds.some(
          (cardId, index) => cardId !== event.expectedDeckCardIds[index]
        ) ||
        deck.cardIds[0] !== event.deckTopCardId
      ) {
        throw new Error('Inspection deck-top swap has a stale deck');
      }
      const selected = state.cards[event.cardId];
      const deckTop = state.cards[event.deckTopCardId];
      if (!selected || !deckTop) {
        throw new Error('Inspection deck-top swap references a missing card');
      }
      const inspectionCardIds = inspection.cardIds.map((cardId) =>
        cardId === event.cardId ? event.deckTopCardId : cardId
      );
      const normalizedSelected = {
        ...selected,
        currentCategory: selected.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const normalizedDeckTop = {
        ...deckTop,
        currentCategory: deckTop.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const inspectionGrants = Object.fromEntries(
        Object.entries(state.visibility.inspectionGrants)
          .map(([inspectionId, grant]) => [
            inspectionId,
            {
              ...grant,
              cardIds:
                inspectionId === event.inspectionId
                  ? grant.cardIds.map((cardId) =>
                      cardId === event.cardId ? event.deckTopCardId : cardId
                    )
                  : grant.cardIds.filter((cardId) => cardId !== event.cardId),
            },
          ])
          .filter(([, grant]) =>
            Boolean(
              (grant as { readonly cardIds: readonly CardInstanceId[] }).cardIds
                .length
            )
          )
      ) as MatchState['visibility']['inspectionGrants'];
      return {
        ...state,
        cards: {
          ...state.cards,
          [selected.id]: incrementVisibility(normalizedSelected),
          [deckTop.id]: normalizedDeckTop,
        },
        zones: {
          ...state.zones,
          [deck.id]: {
            ...deck,
            cardIds: [event.cardId, ...deck.cardIds.slice(1)],
          },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: {
            ...areas,
            inspection: { ...inspection, cardIds: inspectionCardIds },
          },
        },
        visibility: {
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) =>
              cardId !== event.cardId && cardId !== event.deckTopCardId
          ),
          inspectionGrants,
        },
      };
    }
    case 'StagedCardSwappedWithDeckTop': {
      const areas = state.workAreas[event.playerId];
      const resolution = areas?.attachmentResolution;
      const deckId = playerZoneId(event.playerId, 'deck');
      const deck = requireZone(state, deckId);
      if (
        !areas ||
        !resolution ||
        resolution.id !== event.expectedWorkAreaId ||
        resolution.evolutionCardIds.length !==
          event.expectedEvolutionCardIds.length ||
        resolution.evolutionCardIds.some(
          (cardId, index) => cardId !== event.expectedEvolutionCardIds[index]
        ) ||
        resolution.attachmentCardIds.length !==
          event.expectedAttachmentCardIds.length ||
        resolution.attachmentCardIds.some(
          (cardId, index) => cardId !== event.expectedAttachmentCardIds[index]
        )
      ) {
        throw new Error('Staged deck-top swap has a stale work area');
      }
      const sourceIds =
        event.source === 'evolution'
          ? resolution.evolutionCardIds
          : resolution.attachmentCardIds;
      if (!sourceIds.includes(event.cardId)) {
        throw new Error('Staged deck-top swap has a stale source sequence');
      }
      if (
        deck.cardIds.length !== event.expectedDeckCardIds.length ||
        deck.cardIds.some(
          (cardId, index) => cardId !== event.expectedDeckCardIds[index]
        ) ||
        deck.cardIds[0] !== event.deckTopCardId
      ) {
        throw new Error('Staged deck-top swap has a stale deck');
      }
      const selected = state.cards[event.cardId];
      const deckTop = state.cards[event.deckTopCardId];
      if (!selected || !deckTop) {
        throw new Error('Staged deck-top swap references a missing card');
      }
      const swap = (cardIds: readonly CardInstanceId[]) =>
        cardIds.map((cardId) =>
          cardId === event.cardId ? event.deckTopCardId : cardId
        );
      const normalizedSelected = {
        ...selected,
        currentCategory: selected.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      const normalizedDeckTop = {
        ...deckTop,
        currentCategory: deckTop.originalCategory,
        face: 'up' as const,
        orientationQuarterTurns: 0 as const,
        abilityUsed: false,
      };
      return {
        ...state,
        cards: {
          ...state.cards,
          [selected.id]: incrementVisibility(normalizedSelected),
          [deckTop.id]: normalizedDeckTop,
        },
        zones: {
          ...state.zones,
          [deck.id]: {
            ...deck,
            cardIds: [event.cardId, ...deck.cardIds.slice(1)],
          },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: {
            ...areas,
            attachmentResolution: {
              ...resolution,
              evolutionCardIds:
                event.source === 'evolution'
                  ? swap(resolution.evolutionCardIds)
                  : resolution.evolutionCardIds,
              attachmentCardIds:
                event.source === 'attachment'
                  ? swap(resolution.attachmentCardIds)
                  : resolution.attachmentCardIds,
            },
          },
        },
        visibility: {
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) =>
              cardId !== event.cardId && cardId !== event.deckTopCardId
          ),
          inspectionGrants: Object.fromEntries(
            Object.entries(state.visibility.inspectionGrants)
              .map(([inspectionId, grant]) => [
                inspectionId,
                {
                  ...grant,
                  cardIds: grant.cardIds.filter(
                    (cardId) => cardId !== event.cardId
                  ),
                },
              ])
              .filter(([, grant]) =>
                Boolean(
                  (grant as { readonly cardIds: readonly CardInstanceId[] })
                    .cardIds.length
                )
              )
          ) as MatchState['visibility']['inspectionGrants'],
        },
      };
    }
    case 'StackDamageSet': {
      const stack = requireStack(state, event.stackId);
      return {
        ...state,
        stacks: {
          ...state.stacks,
          [stack.id]: { ...stack, damage: event.damage },
        },
      };
    }
    case 'StackConditionSet': {
      const stack = requireStack(state, event.stackId);
      return {
        ...state,
        stacks: {
          ...state.stacks,
          [stack.id]: { ...stack, specialCondition: event.condition },
        },
      };
    }
    case 'StackAbilitySet': {
      const stack = requireStack(state, event.stackId);
      return {
        ...state,
        stacks: {
          ...state.stacks,
          [stack.id]: { ...stack, abilityUsed: event.used },
        },
      };
    }
    case 'StackRotationSet': {
      const stack = requireStack(state, event.stackId);
      return {
        ...state,
        stacks: {
          ...state.stacks,
          [stack.id]: {
            ...stack,
            rotationQuarterTurns: event.rotationQuarterTurns,
          },
        },
      };
    }
    case 'CardOrientationSet': {
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      return {
        ...state,
        cards: {
          ...state.cards,
          [card.id]: {
            ...card,
            orientationQuarterTurns: event.orientationQuarterTurns,
          },
        },
      };
    }
    case 'CardAbilitySet': {
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      return {
        ...state,
        cards: {
          ...state.cards,
          [card.id]: { ...card, abilityUsed: event.used },
        },
      };
    }
    case 'CardFaceSet': {
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      return {
        ...state,
        cards: {
          ...state.cards,
          [card.id]: event.concealIdentity
            ? incrementVisibility({ ...card, face: event.face })
            : { ...card, face: event.face },
        },
        visibility: {
          ...state.visibility,
          publicCardIds:
            event.face === 'down'
              ? state.visibility.publicCardIds.filter(
                  (cardId) => cardId !== event.cardId
                )
              : state.visibility.publicCardIds,
        },
      };
    }
    case 'CardCategorySet': {
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      return {
        ...state,
        cards: {
          ...state.cards,
          [card.id]: { ...card, currentCategory: event.category },
        },
      };
    }
    case 'PublicRevealSet': {
      const targetIds = new Set(event.cardIds);
      const firstCard = state.cards[event.cardIds[0]!];
      const firstLocation = firstCard
        ? findCardLocation(state, firstCard.id)
        : null;
      const source =
        firstCard && firstLocation
          ? cardSourceSnapshot(state, firstCard, firstLocation)
          : null;
      if (
        event.cardIds.length === 0 ||
        targetIds.size !== event.cardIds.length ||
        !source ||
        source.id !== event.expectedSourceId ||
        source.playerId !== event.playerId ||
        !sameCardOrder(source.cardIds, event.expectedSourceCardIds) ||
        event.cardIds.some((cardId) => !source.cardIds.includes(cardId))
      ) {
        throw new Error('Public visibility event source is malformed');
      }
      const face = publicVisibilityFace(source, event.revealed);
      if (
        event.cardIds.some((cardId) => {
          const card = state.cards[cardId];
          return (
            !card ||
            (state.visibility.publicCardIds.includes(cardId) ===
              event.revealed &&
              card.face === face)
          );
        })
      ) {
        throw new Error('Public visibility event contains an unchanged card');
      }
      const revealed = new Set(state.visibility.publicCardIds);
      for (const cardId of event.cardIds) {
        if (event.revealed) revealed.add(cardId);
        else revealed.delete(cardId);
      }
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            targetIds.has(card.id)
              ? event.revealed
                ? { ...card, face }
                : incrementVisibility({ ...card, face })
              : card,
          ])
        ),
        visibility: {
          ...state.visibility,
          publicCardIds: [...revealed],
        },
      };
    }
    case 'InspectionOpened': {
      const source = requireZone(state, event.sourceZoneId);
      if (state.workAreas[event.playerId]?.inspection) {
        throw new Error(`Player ${event.playerId} already has an inspection`);
      }
      const selected = new Set(event.cardIds);
      if (event.cardIds.some((cardId) => !source.cardIds.includes(cardId))) {
        throw new Error('Inspection contains a card outside its source zone');
      }
      return {
        ...state,
        zones: {
          ...state.zones,
          [source.id]: {
            ...source,
            cardIds: source.cardIds.filter((cardId) => !selected.has(cardId)),
          },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: {
            ...state.workAreas[event.playerId]!,
            inspection: {
              id: event.workAreaId,
              inspectionId: event.inspectionId,
              sourceZoneId: event.sourceZoneId,
              cardIds: [...event.cardIds],
              viewerIds: [...event.viewerIds],
            },
          },
        },
      };
    }
    case 'InspectionClosed': {
      const areas = state.workAreas[event.playerId];
      if (areas?.inspection?.inspectionId !== event.inspectionId) {
        throw new Error(`Inspection ${event.inspectionId} is not active`);
      }
      const destination = requireZone(state, event.destinationZoneId);
      const returned = new Set(areas.inspection.cardIds);
      const order = new Set(event.cardOrder);
      if (
        event.cardOrder.length !== destination.cardIds.length + returned.size ||
        [...destination.cardIds, ...returned].some(
          (cardId) => !order.has(cardId)
        )
      ) {
        throw new Error(
          'Inspection close order is not a valid destination order'
        );
      }
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => {
            if (!returned.has(card.id)) return [cardId, card];
            const normalized = {
              ...card,
              currentCategory: card.originalCategory,
              face: 'up' as const,
              orientationQuarterTurns: 0 as const,
              abilityUsed: false,
            };
            return [
              cardId,
              event.concealIdentity
                ? incrementVisibility(normalized)
                : normalized,
            ];
          })
        ),
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: [...event.cardOrder] },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: { ...areas, inspection: null },
        },
        visibility: {
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => !event.concealIdentity || !returned.has(cardId)
          ),
          inspectionGrants: Object.fromEntries(
            Object.entries(state.visibility.inspectionGrants).filter(
              ([inspectionId]) => inspectionId !== event.inspectionId
            )
          ),
        },
      };
    }
    case 'OncePerGameMarkerSet': {
      const player = state.players[event.playerId];
      if (!player) throw new Error(`Missing player ${event.playerId}`);
      return {
        ...state,
        players: {
          ...state.players,
          [player.id]: {
            ...player,
            oncePerGame: {
              ...player.oncePerGame,
              [event.marker === 'gx' ? 'gxUsed' : 'vstarUsed']: event.used,
            },
          },
        },
      };
    }
    case 'CoinFlipped':
      return state;
  }
};

export const applyEventBatch = (
  state: MatchState,
  batch: EventBatch
): MatchState => {
  if (batch.revision !== state.revision + 1) {
    throw new Error(
      `Expected revision ${state.revision + 1}, received ${batch.revision}`
    );
  }
  let next = state;
  for (const event of batch.events) next = applyEvent(next, event);
  return { ...next, revision: batch.revision };
};
