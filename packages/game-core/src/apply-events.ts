import { playerZoneId } from './create-match.js';
import type { DomainEvent, EventBatch } from './events.js';
import type { CardInstanceId, PlayerId, StackId } from './ids.js';
import { findCardLocation } from './location.js';
import type { CardInstance, CardZone, MatchState, PlayStack } from './model.js';

const incrementVisibility = (card: CardInstance): CardInstance => ({
  ...card,
  visibilityGeneration: card.visibilityGeneration + 1,
});

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
    Object.entries(state.workAreas).map(([playerId, areas]) => [
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
        attachmentResolution: areas.attachmentResolution
          ? {
              ...areas.attachmentResolution,
              cardIds: areas.attachmentResolution.cardIds.filter(
                (cardId) => !cardIds.has(cardId)
              ),
            }
          : null,
      },
    ])
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
  playerId: PlayerId
): MatchState => {
  const cardIds = new Set(
    Object.values(state.cards)
      .filter((card) => card.ownerId === playerId)
      .map((card) => card.id)
  );
  const removed = removeCardsFromAllLocations(state, cardIds);
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
              visibilityGeneration: card.visibilityGeneration + 1,
            }
          : card,
      ])
    ),
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

export const applyEvent = (
  state: MatchState,
  event: DomainEvent
): MatchState => {
  switch (event.type) {
    case 'DeckLoaded': {
      const oldCardIds = new Set(
        Object.values(state.cards)
          .filter((card) => card.ownerId === event.playerId)
          .map((card) => card.id)
      );
      const removed = removeCardsFromAllLocations(state, oldCardIds);
      const cards = { ...removed.cards };
      for (const oldCardId of oldCardIds) delete cards[oldCardId];
      for (const card of event.cards) cards[card.id] = card;
      const definitions = { ...removed.definitions };
      for (const definition of event.definitions) {
        definitions[definition.id] = definition;
      }
      const deckId = playerZoneId(event.playerId, 'deck');
      return {
        ...removed,
        definitions,
        cards,
        deckLists: {
          ...removed.deckLists,
          [event.playerId]: [...event.deckOrder],
        },
        zones: {
          ...removed.zones,
          [deckId]: {
            ...requireZone(removed, deckId),
            cardIds: [...event.deckOrder],
          },
        },
      };
    }
    case 'PlayerReset': {
      const reset = resetPlayerCards(state, event.playerId);
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
      const reset = resetPlayerCards(state, event.playerId);
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
      const nextCard = event.concealIdentity
        ? incrementVisibility({ ...card, face: 'up' })
        : { ...card, face: 'up' as const };
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
          abilityUsed: false,
        };
        let activeStackId = board.activeStackId;
        let benchStackIds = [...board.benchStackIds];
        if (event.slot === 'active') {
          if (activeStackId && event.previousActiveToBench) {
            const priorStack = requireStack(state, activeStackId);
            benchStackIds.push(activeStackId);
            const stacks = {
              ...state.stacks,
              [priorStack.id]: { ...priorStack, slot: 'bench' as const },
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
          [event.cardId]: { ...card, face: 'up' },
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
          },
        },
      };
    }
    case 'CardMovedFromStack': {
      const stack = requireStack(state, event.expectedStackId);
      const sourceIds =
        event.source === 'evolution'
          ? stack.evolutionCardIds
          : stack.attachmentCardIds;
      const sourceIndex = sourceIds.indexOf(event.cardId);
      if (sourceIndex < 0) {
        throw new Error(`Card ${event.cardId} is not in the expected stack`);
      }
      if (
        event.source === 'evolution' &&
        sourceIndex !== stack.evolutionCardIds.length - 1
      ) {
        throw new Error('Stack departure is not the top evolution card');
      }
      if (
        event.source === 'evolution' &&
        stack.evolutionCardIds.length === 1 &&
        stack.attachmentCardIds.length > 0
      ) {
        throw new Error('Stack departure would orphan attached cards');
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
      };
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
      const evolutionCardIds = stack.evolutionCardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      const attachmentCardIds = stack.attachmentCardIds.filter(
        (cardId) => cardId !== event.cardId
      );
      const stacks = { ...state.stacks };
      let boards = state.boards;
      if (evolutionCardIds.length === 0) {
        delete stacks[stack.id];
        boards = removeStackFromBoards(state, new Set([stack.id]));
      } else {
        stacks[stack.id] = {
          ...stack,
          evolutionCardIds,
          attachmentCardIds,
        };
      }
      return {
        ...state,
        cards: { ...state.cards, [card.id]: nextCard },
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: destinationCards },
        },
        stacks,
        boards,
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== event.cardId
          ),
        },
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
      if (!state.cards[event.cardId]) {
        throw new Error(`Missing card ${event.cardId}`);
      }
      const revealed = new Set(state.visibility.publicCardIds);
      if (event.revealed) revealed.add(event.cardId);
      else revealed.delete(event.cardId);
      return {
        ...state,
        cards: event.revealed
          ? state.cards
          : {
              ...state.cards,
              [event.cardId]: incrementVisibility(state.cards[event.cardId]!),
            },
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
        cards: event.concealIdentity
          ? Object.fromEntries(
              Object.entries(state.cards).map(([cardId, card]) => [
                cardId,
                returned.has(card.id) ? incrementVisibility(card) : card,
              ])
            )
          : state.cards,
        zones: {
          ...state.zones,
          [destination.id]: { ...destination, cardIds: [...event.cardOrder] },
        },
        workAreas: {
          ...state.workAreas,
          [event.playerId]: { ...areas, inspection: null },
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
