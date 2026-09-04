import { playerZoneId } from './create-match.js';
import { cloneMatchState } from './clone.js';
import {
  normalizeAttachmentCardIdsV1,
  orderAttachmentCardIdsV1,
} from './attachment-order.js';
import type { DomainEvent, EventBatch } from './events.js';
import type { CardInstanceId, PlayerId, StackId, ZoneId } from './ids.js';
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
import { isCardKnownToViewer } from './projection.js';
import { soloUndoCheckpointProblem } from './solo-undo.js';
import { stableHash } from './stable-hash.js';

const incrementVisibility = (card: CardInstance): CardInstance => ({
  ...card,
  visibilityGeneration: card.visibilityGeneration + 1,
});

const normalizeCardForZone = (
  card: CardInstance,
  destination: CardZone
): CardInstance =>
  destination.kind === 'board'
    ? { ...card, face: 'up', abilityUsed: false }
    : {
        ...card,
        currentCategory: card.originalCategory,
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
      };

const isConcealedZone = (zone: CardZone): boolean =>
  zone.kind === 'deck' || zone.kind === 'hand' || zone.kind === 'prizes';

const retireInspectionGrants = (
  grants: MatchState['visibility']['inspectionGrants'],
  cardIds: ReadonlySet<CardInstanceId>
): MatchState['visibility']['inspectionGrants'] =>
  Object.fromEntries(
    Object.entries(grants).flatMap(([inspectionId, grant]) => {
      const retainedCardIds = grant.cardIds.filter(
        (cardId) => !cardIds.has(cardId)
      );
      return retainedCardIds.length === 0
        ? []
        : [[inspectionId, { ...grant, cardIds: retainedCardIds }]];
    })
  ) as MatchState['visibility']['inspectionGrants'];

const retireVisibility = (
  state: MatchState,
  publicCardIds: ReadonlySet<CardInstanceId>,
  inspectionCardIds: ReadonlySet<CardInstanceId>
): MatchState['visibility'] => ({
  publicCardIds: state.visibility.publicCardIds.filter(
    (cardId) => !publicCardIds.has(cardId)
  ),
  inspectionGrants: retireInspectionGrants(
    state.visibility.inspectionGrants,
    inspectionCardIds
  ),
});

const sameCardOrder = <Value>(
  left: readonly Value[],
  right: readonly Value[]
): boolean =>
  left.length === right.length &&
  left.every((cardId, index) => cardId === right[index]);

const sameCardSet = (
  left: Iterable<CardInstanceId>,
  right: Iterable<CardInstanceId>
): boolean => {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sameCardOrder(sortedLeft, sortedRight);
};

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

  const visibilityRetiredCardIds = new Set([...cardIds, ...orphanedCardIds]);
  const publicCardIds = state.visibility.publicCardIds.filter(
    (cardId) => !visibilityRetiredCardIds.has(cardId)
  );
  const inspectionGrants = Object.fromEntries(
    Object.entries(state.visibility.inspectionGrants)
      .map(([inspectionId, grant]) => [
        inspectionId,
        {
          ...grant,
          cardIds: grant.cardIds.filter(
            (cardId) => !visibilityRetiredCardIds.has(cardId)
          ),
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

type ZoneOrdersSetEvent = Extract<
  DomainEvent,
  { readonly type: 'ZoneOrdersSet' }
>;

interface ZoneOrderEffects {
  readonly zones: MatchState['zones'];
  readonly normalizedIds: ReadonlySet<CardInstanceId>;
  readonly concealedIds: ReadonlySet<CardInstanceId>;
  readonly visibilityRetiredIds: ReadonlySet<CardInstanceId>;
  readonly destinationZoneByCard: ReadonlyMap<CardInstanceId, ZoneId>;
}

const deriveZoneOrderEffects = (
  state: MatchState,
  event: ZoneOrdersSetEvent
): ZoneOrderEffects => {
  if (
    event.zones.length === 0 ||
    new Set(event.zones.map((zone) => zone.zoneId)).size !== event.zones.length
  ) {
    throw new Error('Zone order event contains invalid zone references');
  }
  const updates = event.zones.map((update) => {
    const zone = requireZone(state, update.zoneId);
    if (!sameCardOrder(zone.cardIds, update.expectedCardIds)) {
      throw new Error(`Zone ${zone.id} does not match expected order`);
    }
    return { update, zone };
  });
  const before = updates.flatMap(({ zone }) => [...zone.cardIds]);
  const after = updates.flatMap(({ update }) => [...update.cardIds]);
  if (!sameCardSet(before, after)) {
    throw new Error('Zone order event changes the affected card set');
  }

  const destinationZoneByCard = new Map<CardInstanceId, ZoneId>();
  for (const { update, zone } of updates) {
    for (const cardId of update.cardIds) {
      destinationZoneByCard.set(cardId, zone.id);
    }
  }
  let normalizedIds: ReadonlySet<CardInstanceId>;
  let expectedConcealedIds: readonly CardInstanceId[];
  let visibilityRetiredIds: readonly CardInstanceId[];
  const invalidSemantics = (): never => {
    throw new Error(`Zone order event has invalid ${event.reason} semantics`);
  };
  const exactKinds = (expectedKinds: readonly CardZone['kind'][]): boolean =>
    updates.length === expectedKinds.length &&
    updates.every(({ zone }, index) => zone.kind === expectedKinds[index]);
  const sameNonNullOwner = (): boolean => {
    const ownerId = updates[0]?.zone.ownerId;
    return (
      ownerId !== null &&
      ownerId !== undefined &&
      updates.every(({ zone }) => zone.ownerId === ownerId)
    );
  };

  switch (event.reason) {
    case 'move-zone-contents': {
      if (updates.length !== 2) invalidSemantics();
      const source = updates[0]!;
      const destination = updates[1]!;
      if (
        source.zone.id === destination.zone.id ||
        source.zone.kind === 'board' ||
        destination.zone.kind === 'board' ||
        source.update.cardIds.length !== 0 ||
        !sameCardOrder(destination.update.cardIds, [
          ...destination.zone.cardIds,
          ...source.zone.cardIds,
        ]) ||
        (destination.zone.kind === 'stadium' &&
          destination.update.cardIds.length > 1)
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = isConcealedZone(destination.zone)
        ? source.zone.cardIds
        : [];
      normalizedIds = new Set(source.zone.cardIds);
      visibilityRetiredIds = source.zone.cardIds;
      break;
    }
    case 'move-card-to-deck-top':
    case 'move-card-to-deck-bottom': {
      if (!exactKinds(['deck'])) invalidSemantics();
      const { zone, update } = updates[0]!;
      const movedCardIdCandidate =
        event.reason === 'move-card-to-deck-top'
          ? update.cardIds[0]
          : update.cardIds.at(-1);
      if (!movedCardIdCandidate) invalidSemantics();
      const movedCardId = movedCardIdCandidate!;
      const expectedRemainder = zone.cardIds.filter(
        (cardId) => cardId !== movedCardId
      );
      const actualRemainder =
        event.reason === 'move-card-to-deck-top'
          ? update.cardIds.slice(1)
          : update.cardIds.slice(0, -1);
      const priorEdge =
        event.reason === 'move-card-to-deck-top'
          ? zone.cardIds[0]
          : zone.cardIds.at(-1);
      if (
        priorEdge === movedCardId ||
        !zone.cardIds.includes(movedCardId) ||
        !sameCardOrder(expectedRemainder, actualRemainder)
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = [movedCardId];
      normalizedIds = new Set([movedCardId]);
      visibilityRetiredIds = [movedCardId];
      break;
    }
    case 'move-prizes-to-deck-bottom': {
      if (!exactKinds(['prizes', 'deck']) || !sameNonNullOwner()) {
        invalidSemantics();
      }
      const prizes = updates[0]!;
      const deck = updates[1]!;
      if (
        prizes.zone.cardIds.length === 0 ||
        prizes.update.cardIds.length !== 0 ||
        !sameCardOrder(
          deck.update.cardIds.slice(0, deck.zone.cardIds.length),
          deck.zone.cardIds
        ) ||
        !sameCardSet(
          deck.update.cardIds.slice(deck.zone.cardIds.length),
          prizes.zone.cardIds
        )
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = prizes.zone.cardIds;
      normalizedIds = new Set(prizes.zone.cardIds);
      visibilityRetiredIds = prizes.zone.cardIds;
      break;
    }
    case 'shuffle-zone-into-deck':
    case 'shuffle-zone-to-deck-bottom': {
      if (
        updates.length !== 2 ||
        updates[1]?.zone.kind !== 'deck' ||
        !sameNonNullOwner()
      ) {
        invalidSemantics();
      }
      const source = updates[0]!;
      const deck = updates[1]!;
      if (
        source.zone.id === deck.zone.id ||
        source.zone.kind === 'board' ||
        source.update.cardIds.length !== 0
      ) {
        invalidSemantics();
      }
      if (event.reason === 'shuffle-zone-into-deck') {
        if (
          !sameCardSet(deck.update.cardIds, [
            ...deck.zone.cardIds,
            ...source.zone.cardIds,
          ])
        ) {
          invalidSemantics();
        }
        expectedConcealedIds = deck.update.cardIds;
        visibilityRetiredIds = [...source.zone.cardIds, ...deck.zone.cardIds];
      } else {
        if (
          !sameCardOrder(
            deck.update.cardIds.slice(0, deck.zone.cardIds.length),
            deck.zone.cardIds
          ) ||
          !sameCardSet(
            deck.update.cardIds.slice(deck.zone.cardIds.length),
            source.zone.cardIds
          )
        ) {
          invalidSemantics();
        }
        expectedConcealedIds = source.zone.cardIds;
        visibilityRetiredIds = source.zone.cardIds;
      }
      normalizedIds = new Set(source.zone.cardIds);
      break;
    }
    case 'discard-hand-and-draw': {
      if (!exactKinds(['hand', 'deck', 'discard']) || !sameNonNullOwner()) {
        invalidSemantics();
      }
      const hand = updates[0]!;
      const deck = updates[1]!;
      const discard = updates[2]!;
      if (
        !sameCardOrder(discard.update.cardIds, [
          ...discard.zone.cardIds,
          ...hand.zone.cardIds,
        ]) ||
        !sameCardOrder(
          hand.update.cardIds,
          deck.zone.cardIds.slice(0, hand.update.cardIds.length)
        ) ||
        !sameCardOrder(
          deck.update.cardIds,
          deck.zone.cardIds.slice(hand.update.cardIds.length)
        )
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = hand.update.cardIds;
      normalizedIds = new Set([...hand.zone.cardIds, ...hand.update.cardIds]);
      visibilityRetiredIds = [...hand.zone.cardIds, ...hand.update.cardIds];
      break;
    }
    case 'shuffle-hand-into-deck-and-draw': {
      if (!exactKinds(['hand', 'deck']) || !sameNonNullOwner()) {
        invalidSemantics();
      }
      const hand = updates[0]!;
      const deck = updates[1]!;
      if (
        !sameCardSet(
          [...hand.update.cardIds, ...deck.update.cardIds],
          [...hand.zone.cardIds, ...deck.zone.cardIds]
        )
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = [...hand.update.cardIds, ...deck.update.cardIds];
      normalizedIds = new Set([...hand.zone.cardIds, ...hand.update.cardIds]);
      visibilityRetiredIds = [...hand.zone.cardIds, ...deck.zone.cardIds];
      break;
    }
    case 'shuffle-hand-to-deck-bottom-and-draw': {
      if (!exactKinds(['hand', 'deck']) || !sameNonNullOwner()) {
        invalidSemantics();
      }
      const hand = updates[0]!;
      const deck = updates[1]!;
      const resultingOrder = [...hand.update.cardIds, ...deck.update.cardIds];
      if (
        !sameCardOrder(
          resultingOrder.slice(0, deck.zone.cardIds.length),
          deck.zone.cardIds
        ) ||
        !sameCardSet(
          resultingOrder.slice(deck.zone.cardIds.length),
          hand.zone.cardIds
        )
      ) {
        invalidSemantics();
      }
      expectedConcealedIds = [
        ...new Set([...hand.zone.cardIds, ...hand.update.cardIds]),
      ];
      normalizedIds = new Set([...hand.zone.cardIds, ...hand.update.cardIds]);
      visibilityRetiredIds = [...hand.zone.cardIds, ...hand.update.cardIds];
      break;
    }
  }

  const concealedIds = new Set(event.concealedCardIds);
  if (
    concealedIds.size !== event.concealedCardIds.length ||
    !sameCardSet(concealedIds, expectedConcealedIds)
  ) {
    throw new Error('Zone order event has invalid concealed cards');
  }
  const zones = { ...state.zones };
  for (const { update, zone } of updates) {
    zones[zone.id] = { ...zone, cardIds: [...update.cardIds] };
  }
  return {
    zones,
    normalizedIds,
    concealedIds,
    visibilityRetiredIds: new Set(visibilityRetiredIds),
    destinationZoneByCard,
  };
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
          ? normalizeCardForZone(card, destination)
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
    visibility: retireVisibility(
      state,
      new Set([...workAreaCards, ...concealed]),
      event.destination === 'shuffleIntoDeck'
        ? new Set([...workAreaCardIds, ...destination.cardIds])
        : new Set(workAreaCardIds)
    ),
  };
};

interface DeferredConcealment {
  readonly zoneId: ZoneId;
  readonly cardIds: ReadonlySet<CardInstanceId>;
}

const eventConcealmentMatchesDestination = (
  event: { readonly cardId: CardInstanceId; readonly concealIdentity: boolean },
  destination: CardZone,
  deferredConcealment?: DeferredConcealment
): boolean =>
  event.concealIdentity ===
  (isConcealedZone(destination) &&
    !(
      deferredConcealment?.zoneId === destination.id &&
      deferredConcealment.cardIds.has(event.cardId)
    ));

const applyEventInternal = (
  state: MatchState,
  event: DomainEvent,
  deferredConcealment?: DeferredConcealment
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
      if (
        !Number.isSafeInteger(event.destinationIndex) ||
        event.destinationIndex < 0 ||
        event.destinationIndex > destination.cardIds.length ||
        !eventConcealmentMatchesDestination(
          event,
          destination,
          deferredConcealment
        ) ||
        (destination.kind === 'stadium' &&
          source.id !== destination.id &&
          destination.cardIds.length > 0)
      ) {
        throw new Error('Card move event has invalid destination semantics');
      }
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
      const normalizedCard = normalizeCardForZone(card, destination);
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
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
      };
    }
    case 'CardsDrawn': {
      const deckId = playerZoneId(event.playerId, 'deck');
      const handId = playerZoneId(event.playerId, 'hand');
      const deck = requireZone(state, deckId);
      const hand = requireZone(state, handId);
      if (
        event.cardIds.length === 0 ||
        event.cardIds.length > 200 ||
        new Set(event.cardIds).size !== event.cardIds.length ||
        deck.kind !== 'deck' ||
        deck.ownerId !== event.playerId ||
        hand.kind !== 'hand' ||
        hand.ownerId !== event.playerId ||
        hand.cardIds.length + event.cardIds.length > 200 ||
        event.cardIds.some((cardId, index) => deck.cardIds[index] !== cardId)
      ) {
        throw new Error('Draw event does not match current deck top');
      }
      const drawn = new Set(event.cardIds);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => {
            const normalized = drawn.has(card.id)
              ? normalizeCardForZone(card, hand)
              : card;
            return [
              cardId,
              drawn.has(card.id) ? incrementVisibility(normalized) : normalized,
            ];
          })
        ),
        zones: {
          ...state.zones,
          [deckId]: {
            ...deck,
            cardIds: deck.cardIds.slice(event.cardIds.length),
          },
          [handId]: { ...hand, cardIds: [...hand.cardIds, ...event.cardIds] },
        },
        visibility: retireVisibility(state, drawn, drawn),
      };
    }
    case 'RandomHandCardPlayedFaceDown': {
      const expectedHandId = playerZoneId(event.targetPlayerId, 'hand');
      const expectedBoardId = playerZoneId(event.targetPlayerId, 'board');
      const hand = state.zones[event.handZoneId];
      const board = state.zones[event.boardZoneId];
      const card = state.cards[event.cardId];
      if (
        !state.players[event.actorPlayerId] ||
        !state.players[event.targetPlayerId] ||
        !hand ||
        hand.id !== expectedHandId ||
        hand.ownerId !== event.targetPlayerId ||
        hand.kind !== 'hand' ||
        !board ||
        board.id !== expectedBoardId ||
        board.ownerId !== event.targetPlayerId ||
        board.kind !== 'board' ||
        event.expectedHandCardIds.length === 0 ||
        event.expectedHandCardIds.length > 200 ||
        event.expectedBoardCardIds.length >= 200 ||
        !sameCardOrder(hand.cardIds, event.expectedHandCardIds) ||
        !sameCardOrder(board.cardIds, event.expectedBoardCardIds) ||
        !card ||
        !hand.cardIds.includes(event.cardId) ||
        event.destinationIndex !== board.cardIds.length
      ) {
        throw new Error('Random face-down play event is malformed');
      }
      return {
        ...state,
        cards: {
          ...state.cards,
          [card.id]: incrementVisibility({
            ...card,
            face: 'down',
            orientationQuarterTurns: 0,
            abilityUsed: false,
          }),
        },
        zones: {
          ...state.zones,
          [hand.id]: {
            ...hand,
            cardIds: hand.cardIds.filter((cardId) => cardId !== card.id),
          },
          [board.id]: {
            ...board,
            cardIds: [...board.cardIds, card.id],
          },
        },
        visibility: {
          ...state.visibility,
          publicCardIds: state.visibility.publicCardIds.filter(
            (cardId) => cardId !== card.id
          ),
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
      const expectedConcealed = isConcealedZone(zone)
        ? [...event.cardOrder]
        : event.cardOrder.filter(
            (cardId) => state.cards[cardId]?.face === 'down'
          );
      const concealed = new Set(event.concealedCardIds);
      if (
        concealed.size !== event.concealedCardIds.length ||
        !sameCardSet(concealed, expectedConcealed)
      ) {
        throw new Error('Shuffle event conceals an invalid card');
      }
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => [
            cardId,
            concealed.has(card.id)
              ? incrementVisibility(
                  isConcealedZone(zone)
                    ? { ...card, face: 'up' as const }
                    : card
                )
              : card,
          ])
        ),
        zones: {
          ...state.zones,
          [event.zoneId]: { ...zone, cardIds: [...event.cardOrder] },
        },
        visibility: retireVisibility(state, concealed, new Set(zone.cardIds)),
      };
    }
    case 'ZoneOrdersSet': {
      const effects = deriveZoneOrderEffects(state, event);
      const publicRetiredIds = new Set([
        ...effects.normalizedIds,
        ...effects.concealedIds,
      ]);
      return {
        ...state,
        cards: Object.fromEntries(
          Object.entries(state.cards).map(([cardId, card]) => {
            const destinationZoneId = effects.destinationZoneByCard.get(
              card.id
            );
            const normalized =
              effects.normalizedIds.has(card.id) && destinationZoneId
                ? normalizeCardForZone(
                    card,
                    requireZone(state, destinationZoneId)
                  )
                : effects.concealedIds.has(card.id)
                  ? { ...card, face: 'up' as const }
                  : card;
            return [
              cardId,
              effects.concealedIds.has(card.id)
                ? incrementVisibility(normalized)
                : normalized,
            ];
          })
        ),
        zones: effects.zones,
        visibility: retireVisibility(
          state,
          publicRetiredIds,
          effects.visibilityRetiredIds
        ),
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
              ? normalizeCardForZone(card, destination)
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
        visibility: retireVisibility(
          state,
          new Set([...moved, ...concealed]),
          event.destination === 'shuffleIntoDeck'
            ? new Set([...moved, ...destination.cardIds])
            : moved
        ),
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
              visibility: retireVisibility(
                state,
                new Set([event.cardId]),
                new Set([event.cardId])
              ),
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
          visibility: retireVisibility(
            state,
            new Set([event.cardId]),
            new Set([event.cardId])
          ),
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
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
      };
    }
    case 'CardAttachedToPlayStack': {
      if (event.attachmentOrderVersion !== 1) {
        throw new Error('Unsupported attachment order version');
      }
      const source = requireZone(state, event.expectedSourceZoneId);
      if (!source.cardIds.includes(event.cardId)) {
        throw new Error(`Card ${event.cardId} is not in expected source zone`);
      }
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing card ${event.cardId}`);
      if (card.currentCategory === 'Pokémon') {
        throw new Error('Pokémon cannot use attachment event semantics');
      }
      const stack = requireStack(state, event.stackId);
      if (stack.boardPlayerId !== event.boardPlayerId) {
        throw new Error('Attachment target belongs to another board');
      }
      if (
        !sameCardOrder(stack.attachmentCardIds, event.expectedAttachmentCardIds)
      ) {
        throw new Error('Attachment event has stale card ordering');
      }
      const expectedAttachmentCardIds = orderAttachmentCardIdsV1(
        state.cards,
        stack.attachmentCardIds,
        event.cardId
      );
      if (!sameCardOrder(event.attachmentCardIds, expectedAttachmentCardIds)) {
        throw new Error('Attachment event has invalid v1 ordering');
      }
      return {
        ...state,
        cards: {
          ...state.cards,
          [event.cardId]: { ...card, face: 'up' },
        },
        zones: {
          ...state.zones,
          [source.id]: {
            ...source,
            cardIds: source.cardIds.filter((cardId) => cardId !== event.cardId),
          },
        },
        stacks: {
          ...state.stacks,
          [stack.id]: {
            ...stack,
            attachmentCardIds: [...event.attachmentCardIds],
          },
        },
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
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
      if (
        (destination.kind === 'stadium' && destination.cardIds.length > 0) ||
        !Number.isSafeInteger(event.destinationIndex) ||
        event.destinationIndex < 0 ||
        event.destinationIndex > destination.cardIds.length ||
        !eventConcealmentMatchesDestination(
          event,
          destination,
          deferredConcealment
        )
      ) {
        throw new Error('Stack departure has invalid destination semantics');
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing moved card ${event.cardId}`);
      const normalizedCard = normalizeCardForZone(card, destination);
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
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
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
      if (
        (destination.kind === 'stadium' && destination.cardIds.length > 0) ||
        !Number.isSafeInteger(event.destinationIndex) ||
        event.destinationIndex < 0 ||
        event.destinationIndex > destination.cardIds.length ||
        !eventConcealmentMatchesDestination(
          event,
          destination,
          deferredConcealment
        )
      ) {
        throw new Error(
          'Play stack departure has invalid destination semantics'
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
      const normalizedCard = normalizeCardForZone(departedCard, destination);
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
        visibility: retireVisibility(state, affectedCardIds, affectedCardIds),
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
      if (
        (destination.kind === 'stadium' && destination.cardIds.length > 0) ||
        !Number.isSafeInteger(event.destinationIndex) ||
        event.destinationIndex < 0 ||
        event.destinationIndex > destination.cardIds.length ||
        !eventConcealmentMatchesDestination(
          event,
          destination,
          deferredConcealment
        )
      ) {
        throw new Error(
          'Inspected card departure has invalid destination semantics'
        );
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
      const normalizedCard = normalizeCardForZone(card, destination);
      const nextCard = event.concealIdentity
        ? incrementVisibility(normalizedCard)
        : normalizedCard;
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
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
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
      if (
        (destination.kind === 'stadium' && destination.cardIds.length > 0) ||
        !Number.isSafeInteger(event.destinationIndex) ||
        event.destinationIndex < 0 ||
        event.destinationIndex > destination.cardIds.length ||
        !eventConcealmentMatchesDestination(
          event,
          destination,
          deferredConcealment
        )
      ) {
        throw new Error(
          'Staged card departure has invalid destination semantics'
        );
      }
      const destinationCards = [...destination.cardIds];
      destinationCards.splice(
        Math.min(event.destinationIndex, destinationCards.length),
        0,
        event.cardId
      );
      const card = state.cards[event.cardId];
      if (!card) throw new Error(`Missing staged card ${event.cardId}`);
      const normalizedCard = normalizeCardForZone(card, destination);
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
        visibility: retireVisibility(
          state,
          new Set([event.cardId]),
          new Set([event.cardId])
        ),
      };
    }
    case 'StagedStackRestored':
    case 'StagedStackRestoredToPlayStack': {
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
      let attachmentCardIds = resolution.attachmentCardIds;
      if (event.type === 'StagedStackRestoredToPlayStack') {
        if (event.attachmentOrderVersion !== 1) {
          throw new Error('Unsupported staged attachment order version');
        }
        const stagedCardIds = [
          ...resolution.evolutionCardIds,
          ...resolution.attachmentCardIds,
        ];
        if (
          new Set(stagedCardIds).size !== stagedCardIds.length ||
          stagedCardIds.some((cardId) => !state.cards[cardId])
        ) {
          throw new Error('Staged stack restore references invalid cards');
        }
        const expectedAttachmentCardIds = normalizeAttachmentCardIdsV1(
          state.cards,
          resolution.attachmentCardIds
        );
        if (
          !sameCardOrder(event.attachmentCardIds, expectedAttachmentCardIds)
        ) {
          throw new Error('Staged stack restore has invalid v1 ordering');
        }
        if (
          (event.destinationSlot !== 'active' &&
            event.destinationSlot !== 'bench') ||
          !Number.isSafeInteger(event.benchIndex) ||
          event.benchIndex < 0 ||
          event.benchIndex > board.benchStackIds.length
        ) {
          throw new Error('Staged stack restore has invalid placement');
        }
        attachmentCardIds = event.attachmentCardIds;
      }
      const nextStack: PlayStack = {
        id: event.stackId,
        boardPlayerId: event.playerId,
        slot: event.destinationSlot,
        evolutionCardIds: [...resolution.evolutionCardIds],
        attachmentCardIds: [...attachmentCardIds],
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
        !state.players[event.actorPlayerId] ||
        (event.scope !== 'card' && event.scope !== 'zone') ||
        !source ||
        source.id !== event.expectedSourceId ||
        source.playerId !== event.playerId ||
        !sameCardOrder(source.cardIds, event.expectedSourceCardIds) ||
        event.cardIds.some((cardId) => !source.cardIds.includes(cardId)) ||
        (event.scope === 'card' && event.cardIds.length !== 1) ||
        (event.scope === 'zone' &&
          (source.kind !== 'zone' || source.zoneKind !== 'prizes'))
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
    case 'InspectionGrantOpened': {
      const targetIds = new Set(event.cardIds);
      const viewers = new Set(event.viewerIds);
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
        event.cardIds.length > 200 ||
        targetIds.size !== event.cardIds.length ||
        event.expectedSourceCardIds.length > 200 ||
        event.viewerIds.length === 0 ||
        event.viewerIds.length > state.playerOrder.length ||
        viewers.size !== event.viewerIds.length ||
        Object.keys(state.visibility.inspectionGrants).length >= 200 ||
        state.visibility.inspectionGrants[event.inspectionId] ||
        Object.values(state.workAreas).some(
          (areas) => areas.inspection?.inspectionId === event.inspectionId
        ) ||
        (event.scope !== 'card' && event.scope !== 'zone') ||
        !source ||
        source.id !== event.sourceId ||
        source.playerId !== event.sourcePlayerId ||
        !sameCardOrder(source.cardIds, event.expectedSourceCardIds) ||
        event.cardIds.some((cardId) => !source.cardIds.includes(cardId)) ||
        (event.scope === 'card' && event.cardIds.length !== 1) ||
        (event.scope === 'zone' &&
          (source.kind !== 'zone' ||
            (source.zoneKind !== 'hand' && source.zoneKind !== 'prizes'))) ||
        event.viewerIds.some((viewerId) => !state.players[viewerId]) ||
        event.cardIds.some((cardId) => {
          const card = state.cards[cardId];
          return (
            !card ||
            event.viewerIds.some((viewerId) =>
              isCardKnownToViewer(
                state,
                { kind: 'player', playerId: viewerId },
                card
              )
            )
          );
        })
      ) {
        throw new Error('Private inspection grant event is malformed');
      }
      return {
        ...state,
        visibility: {
          ...state.visibility,
          inspectionGrants: {
            ...state.visibility.inspectionGrants,
            [event.inspectionId]: {
              inspectionId: event.inspectionId,
              scope: event.scope,
              sourcePlayerId: event.sourcePlayerId,
              sourceId: event.sourceId,
              cardIds: [...event.cardIds],
              viewerIds: [...event.viewerIds],
            },
          },
        },
      };
    }
    case 'InspectionGrantClosed': {
      const grant = state.visibility.inspectionGrants[event.inspectionId];
      if (
        !grant ||
        event.expectedCardIds.length > 200 ||
        event.expectedViewerIds.length > state.playerOrder.length ||
        grant.sourcePlayerId !== event.sourcePlayerId ||
        grant.scope !== event.scope ||
        grant.sourceId !== event.sourceId ||
        !sameCardOrder(grant.cardIds, event.expectedCardIds) ||
        !sameCardOrder(grant.viewerIds, event.expectedViewerIds) ||
        !grant.viewerIds.includes(event.viewerId)
      ) {
        throw new Error('Private inspection close event is malformed');
      }
      const remainingViewerIds = grant.viewerIds.filter(
        (viewerId) => viewerId !== event.viewerId
      );
      const inspectionGrants = { ...state.visibility.inspectionGrants };
      if (remainingViewerIds.length === 0) {
        delete inspectionGrants[event.inspectionId];
      } else {
        inspectionGrants[event.inspectionId] = {
          ...grant,
          viewerIds: remainingViewerIds,
        };
      }
      return {
        ...state,
        visibility: { ...state.visibility, inspectionGrants },
      };
    }
    case 'InspectionOpened': {
      const source = requireZone(state, event.sourceZoneId);
      const areas = state.workAreas[event.playerId];
      if (areas?.inspection) {
        throw new Error(`Player ${event.playerId} already has an inspection`);
      }
      if (
        state.visibility.inspectionGrants[event.inspectionId] ||
        Object.values(state.workAreas).some(
          (candidate) =>
            candidate.inspection?.inspectionId === event.inspectionId
        )
      ) {
        throw new Error(`Inspection ${event.inspectionId} already exists`);
      }
      const selected = new Set(event.cardIds);
      const isTop = sameCardOrder(
        event.cardIds,
        source.cardIds.slice(0, event.cardIds.length)
      );
      const isBottom = sameCardOrder(
        event.cardIds,
        source.cardIds.slice(source.cardIds.length - event.cardIds.length)
      );
      if (
        !areas ||
        source.id !== playerZoneId(event.playerId, 'deck') ||
        source.kind !== 'deck' ||
        source.ownerId !== event.playerId ||
        event.cardIds.length === 0 ||
        event.cardIds.length > 200 ||
        selected.size !== event.cardIds.length ||
        (!isTop && !isBottom) ||
        event.viewerIds.length === 0 ||
        event.viewerIds.length > state.playerOrder.length ||
        new Set(event.viewerIds).size !== event.viewerIds.length ||
        event.viewerIds.some((viewerId) => !state.players[viewerId]) ||
        event.workAreaId !==
          `work:${event.playerId}:inspection:${event.inspectionId}`
      ) {
        throw new Error('Inspection open event is malformed');
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
            ...areas,
            inspection: {
              id: event.workAreaId,
              inspectionId: event.inspectionId,
              sourceZoneId: event.sourceZoneId,
              cardIds: [...event.cardIds],
              viewerIds: [...event.viewerIds],
            },
          },
        },
        visibility: retireVisibility(state, selected, selected),
      };
    }
    case 'InspectionClosed': {
      const areas = state.workAreas[event.playerId];
      if (areas?.inspection?.inspectionId !== event.inspectionId) {
        throw new Error(`Inspection ${event.inspectionId} is not active`);
      }
      const destination = requireZone(state, event.destinationZoneId);
      const returned = new Set(areas.inspection.cardIds);
      const expectedTopOrder = [
        ...areas.inspection.cardIds,
        ...destination.cardIds,
      ];
      const expectedBottomOrder = [
        ...destination.cardIds,
        ...areas.inspection.cardIds,
      ];
      if (
        destination.id !== areas.inspection.sourceZoneId ||
        (!sameCardOrder(event.cardOrder, expectedTopOrder) &&
          !sameCardOrder(event.cardOrder, expectedBottomOrder)) ||
        event.concealIdentity !== isConcealedZone(destination)
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
            const normalized = normalizeCardForZone(card, destination);
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
        visibility: (() => {
          const retired = retireVisibility(state, returned, returned);
          const inspectionGrants = { ...retired.inspectionGrants };
          delete inspectionGrants[event.inspectionId];
          return { ...retired, inspectionGrants };
        })(),
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
    case 'UndoApplied': {
      if (
        event.fromRevision !== state.revision ||
        event.checkpointRevision !== event.restoredState.revision ||
        stableHash(event.restoredState) !== event.checkpointHash ||
        event.revertedCommandId.length < 1 ||
        event.revertedCommandId.length > 128 ||
        !Number.isSafeInteger(event.revertedRevision) ||
        event.revertedRevision !== event.checkpointRevision + 1 ||
        event.revertedRevision > event.fromRevision ||
        !state.players[event.actorPlayerId] ||
        !state.players[event.targetPlayerId] ||
        !event.restoredState.players[event.actorPlayerId] ||
        !event.restoredState.players[event.targetPlayerId] ||
        soloUndoCheckpointProblem(state, event.restoredState)
      ) {
        throw new Error('Undo event is malformed');
      }
      return {
        ...cloneMatchState(event.restoredState),
        // applyEventBatch owns the public monotonic revision. Keeping the
        // current value here ensures the next event in a malformed multi-event
        // batch cannot observe an old checkpoint revision.
        revision: state.revision,
      };
    }
    case 'CoinFlipped':
      return state;
  }
};

export const applyEvent = (state: MatchState, event: DomainEvent): MatchState =>
  applyEventInternal(state, event);

const pruneInvalidInspectionGrants = (state: MatchState): MatchState => {
  let changed = false;
  const inspectionGrants = Object.fromEntries(
    Object.entries(state.visibility.inspectionGrants).flatMap(
      ([inspectionId, grant]) => {
        const cardIds = grant.cardIds.filter((cardId) => {
          const card = state.cards[cardId];
          const location = card ? findCardLocation(state, cardId) : null;
          const source =
            card && location ? cardSourceSnapshot(state, card, location) : null;
          return source?.id === grant.sourceId;
        });
        if (cardIds.length !== grant.cardIds.length) changed = true;
        if (cardIds.length === 0) return [];
        return [[inspectionId, { ...grant, cardIds }]];
      }
    )
  ) as MatchState['visibility']['inspectionGrants'];
  return changed
    ? {
        ...state,
        visibility: { ...state.visibility, inspectionGrants },
      }
    : state;
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
  if (
    batch.events.some((event) => event.type === 'UndoApplied') &&
    (batch.events.length !== 1 || batch.events[0]?.type !== 'UndoApplied')
  ) {
    throw new Error('Undo event must be the only event in its batch');
  }
  let next = state;
  for (const [index, event] of batch.events.entries()) {
    const following = batch.events[index + 1];
    const deferredConcealment =
      following?.type === 'ZoneShuffled'
        ? {
            zoneId: following.zoneId,
            cardIds: new Set(following.concealedCardIds),
          }
        : undefined;
    next = pruneInvalidInspectionGrants(
      applyEventInternal(next, event, deferredConcealment)
    );
  }
  return { ...next, revision: batch.revision };
};
