import type {
  CommandContext,
  CommandRejection,
  GameCommand,
  WorkAreaCardsDestination,
} from './commands.js';
import { playerZoneId, stadiumZoneId } from './create-match.js';
import type { DomainEvent } from './events.js';
import { asWorkAreaId, type CardInstanceId, type PlayerId } from './ids.js';
import { findCardLocation } from './location.js';
import type {
  CardInstance,
  CardLocation,
  CardZone,
  MatchState,
  PlayStack,
} from './model.js';

export interface CommandAccepted {
  readonly accepted: true;
  readonly events: readonly DomainEvent[];
}

export type CommandDecision = CommandAccepted | CommandRejection;

const reject = (
  code: CommandRejection['code'],
  message: string
): CommandRejection => ({ accepted: false, code, message });

const accept = (...events: readonly DomainEvent[]): CommandAccepted => ({
  accepted: true,
  events,
});

const requirePlayer = (
  state: MatchState,
  playerId: PlayerId
): CommandRejection | null =>
  state.players[playerId]
    ? null
    : reject('not_found', `Player ${playerId} does not exist`);

const isConcealedZone = (zone: CardZone): boolean =>
  zone.kind === 'deck' || zone.kind === 'hand' || zone.kind === 'prizes';

const validatePermutation = <Value>(
  before: readonly Value[],
  after: readonly Value[]
): boolean => {
  if (before.length !== after.length) return false;
  const remaining = [...before];
  for (const value of after) {
    const index = remaining.indexOf(value);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
};

const validateRequestedCount = (count: number): CommandRejection | null =>
  Number.isSafeInteger(count) && count >= 0 && count <= 200
    ? null
    : reject('invalid_command', 'Card count must be an integer from 0 to 200');

type WorkAreaDestinationDecision =
  | CommandRejection
  | {
      readonly accepted: true;
      readonly destinationZoneId: CardZone['id'];
      readonly expectedDestinationCardIds: readonly CardInstanceId[];
      readonly destinationCardIds: readonly CardInstanceId[];
      readonly concealedCardIds: readonly CardInstanceId[];
    };

const decideWorkAreaDestination = (
  state: MatchState,
  playerId: PlayerId,
  cardIds: readonly CardInstanceId[],
  destinationMode: WorkAreaCardsDestination,
  context: CommandContext
): WorkAreaDestinationDecision => {
  const destinationKind =
    destinationMode === 'shuffleIntoDeck' ||
    destinationMode === 'shuffleToDeckBottom'
      ? 'deck'
      : destinationMode;
  const destination = state.zones[playerZoneId(playerId, destinationKind)];
  if (!destination) {
    return reject('not_found', 'Work-area destination does not exist');
  }
  if (destination.cardIds.length + cardIds.length > 200) {
    return reject(
      'precondition_failed',
      'Work-area destination cannot contain more than 200 cards'
    );
  }

  let destinationCardIds: readonly CardInstanceId[];
  let concealedCardIds: readonly CardInstanceId[];
  if (destinationMode === 'shuffleIntoDeck') {
    const combined = [...destination.cardIds, ...cardIds];
    destinationCardIds = context.shuffle(combined);
    if (!validatePermutation(combined, destinationCardIds)) {
      return reject(
        'invalid_command',
        'Shuffle adapter returned an invalid permutation'
      );
    }
    concealedCardIds = destinationCardIds;
  } else if (destinationMode === 'shuffleToDeckBottom') {
    const shuffled = context.shuffle(cardIds);
    if (!validatePermutation(cardIds, shuffled)) {
      return reject(
        'invalid_command',
        'Shuffle adapter returned an invalid permutation'
      );
    }
    destinationCardIds = [...destination.cardIds, ...shuffled];
    concealedCardIds = shuffled;
  } else {
    destinationCardIds = [...destination.cardIds, ...cardIds];
    concealedCardIds = destinationMode === 'hand' ? cardIds : [];
  }
  return {
    accepted: true,
    destinationZoneId: destination.id,
    expectedDestinationCardIds: [...destination.cardIds],
    destinationCardIds,
    concealedCardIds,
  };
};

const uniqueCardIds = (
  cardIds: readonly CardInstanceId[]
): readonly CardInstanceId[] => [...new Set(cardIds)];

const sameOrder = <Value>(
  left: readonly Value[],
  right: readonly Value[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

type DeckRelativeCommand = Extract<
  GameCommand,
  {
    readonly type:
      | 'MoveCardToDeckTop'
      | 'MoveCardToDeckBottom'
      | 'ShuffleCardIntoDeck'
      | 'SwapCardWithDeckTop';
  }
>;

type SourceRelativeCardCommand =
  | DeckRelativeCommand
  | Extract<GameCommand, { readonly type: 'ChangeCardCategory' }>;

type CardActionSource = {
  readonly accepted: true;
  readonly card: CardInstance;
  readonly location: CardLocation;
};

type DeckRelativeSource = CardActionSource & {
  readonly deck: CardZone;
};

const sourceIdForLocation = (
  state: MatchState,
  location: CardLocation
): string | null => {
  switch (location.kind) {
    case 'zone':
      return location.zoneId;
    case 'stackEvolution':
    case 'stackAttachment':
      return location.stackId;
    case 'inspectionWorkArea':
      return state.workAreas[location.playerId]?.inspection?.id ?? null;
    case 'attachmentResolutionWorkArea':
      return (
        state.workAreas[location.playerId]?.attachmentResolution?.id ?? null
      );
  }
};

const playerForLocation = (
  state: MatchState,
  card: CardInstance,
  location: CardLocation
): PlayerId | null => {
  switch (location.kind) {
    case 'zone':
      return state.zones[location.zoneId]?.ownerId ?? card.ownerId;
    case 'stackEvolution':
    case 'stackAttachment':
      return state.stacks[location.stackId]?.boardPlayerId ?? null;
    case 'inspectionWorkArea':
    case 'attachmentResolutionWorkArea':
      return location.playerId;
  }
};

const resolveCardActionSource = (
  state: MatchState,
  command: SourceRelativeCardCommand
): CardActionSource | CommandRejection => {
  const playerError = requirePlayer(state, command.playerId);
  if (playerError) return playerError;
  const card = state.cards[command.cardId];
  if (!card)
    return reject('not_found', `Card ${command.cardId} does not exist`);
  const location = findCardLocation(state, command.cardId);
  if (
    !location ||
    sourceIdForLocation(state, location) !== command.expectedSourceId ||
    playerForLocation(state, card, location) !== command.playerId
  ) {
    return reject('stale_reference', 'Card action source changed');
  }
  return { accepted: true, card, location };
};

const resolveDeckRelativeSource = (
  state: MatchState,
  command: DeckRelativeCommand
): DeckRelativeSource | CommandRejection => {
  const source = resolveCardActionSource(state, command);
  if (!source.accepted) return source;
  const deck = state.zones[playerZoneId(command.playerId, 'deck')];
  if (!deck) return reject('not_found', 'Player deck does not exist');
  return { ...source, deck };
};

type TopEvolutionDeparture =
  | CommandRejection
  | {
      readonly accepted: true;
      readonly event: Extract<
        DomainEvent,
        { readonly type: 'PlayStackDeparted' }
      >;
    };

const decideTopEvolutionDeparture = (
  state: MatchState,
  stack: PlayStack,
  cardId: CardInstanceId,
  destination: CardZone,
  destinationIndex: number,
  context: CommandContext,
  concealIdentity = isConcealedZone(destination)
): TopEvolutionDeparture => {
  if (stack.evolutionCardIds.at(-1) !== cardId) {
    return reject(
      'precondition_failed',
      'Only the top evolution card may leave a play stack directly'
    );
  }
  const evolutionCardIds = stack.evolutionCardIds.slice(0, -1);
  const attachmentCardIds = [...stack.attachmentCardIds];
  const hasDependents = evolutionCardIds.length + attachmentCardIds.length > 0;
  const areas = state.workAreas[stack.boardPlayerId];
  if (!areas) return reject('not_found', 'Play stack has no work areas');
  if (hasDependents && areas.attachmentResolution) {
    return reject(
      'conflict',
      'Resolve the existing attached-card work area first'
    );
  }
  const workAreaId = hasDependents ? context.nextWorkAreaId() : null;
  if (
    workAreaId &&
    Object.values(state.workAreas).some(
      (candidate) =>
        candidate.inspection?.id === workAreaId ||
        candidate.attachmentResolution?.id === workAreaId
    )
  ) {
    return reject(
      'conflict',
      `Work area ID factory returned duplicate ${workAreaId}`
    );
  }
  return {
    accepted: true,
    event: {
      type: 'PlayStackDeparted',
      cardId,
      expectedStackId: stack.id,
      boardPlayerId: stack.boardPlayerId,
      expectedEvolutionCardIds: [...stack.evolutionCardIds],
      expectedAttachmentCardIds: [...stack.attachmentCardIds],
      destinationZoneId: destination.id,
      destinationIndex,
      concealIdentity,
      attachmentResolution: workAreaId
        ? {
            id: workAreaId,
            evolutionCardIds,
            attachmentCardIds,
            suggestedSlot: stack.slot,
          }
        : null,
    },
  };
};

const decideCardDepartureToZone = (
  state: MatchState,
  source: CardActionSource,
  destination: CardZone,
  destinationIndex: number,
  context: CommandContext,
  concealIdentity = isConcealedZone(destination)
): CommandDecision => {
  const { card, location } = source;
  switch (location.kind) {
    case 'zone': {
      const zone = state.zones[location.zoneId]!;
      return accept({
        type: 'CardMoved',
        cardId: card.id,
        expectedSourceZoneId: zone.id,
        destinationZoneId: destination.id,
        destinationIndex,
        concealIdentity,
      });
    }
    case 'stackAttachment':
      return accept({
        type: 'CardMovedFromStack',
        cardId: card.id,
        expectedStackId: location.stackId,
        source: 'attachment',
        destinationZoneId: destination.id,
        destinationIndex,
        concealIdentity,
      });
    case 'stackEvolution': {
      const stack = state.stacks[location.stackId]!;
      const departure = decideTopEvolutionDeparture(
        state,
        stack,
        card.id,
        destination,
        destinationIndex,
        context,
        concealIdentity
      );
      return departure.accepted ? accept(departure.event) : departure;
    }
    case 'inspectionWorkArea': {
      const inspection = state.workAreas[location.playerId]?.inspection;
      if (!inspection) {
        return reject('stale_reference', 'Inspection work area changed');
      }
      return accept({
        type: 'InspectedCardMoved',
        playerId: location.playerId,
        inspectionId: inspection.inspectionId,
        expectedWorkAreaId: inspection.id,
        cardId: card.id,
        destinationZoneId: destination.id,
        destinationIndex,
        concealIdentity,
      });
    }
    case 'attachmentResolutionWorkArea': {
      const resolution =
        state.workAreas[location.playerId]?.attachmentResolution;
      if (!resolution) {
        return reject('stale_reference', 'Attached-card work area changed');
      }
      return accept({
        type: 'StagedCardMoved',
        playerId: location.playerId,
        expectedWorkAreaId: resolution.id,
        source: location.source,
        cardId: card.id,
        destinationZoneId: destination.id,
        destinationIndex,
        concealIdentity,
      });
    }
  }
};

const decideMoveCardToDeckEdge = (
  state: MatchState,
  command: Extract<
    GameCommand,
    { readonly type: 'MoveCardToDeckTop' | 'MoveCardToDeckBottom' }
  >,
  context: CommandContext
): CommandDecision => {
  const source = resolveDeckRelativeSource(state, command);
  if (!source.accepted) return source;
  const { card, location, deck } = source;
  const sourceIsDeck = location.kind === 'zone' && location.zoneId === deck.id;
  if (!sourceIsDeck && deck.cardIds.length >= 200) {
    return reject(
      'precondition_failed',
      'Deck cannot contain more than 200 cards'
    );
  }
  const edge = command.type === 'MoveCardToDeckTop' ? 'top' : 'bottom';
  if (sourceIsDeck) {
    const edgeIndex = edge === 'top' ? 0 : deck.cardIds.length - 1;
    if (location.index === edgeIndex) {
      return reject('invalid_command', `Card is already on deck ${edge}`);
    }
    const withoutCard = deck.cardIds.filter((cardId) => cardId !== card.id);
    return accept({
      type: 'ZoneOrdersSet',
      reason:
        edge === 'top' ? 'move-card-to-deck-top' : 'move-card-to-deck-bottom',
      zones: [
        {
          zoneId: deck.id,
          expectedCardIds: [...deck.cardIds],
          cardIds:
            edge === 'top'
              ? [card.id, ...withoutCard]
              : [...withoutCard, card.id],
        },
      ],
      concealedCardIds: [card.id],
    });
  }
  return decideCardDepartureToZone(
    state,
    source,
    deck,
    edge === 'top' ? 0 : deck.cardIds.length,
    context
  );
};

const decideShuffleCardIntoDeck = (
  state: MatchState,
  command: Extract<GameCommand, { readonly type: 'ShuffleCardIntoDeck' }>,
  context: CommandContext
): CommandDecision => {
  const source = resolveDeckRelativeSource(state, command);
  if (!source.accepted) return source;
  const { location, deck, card } = source;
  const sourceIsDeck = location.kind === 'zone' && location.zoneId === deck.id;
  if (!sourceIsDeck && deck.cardIds.length >= 200) {
    return reject(
      'precondition_failed',
      'Deck cannot contain more than 200 cards'
    );
  }
  const departure = sourceIsDeck
    ? null
    : decideCardDepartureToZone(
        state,
        source,
        deck,
        deck.cardIds.length,
        context,
        false
      );
  if (departure && !departure.accepted) return departure;
  const combined = sourceIsDeck
    ? [...deck.cardIds]
    : [...deck.cardIds, card.id];
  const shuffled = context.shuffle(combined);
  if (!validatePermutation(combined, shuffled)) {
    return reject(
      'invalid_command',
      'Shuffle adapter returned an invalid permutation'
    );
  }
  const shuffleEvent: DomainEvent = {
    type: 'ZoneShuffled',
    zoneId: deck.id,
    cardOrder: shuffled,
    concealedCardIds: shuffled,
  };
  if (sourceIsDeck) return accept(shuffleEvent);
  return {
    accepted: true,
    events: [...departure!.events, shuffleEvent],
  };
};

const decideChangeCardCategory = (
  state: MatchState,
  command: Extract<GameCommand, { readonly type: 'ChangeCardCategory' }>,
  context: CommandContext
): CommandDecision => {
  const source = resolveCardActionSource(state, command);
  if (!source.accepted) return source;
  if (!['Pokémon', 'Trainer', 'Energy'].includes(command.category)) {
    return reject('invalid_command', 'Unsupported card category');
  }
  const board = state.zones[playerZoneId(command.playerId, 'board')];
  if (!board) return reject('not_found', 'Player board zone does not exist');
  const sourceIsBoard =
    source.location.kind === 'zone' && source.location.zoneId === board.id;
  if (!sourceIsBoard && board.cardIds.length >= 200) {
    return reject(
      'precondition_failed',
      'Loose board cannot contain more than 200 cards'
    );
  }
  if (
    sourceIsBoard &&
    source.location.index === board.cardIds.length - 1 &&
    source.card.currentCategory === command.category &&
    source.card.orientationQuarterTurns === 0 &&
    !source.card.abilityUsed
  ) {
    return reject('invalid_command', 'Card annotation change is a no-op');
  }
  const departure = decideCardDepartureToZone(
    state,
    source,
    board,
    board.cardIds.length,
    context,
    false
  );
  if (!departure.accepted) return departure;
  const events: DomainEvent[] = [
    ...departure.events,
    {
      type: 'CardCategorySet',
      cardId: source.card.id,
      category: command.category,
    },
  ];
  if (source.card.orientationQuarterTurns !== 0) {
    events.push({
      type: 'CardOrientationSet',
      cardId: source.card.id,
      orientationQuarterTurns: 0,
    });
  }
  return { accepted: true, events };
};

const decideLoadDeck = (
  state: MatchState,
  command: Extract<GameCommand, { type: 'LoadDeck' }>,
  context: CommandContext
): CommandDecision => {
  const playerError = requirePlayer(state, command.playerId);
  if (playerError) return playerError;
  const totalCards = command.entries.reduce(
    (sum, entry) => sum + entry.count,
    0
  );
  if (!Number.isSafeInteger(totalCards) || totalCards < 0 || totalCards > 200) {
    return reject(
      'invalid_command',
      'Deck must contain between 0 and 200 cards'
    );
  }

  const definitionIds = new Set<string>();
  const definitions = [];
  const cards: CardInstance[] = [];
  const deckOrder: CardInstanceId[] = [];
  let copyIndex = 0;
  for (const entry of command.entries) {
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) {
      return reject(
        'invalid_command',
        'Deck quantities must be positive integers'
      );
    }
    if (definitionIds.has(entry.definition.id)) {
      return reject(
        'invalid_command',
        `Duplicate deck definition ${entry.definition.id}`
      );
    }
    definitionIds.add(entry.definition.id);
    definitions.push(entry.definition);
    for (let index = 0; index < entry.count; index += 1) {
      const cardId = context.nextCardId(entry.definition.id, copyIndex++);
      if (state.cards[cardId] || cards.some((card) => card.id === cardId)) {
        return reject(
          'conflict',
          `Card ID factory returned duplicate ${cardId}`
        );
      }
      const card: CardInstance = {
        id: cardId,
        definitionId: entry.definition.id,
        ownerId: command.playerId,
        originalCategory: entry.definition.category,
        currentCategory: entry.definition.category,
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
        visibilityGeneration: 0,
      };
      cards.push(card);
      deckOrder.push(card.id);
    }
  }
  return accept({
    type: 'DeckLoaded',
    playerId: command.playerId,
    definitions,
    cards,
    deckOrder,
  });
};

export const decideCommand = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): CommandDecision => {
  switch (command.type) {
    case 'LoadDeck':
      return decideLoadDeck(state, command, context);
    case 'ResetPlayer': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      return accept({
        type: 'PlayerReset',
        playerId: command.playerId,
        deckOrder: [...(state.deckLists[command.playerId] ?? [])],
      });
    }
    case 'SetupPlayer': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const baseline = state.deckLists[command.playerId] ?? [];
      const shuffled = context.shuffle(baseline);
      if (!validatePermutation(baseline, shuffled)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      const handCount = Math.min(7, shuffled.length);
      const handOrder = shuffled.slice(0, handCount);
      const prizeCount = Math.min(6, shuffled.length - handCount);
      const prizeOrder = shuffled.slice(handCount, handCount + prizeCount);
      const deckOrder = shuffled.slice(handCount + prizeCount);
      return accept({
        type: 'PlayerSetup',
        playerId: command.playerId,
        deckOrder,
        handOrder,
        prizeOrder,
      });
    }
    case 'MoveCard': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      if (
        !location ||
        location.kind !== 'zone' ||
        location.zoneId !== command.expectedSourceZoneId
      ) {
        return reject(
          'stale_reference',
          'Card is no longer in the expected source zone'
        );
      }
      const source = state.zones[command.expectedSourceZoneId];
      const destination = state.zones[command.destinationZoneId];
      if (!source || !destination) {
        return reject('not_found', 'Source or destination zone does not exist');
      }
      const destinationIndex = Math.max(
        0,
        Math.min(
          command.destinationIndex ?? destination.cardIds.length,
          destination.cardIds.length
        )
      );
      const events: DomainEvent[] = [];
      if (
        destination.id === stadiumZoneId() &&
        destination.cardIds.length > 0
      ) {
        const displacedId = destination.cardIds[0]!;
        const displaced = state.cards[displacedId];
        if (!displaced)
          return reject('precondition_failed', 'Stadium card is missing');
        const discardId = playerZoneId(displaced.ownerId, 'discard');
        events.push({
          type: 'CardMoved',
          cardId: displaced.id,
          expectedSourceZoneId: destination.id,
          destinationZoneId: discardId,
          destinationIndex: state.zones[discardId]?.cardIds.length ?? 0,
          concealIdentity: false,
        });
      }
      events.push({
        type: 'CardMoved',
        cardId: card.id,
        expectedSourceZoneId: source.id,
        destinationZoneId: destination.id,
        destinationIndex,
        concealIdentity: isConcealedZone(destination),
      });
      return { accepted: true, events };
    }
    case 'MoveCardToPlay': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      if (
        !location ||
        location.kind !== 'zone' ||
        location.zoneId !== command.expectedSourceZoneId
      ) {
        return reject(
          'stale_reference',
          'Card is no longer in the expected source zone'
        );
      }
      const board = state.boards[command.boardPlayerId];
      if (!board)
        return reject(
          'not_found',
          `Board ${command.boardPlayerId} does not exist`
        );
      if (command.targetStackId) {
        const stack = state.stacks[command.targetStackId];
        if (!stack || stack.boardPlayerId !== command.boardPlayerId) {
          return reject(
            'stale_reference',
            'Target stack no longer exists on this board'
          );
        }
        return accept({
          type: 'CardMovedToPlay',
          cardId: card.id,
          expectedSourceZoneId: command.expectedSourceZoneId,
          boardPlayerId: command.boardPlayerId,
          slot: stack.slot,
          mode: card.currentCategory === 'Pokémon' ? 'evolution' : 'attachment',
          stackId: stack.id,
          benchIndex: board.benchStackIds.indexOf(stack.id),
          previousActiveToBench: false,
        });
      }
      const stackId = context.nextStackId();
      if (state.stacks[stackId]) {
        return reject(
          'conflict',
          `Stack ID factory returned duplicate ${stackId}`
        );
      }
      return accept({
        type: 'CardMovedToPlay',
        cardId: card.id,
        expectedSourceZoneId: command.expectedSourceZoneId,
        boardPlayerId: command.boardPlayerId,
        slot: command.slot,
        mode: 'newStack',
        stackId,
        benchIndex: Math.max(
          0,
          Math.min(
            command.benchIndex ?? board.benchStackIds.length,
            board.benchStackIds.length
          )
        ),
        previousActiveToBench:
          command.slot === 'active' && board.activeStackId !== null,
      });
    }
    case 'MoveCardFromStack': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      if (
        !location ||
        (location.kind !== 'stackEvolution' &&
          location.kind !== 'stackAttachment') ||
        location.stackId !== command.expectedStackId
      ) {
        return reject(
          'stale_reference',
          'Card is no longer in the expected play stack'
        );
      }
      const stack = state.stacks[command.expectedStackId];
      const destination = state.zones[command.destinationZoneId];
      if (!stack || !destination) {
        return reject('not_found', 'Stack or destination zone does not exist');
      }
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        return reject(
          'precondition_failed',
          'Resolve the existing stadium before this departure'
        );
      }
      const destinationIndex = Math.max(
        0,
        Math.min(
          command.destinationIndex ?? destination.cardIds.length,
          destination.cardIds.length
        )
      );
      if (location.kind === 'stackAttachment') {
        return accept({
          type: 'CardMovedFromStack',
          cardId: card.id,
          expectedStackId: stack.id,
          source: 'attachment',
          destinationZoneId: destination.id,
          destinationIndex,
          concealIdentity: isConcealedZone(destination),
        });
      }
      const departure = decideTopEvolutionDeparture(
        state,
        stack,
        card.id,
        destination,
        destinationIndex,
        context
      );
      return departure.accepted ? accept(departure.event) : departure;
    }
    case 'MovePlayStack': {
      const stack = state.stacks[command.stackId];
      if (!stack) {
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      }
      if (stack.slot !== command.expectedSourceSlot) {
        return reject('stale_reference', 'Play stack source slot changed');
      }
      const board = state.boards[stack.boardPlayerId];
      if (!board) {
        return reject('not_found', 'Play stack board does not exist');
      }
      if (
        board.activeStackId !== command.expectedActiveStackId ||
        !sameOrder(board.benchStackIds, command.expectedBenchStackIds)
      ) {
        return reject('stale_reference', 'Play stack board layout changed');
      }
      const sourceBenchIndex = board.benchStackIds.indexOf(stack.id);
      if (
        (stack.slot === 'active' && board.activeStackId !== stack.id) ||
        (stack.slot === 'bench' && sourceBenchIndex < 0)
      ) {
        return reject('stale_reference', 'Play stack placement changed');
      }
      const target = command.targetStackId
        ? state.stacks[command.targetStackId]
        : undefined;
      if (command.targetStackId && !target) {
        return reject('stale_reference', 'Target play stack no longer exists');
      }
      if (
        target &&
        (target.id === stack.id ||
          target.boardPlayerId !== stack.boardPlayerId ||
          target.slot !== command.destinationSlot)
      ) {
        return reject('stale_reference', 'Target play stack placement changed');
      }

      let activeStackId = board.activeStackId;
      const benchStackIds = [...board.benchStackIds];
      if (target) {
        if (stack.slot === 'active') {
          const targetIndex = benchStackIds.indexOf(target.id);
          if (targetIndex < 0) {
            return reject('stale_reference', 'Target bench stack moved');
          }
          activeStackId = target.id;
          benchStackIds[targetIndex] = stack.id;
        } else if (target.slot === 'active') {
          activeStackId = stack.id;
          benchStackIds[sourceBenchIndex] = target.id;
        } else {
          const targetIndex = benchStackIds.indexOf(target.id);
          if (targetIndex < 0) {
            return reject('stale_reference', 'Target bench stack moved');
          }
          benchStackIds[sourceBenchIndex] = target.id;
          benchStackIds[targetIndex] = stack.id;
        }
      } else if (command.destinationSlot === 'active') {
        if (stack.slot === 'active') {
          return reject('invalid_command', 'Play stack is already active');
        }
        benchStackIds.splice(sourceBenchIndex, 1);
        if (activeStackId) benchStackIds.push(activeStackId);
        activeStackId = stack.id;
      } else if (stack.slot === 'active') {
        activeStackId = null;
        benchStackIds.push(stack.id);
        if (benchStackIds.length === 2) {
          activeStackId = benchStackIds.shift()!;
        }
      } else {
        benchStackIds.splice(sourceBenchIndex, 1);
        benchStackIds.push(stack.id);
      }

      if (
        activeStackId === board.activeStackId &&
        sameOrder(benchStackIds, board.benchStackIds)
      ) {
        return reject('invalid_command', 'Play stack move is a no-op');
      }
      return accept({
        type: 'PlayStackLayoutSet',
        boardPlayerId: stack.boardPlayerId,
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        activeStackId,
        benchStackIds,
      });
    }
    case 'MoveInspectedCard': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      if (!location || location.kind !== 'inspectionWorkArea') {
        return reject(
          'stale_reference',
          'Card is no longer in an inspection work area'
        );
      }
      const inspection = state.workAreas[location.playerId]?.inspection;
      if (!inspection || inspection.id !== command.expectedWorkAreaId) {
        return reject('stale_reference', 'Inspection work area changed');
      }
      const destination = state.zones[command.destinationZoneId];
      if (!destination) {
        return reject('not_found', 'Destination zone does not exist');
      }
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        return reject(
          'precondition_failed',
          'Resolve the existing stadium before moving an inspected card'
        );
      }
      return accept({
        type: 'InspectedCardMoved',
        playerId: location.playerId,
        inspectionId: inspection.inspectionId,
        expectedWorkAreaId: inspection.id,
        cardId: card.id,
        destinationZoneId: destination.id,
        destinationIndex: Math.max(
          0,
          Math.min(
            command.destinationIndex ?? destination.cardIds.length,
            destination.cardIds.length
          )
        ),
        concealIdentity: isConcealedZone(destination),
      });
    }
    case 'MoveStagedCard': {
      const card = state.cards[command.cardId];
      if (!card) {
        return reject('not_found', `Card ${command.cardId} does not exist`);
      }
      const location = findCardLocation(state, command.cardId);
      if (!location || location.kind !== 'attachmentResolutionWorkArea') {
        return reject(
          'stale_reference',
          'Card is no longer in an attached-card work area'
        );
      }
      const resolution =
        state.workAreas[location.playerId]?.attachmentResolution;
      if (!resolution || resolution.id !== command.expectedWorkAreaId) {
        return reject('stale_reference', 'Attached-card work area changed');
      }
      const destination = state.zones[command.destinationZoneId];
      if (!destination) {
        return reject('not_found', 'Destination zone does not exist');
      }
      if (destination.kind === 'stadium' && destination.cardIds.length > 0) {
        return reject(
          'precondition_failed',
          'Resolve the existing stadium before moving a staged card'
        );
      }
      return accept({
        type: 'StagedCardMoved',
        playerId: location.playerId,
        expectedWorkAreaId: resolution.id,
        source: location.source,
        cardId: card.id,
        destinationZoneId: destination.id,
        destinationIndex: Math.max(
          0,
          Math.min(
            command.destinationIndex ?? destination.cardIds.length,
            destination.cardIds.length
          )
        ),
        concealIdentity: isConcealedZone(destination),
      });
    }
    case 'RestoreStagedStack': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const areas = state.workAreas[command.playerId];
      const resolution = areas?.attachmentResolution;
      if (!resolution || resolution.id !== command.expectedWorkAreaId) {
        return reject('stale_reference', 'Attached-card work area changed');
      }
      if (resolution.evolutionCardIds.length === 0) {
        return reject(
          'precondition_failed',
          'At least one staged Pokémon is required to restore a play stack'
        );
      }
      const board = state.boards[command.playerId];
      if (!board) return reject('not_found', 'Player board does not exist');
      if (
        board.activeStackId !== command.expectedActiveStackId ||
        !sameOrder(board.benchStackIds, command.expectedBenchStackIds)
      ) {
        return reject('stale_reference', 'Player board layout changed');
      }
      const stackId = context.nextStackId();
      if (state.stacks[stackId]) {
        return reject(
          'conflict',
          `Stack ID factory returned duplicate ${stackId}`
        );
      }
      return accept({
        type: 'StagedStackRestored',
        playerId: command.playerId,
        expectedWorkAreaId: resolution.id,
        expectedEvolutionCardIds: [...resolution.evolutionCardIds],
        expectedAttachmentCardIds: [...resolution.attachmentCardIds],
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        stackId,
        destinationSlot: command.destinationSlot,
        benchIndex: Math.max(
          0,
          Math.min(
            command.benchIndex ?? board.benchStackIds.length,
            board.benchStackIds.length
          )
        ),
      });
    }
    case 'ResolveStagedCards': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const resolution =
        state.workAreas[command.playerId]?.attachmentResolution;
      if (!resolution || resolution.id !== command.expectedWorkAreaId) {
        return reject('stale_reference', 'Attached-card work area changed');
      }
      const stagedCardIds = [
        ...resolution.evolutionCardIds,
        ...resolution.attachmentCardIds,
      ];
      const destination = decideWorkAreaDestination(
        state,
        command.playerId,
        stagedCardIds,
        command.destination,
        context
      );
      if (!destination.accepted) return destination;
      return accept({
        type: 'StagedCardsResolved',
        playerId: command.playerId,
        expectedWorkAreaId: resolution.id,
        expectedEvolutionCardIds: [...resolution.evolutionCardIds],
        expectedAttachmentCardIds: [...resolution.attachmentCardIds],
        destination: command.destination,
        destinationZoneId: destination.destinationZoneId,
        expectedDestinationCardIds: destination.expectedDestinationCardIds,
        destinationCardIds: destination.destinationCardIds,
        concealedCardIds: destination.concealedCardIds,
      });
    }
    case 'ResolveInspectionCards': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const inspection = state.workAreas[command.playerId]?.inspection;
      if (!inspection || inspection.id !== command.expectedWorkAreaId) {
        return reject('stale_reference', 'Inspection work area changed');
      }
      const destination = decideWorkAreaDestination(
        state,
        command.playerId,
        inspection.cardIds,
        command.destination,
        context
      );
      if (!destination.accepted) return destination;
      return accept({
        type: 'InspectionCardsResolved',
        playerId: command.playerId,
        inspectionId: inspection.inspectionId,
        expectedWorkAreaId: inspection.id,
        expectedCardIds: [...inspection.cardIds],
        destination: command.destination,
        destinationZoneId: destination.destinationZoneId,
        expectedDestinationCardIds: destination.expectedDestinationCardIds,
        destinationCardIds: destination.destinationCardIds,
        concealedCardIds: destination.concealedCardIds,
      });
    }
    case 'MoveCardToDeckTop':
    case 'MoveCardToDeckBottom':
      return decideMoveCardToDeckEdge(state, command, context);
    case 'ShuffleCardIntoDeck':
      return decideShuffleCardIntoDeck(state, command, context);
    case 'ChangeCardCategory':
      return decideChangeCardCategory(state, command, context);
    case 'SwapCardWithDeckTop': {
      const source = resolveDeckRelativeSource(state, command);
      if (!source.accepted) return source;
      const { card, location, deck } = source;
      if (deck.cardIds.length === 0) {
        return reject('precondition_failed', 'Deck is empty');
      }
      if (location.kind === 'zone' && location.zoneId === deck.id) {
        return reject(
          'invalid_command',
          'Deck cards cannot swap with deck top'
        );
      }
      const deckTopCardId = deck.cardIds[0]!;
      switch (location.kind) {
        case 'zone': {
          const zone = state.zones[location.zoneId]!;
          return accept(
            {
              type: 'CardMoved',
              cardId: card.id,
              expectedSourceZoneId: zone.id,
              destinationZoneId: deck.id,
              destinationIndex: 0,
              concealIdentity: true,
            },
            {
              type: 'CardMoved',
              cardId: deckTopCardId,
              expectedSourceZoneId: deck.id,
              destinationZoneId: zone.id,
              destinationIndex: location.index,
              concealIdentity: isConcealedZone(zone),
            }
          );
        }
        case 'inspectionWorkArea': {
          const inspection = state.workAreas[location.playerId]?.inspection;
          if (!inspection) {
            return reject('stale_reference', 'Inspection work area changed');
          }
          return accept({
            type: 'InspectionCardSwappedWithDeckTop',
            playerId: location.playerId,
            inspectionId: inspection.inspectionId,
            expectedWorkAreaId: inspection.id,
            cardId: card.id,
            deckTopCardId,
            expectedInspectionCardIds: [...inspection.cardIds],
            expectedDeckCardIds: [...deck.cardIds],
          });
        }
        case 'attachmentResolutionWorkArea': {
          const resolution =
            state.workAreas[location.playerId]?.attachmentResolution;
          if (!resolution) {
            return reject('stale_reference', 'Attached-card work area changed');
          }
          return accept({
            type: 'StagedCardSwappedWithDeckTop',
            playerId: location.playerId,
            expectedWorkAreaId: resolution.id,
            source: location.source,
            cardId: card.id,
            deckTopCardId,
            expectedEvolutionCardIds: [...resolution.evolutionCardIds],
            expectedAttachmentCardIds: [...resolution.attachmentCardIds],
            expectedDeckCardIds: [...deck.cardIds],
          });
        }
        case 'stackEvolution':
        case 'stackAttachment': {
          const stack = state.stacks[location.stackId]!;
          const board = state.boards[stack.boardPlayerId];
          if (!board)
            return reject('not_found', 'Play stack board does not exist');
          if (
            location.kind === 'stackEvolution' &&
            location.index !== stack.evolutionCardIds.length - 1
          ) {
            return reject(
              'precondition_failed',
              'Only the top evolution card may leave a play stack directly'
            );
          }
          const replacementStackId = context.nextStackId();
          if (state.stacks[replacementStackId]) {
            return reject(
              'conflict',
              `Stack ID factory returned duplicate ${replacementStackId}`
            );
          }
          const sourceBenchIndex = board.benchStackIds.indexOf(stack.id);
          if (
            (stack.slot === 'active' && board.activeStackId !== stack.id) ||
            (stack.slot === 'bench' && sourceBenchIndex < 0)
          ) {
            return reject('stale_reference', 'Play stack placement changed');
          }
          if (location.kind === 'stackAttachment') {
            return accept(
              {
                type: 'CardMovedFromStack',
                cardId: card.id,
                expectedStackId: stack.id,
                source: 'attachment',
                destinationZoneId: deck.id,
                destinationIndex: 0,
                concealIdentity: true,
              },
              {
                type: 'CardMovedToPlay',
                cardId: deckTopCardId,
                expectedSourceZoneId: deck.id,
                boardPlayerId: stack.boardPlayerId,
                slot: stack.slot,
                mode: 'newStack',
                stackId: replacementStackId,
                benchIndex: board.benchStackIds.length,
                previousActiveToBench: stack.slot === 'active',
              }
            );
          }
          const departure = decideTopEvolutionDeparture(
            state,
            stack,
            card.id,
            deck,
            0,
            context
          );
          if (!departure.accepted) return departure;
          return accept(departure.event, {
            type: 'CardMovedToPlay',
            cardId: deckTopCardId,
            expectedSourceZoneId: deck.id,
            boardPlayerId: stack.boardPlayerId,
            slot: stack.slot,
            mode: 'newStack',
            stackId: replacementStackId,
            benchIndex: Math.max(0, sourceBenchIndex),
            previousActiveToBench: false,
          });
        }
      }
    }
    case 'MovePrizesToDeckBottom': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const prizes = state.zones[playerZoneId(command.playerId, 'prizes')];
      const deck = state.zones[playerZoneId(command.playerId, 'deck')];
      if (!prizes || !deck)
        return reject('not_found', 'Player zone is missing');
      if (prizes.cardIds.length === 0) {
        return reject('precondition_failed', 'Prize zone is empty');
      }
      const shuffledPrizes = context.shuffle(prizes.cardIds);
      if (!validatePermutation(prizes.cardIds, shuffledPrizes)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'move-prizes-to-deck-bottom',
        zones: [
          {
            zoneId: prizes.id,
            expectedCardIds: [...prizes.cardIds],
            cardIds: [],
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: [...deck.cardIds, ...shuffledPrizes],
          },
        ],
        concealedCardIds: shuffledPrizes,
      });
    }
    case 'ShuffleZone': {
      const zone = state.zones[command.zoneId];
      if (!zone)
        return reject('not_found', `Zone ${command.zoneId} does not exist`);
      const cardOrder = context.shuffle(zone.cardIds);
      if (!validatePermutation(zone.cardIds, cardOrder)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      return accept({
        type: 'ZoneShuffled',
        zoneId: zone.id,
        cardOrder,
        concealedCardIds: isConcealedZone(zone) ? cardOrder : [],
      });
    }
    case 'DrawCards': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      if (!Number.isSafeInteger(command.count) || command.count <= 0) {
        return reject(
          'invalid_command',
          'Draw count must be a positive integer'
        );
      }
      const deck = state.zones[playerZoneId(command.playerId, 'deck')];
      if (!deck || deck.cardIds.length === 0) {
        return reject('precondition_failed', 'Deck is empty');
      }
      return accept({
        type: 'CardsDrawn',
        playerId: command.playerId,
        cardIds: deck.cardIds.slice(
          0,
          Math.min(command.count, deck.cardIds.length)
        ),
      });
    }
    case 'MoveZoneContents': {
      const source = state.zones[command.sourceZoneId];
      const destination = state.zones[command.destinationZoneId];
      if (!source || !destination) {
        return reject('not_found', 'Source or destination zone does not exist');
      }
      if (source.id === destination.id) {
        return reject('invalid_command', 'Source and destination must differ');
      }
      if (source.kind === 'board' || destination.kind === 'board') {
        return reject(
          'precondition_failed',
          'Loose-board batches require the semantic loose-board command'
        );
      }
      if (
        destination.kind === 'stadium' &&
        source.cardIds.length + destination.cardIds.length > 1
      ) {
        return reject('precondition_failed', 'Stadium accepts one card');
      }
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'move-zone-contents',
        zones: [
          {
            zoneId: source.id,
            expectedCardIds: [...source.cardIds],
            cardIds: [],
          },
          {
            zoneId: destination.id,
            expectedCardIds: [...destination.cardIds],
            cardIds: [...destination.cardIds, ...source.cardIds],
          },
        ],
        concealedCardIds: isConcealedZone(destination)
          ? [...source.cardIds]
          : [],
      });
    }
    case 'ResolveLooseBoardCards': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const board = state.zones[playerZoneId(command.playerId, 'board')];
      if (!board) return reject('not_found', 'Loose board does not exist');
      if (!sameOrder(board.cardIds, command.expectedBoardCardIds)) {
        return reject('stale_reference', 'Loose board contents changed');
      }
      if (board.cardIds.length === 0) {
        return reject('precondition_failed', 'Loose board is empty');
      }
      const destinationKind =
        command.destination === 'shuffleIntoDeck'
          ? 'deck'
          : command.destination;
      const destination =
        state.zones[playerZoneId(command.playerId, destinationKind)];
      if (!destination) {
        return reject('not_found', 'Loose-board destination does not exist');
      }
      if (destination.cardIds.length + board.cardIds.length > 200) {
        return reject(
          'precondition_failed',
          'Loose-board destination cannot contain more than 200 cards'
        );
      }
      const combined = [...destination.cardIds, ...board.cardIds];
      const destinationCardIds =
        command.destination === 'shuffleIntoDeck'
          ? context.shuffle(combined)
          : combined;
      if (
        command.destination === 'shuffleIntoDeck' &&
        !validatePermutation(combined, destinationCardIds)
      ) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      return accept({
        type: 'LooseBoardCardsResolved',
        playerId: command.playerId,
        destination: command.destination,
        boardZoneId: board.id,
        destinationZoneId: destination.id,
        expectedBoardCardIds: [...board.cardIds],
        expectedDestinationCardIds: [...destination.cardIds],
        destinationCardIds,
        concealedCardIds:
          command.destination === 'shuffleIntoDeck'
            ? destinationCardIds
            : command.destination === 'hand'
              ? [...board.cardIds]
              : [],
      });
    }
    case 'ShuffleZoneIntoDeck': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const source = state.zones[command.sourceZoneId];
      const deck = state.zones[playerZoneId(command.playerId, 'deck')];
      if (!source || !deck) return reject('not_found', 'Zone does not exist');
      if (source.ownerId !== command.playerId) {
        return reject('precondition_failed', 'Source is not owned by player');
      }
      if (source.kind === 'board') {
        return reject(
          'precondition_failed',
          'Loose-board shuffles require the semantic loose-board command'
        );
      }
      const combined =
        source.id === deck.id
          ? [...deck.cardIds]
          : [...deck.cardIds, ...source.cardIds];
      const shuffled = context.shuffle(combined);
      if (!validatePermutation(combined, shuffled)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      if (source.id === deck.id) {
        return accept({
          type: 'ZoneShuffled',
          zoneId: deck.id,
          cardOrder: shuffled,
          concealedCardIds: shuffled,
        });
      }
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'shuffle-zone-into-deck',
        zones: [
          {
            zoneId: source.id,
            expectedCardIds: [...source.cardIds],
            cardIds: [],
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: shuffled,
          },
        ],
        concealedCardIds: shuffled,
      });
    }
    case 'ShuffleZoneToDeckBottom': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const source = state.zones[command.sourceZoneId];
      const deck = state.zones[playerZoneId(command.playerId, 'deck')];
      if (!source || !deck) return reject('not_found', 'Zone does not exist');
      if (source.kind === 'board') {
        return reject(
          'precondition_failed',
          'Loose-board shuffles require the semantic loose-board command'
        );
      }
      if (source.id === deck.id) {
        return reject('invalid_command', 'Source cannot be the deck');
      }
      if (source.ownerId !== command.playerId) {
        return reject('precondition_failed', 'Source is not owned by player');
      }
      const shuffledSource = context.shuffle(source.cardIds);
      if (!validatePermutation(source.cardIds, shuffledSource)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'shuffle-zone-to-deck-bottom',
        zones: [
          {
            zoneId: source.id,
            expectedCardIds: [...source.cardIds],
            cardIds: [],
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: [...deck.cardIds, ...shuffledSource],
          },
        ],
        concealedCardIds: shuffledSource,
      });
    }
    case 'DiscardHandAndDraw': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const countError = validateRequestedCount(command.count);
      if (countError) return countError;
      const hand = state.zones[playerZoneId(command.playerId, 'hand')]!;
      const deck = state.zones[playerZoneId(command.playerId, 'deck')]!;
      const discard = state.zones[playerZoneId(command.playerId, 'discard')]!;
      const drawCount = Math.min(command.count, deck.cardIds.length);
      const drawn = deck.cardIds.slice(0, drawCount);
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'discard-hand-and-draw',
        zones: [
          {
            zoneId: hand.id,
            expectedCardIds: [...hand.cardIds],
            cardIds: drawn,
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: deck.cardIds.slice(drawCount),
          },
          {
            zoneId: discard.id,
            expectedCardIds: [...discard.cardIds],
            cardIds: [...discard.cardIds, ...hand.cardIds],
          },
        ],
        concealedCardIds: drawn,
      });
    }
    case 'ShuffleHandIntoDeckAndDraw': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const countError = validateRequestedCount(command.count);
      if (countError) return countError;
      const hand = state.zones[playerZoneId(command.playerId, 'hand')]!;
      const deck = state.zones[playerZoneId(command.playerId, 'deck')]!;
      const combined = [...deck.cardIds, ...hand.cardIds];
      const shuffled = context.shuffle(combined);
      if (!validatePermutation(combined, shuffled)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      const drawCount = Math.min(command.count, shuffled.length);
      const drawn = shuffled.slice(0, drawCount);
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'shuffle-hand-into-deck-and-draw',
        zones: [
          {
            zoneId: hand.id,
            expectedCardIds: [...hand.cardIds],
            cardIds: drawn,
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: shuffled.slice(drawCount),
          },
        ],
        concealedCardIds: shuffled,
      });
    }
    case 'ShuffleHandToDeckBottomAndDraw': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const countError = validateRequestedCount(command.count);
      if (countError) return countError;
      const hand = state.zones[playerZoneId(command.playerId, 'hand')]!;
      const deck = state.zones[playerZoneId(command.playerId, 'deck')]!;
      const shuffledHand = context.shuffle(hand.cardIds);
      if (!validatePermutation(hand.cardIds, shuffledHand)) {
        return reject(
          'invalid_command',
          'Shuffle adapter returned an invalid permutation'
        );
      }
      const combined = [...deck.cardIds, ...shuffledHand];
      const drawCount = Math.min(command.count, combined.length);
      const drawn = combined.slice(0, drawCount);
      return accept({
        type: 'ZoneOrdersSet',
        reason: 'shuffle-hand-to-deck-bottom-and-draw',
        zones: [
          {
            zoneId: hand.id,
            expectedCardIds: [...hand.cardIds],
            cardIds: drawn,
          },
          {
            zoneId: deck.id,
            expectedCardIds: [...deck.cardIds],
            cardIds: combined.slice(drawCount),
          },
        ],
        concealedCardIds: uniqueCardIds([...shuffledHand, ...drawn]),
      });
    }
    case 'SetDamage': {
      const stack = state.stacks[command.stackId];
      if (!stack) {
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      }
      if (
        command.damage !== null &&
        (!Number.isSafeInteger(command.damage) ||
          command.damage < 0 ||
          command.damage > 9990)
      ) {
        return reject(
          'invalid_command',
          'Damage must be null or an integer from 0 to 9990'
        );
      }
      const damage = command.damage === 0 ? null : command.damage;
      if (stack.damage === damage) {
        return reject('invalid_command', 'Stack damage is already set');
      }
      return accept({
        type: 'StackDamageSet',
        stackId: command.stackId,
        damage,
      });
    }
    case 'SetSpecialCondition': {
      const stack = state.stacks[command.stackId];
      if (!stack) {
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      }
      const normalized = command.condition?.trim() ?? null;
      const condition =
        normalized === '' || normalized === '0' ? null : normalized;
      if (condition !== null && condition.length > 16) {
        return reject('invalid_command', 'Condition marker is too long');
      }
      if (condition !== null && stack.slot !== 'active') {
        return reject(
          'precondition_failed',
          'Special conditions can only be set on the active stack'
        );
      }
      if (stack.specialCondition === condition) {
        return reject('invalid_command', 'Stack condition is already set');
      }
      return accept({
        type: 'StackConditionSet',
        stackId: command.stackId,
        condition,
      });
    }
    case 'SetAbilityUsed': {
      const stack = state.stacks[command.stackId];
      if (!stack)
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      if (stack.abilityUsed === command.used) {
        return reject('invalid_command', 'Stack ability marker is already set');
      }
      return accept({
        type: 'StackAbilitySet',
        stackId: command.stackId,
        used: command.used,
      });
    }
    case 'RotateStack': {
      const stack = state.stacks[command.stackId];
      if (!stack)
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      if (![0, 1, 2, 3].includes(command.rotationQuarterTurns)) {
        return reject(
          'invalid_command',
          'Stack rotation must be 0, 1, 2, or 3'
        );
      }
      if (stack.rotationQuarterTurns === command.rotationQuarterTurns) {
        return reject('invalid_command', 'Stack rotation is already set');
      }
      return accept({
        type: 'StackRotationSet',
        stackId: command.stackId,
        rotationQuarterTurns: command.rotationQuarterTurns,
      });
    }
    case 'SetCardOrientation': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      const allowed =
        location?.kind === 'stackEvolution' ||
        location?.kind === 'stackAttachment' ||
        (location?.kind === 'zone' &&
          state.zones[location.zoneId]?.kind === 'stadium');
      if (!allowed) {
        return reject(
          'precondition_failed',
          'Per-card rotation is only available in play or the stadium'
        );
      }
      if (![0, 1, 2, 3].includes(command.orientationQuarterTurns)) {
        return reject('invalid_command', 'Card rotation must be 0, 1, 2, or 3');
      }
      if (card.orientationQuarterTurns === command.orientationQuarterTurns) {
        return reject('invalid_command', 'Card rotation is already set');
      }
      return accept({
        type: 'CardOrientationSet',
        cardId: card.id,
        orientationQuarterTurns: command.orientationQuarterTurns,
      });
    }
    case 'SetCardAbilityUsed': {
      const card = state.cards[command.cardId];
      if (!card)
        return reject('not_found', `Card ${command.cardId} does not exist`);
      const location = findCardLocation(state, command.cardId);
      const allowed =
        location?.kind === 'stackAttachment' ||
        (location?.kind === 'zone' &&
          ['discard', 'stadium'].includes(
            state.zones[location.zoneId]?.kind ?? ''
          ));
      if (!allowed) {
        return reject(
          'precondition_failed',
          'Per-card ability markers require a discard, stadium, or attachment card'
        );
      }
      if (card.abilityUsed === command.used) {
        return reject('invalid_command', 'Card ability marker is already set');
      }
      return accept({
        type: 'CardAbilitySet',
        cardId: card.id,
        used: command.used,
      });
    }
    case 'SetCardFace':
      return state.cards[command.cardId]
        ? accept({
            type: 'CardFaceSet',
            cardId: command.cardId,
            face: command.face,
            concealIdentity: command.face === 'down',
          })
        : reject('not_found', `Card ${command.cardId} does not exist`);
    case 'SetCardCategory':
      return state.cards[command.cardId]
        ? accept({
            type: 'CardCategorySet',
            cardId: command.cardId,
            category: command.category,
          })
        : reject('not_found', `Card ${command.cardId} does not exist`);
    case 'SetPublicReveal':
      return state.cards[command.cardId]
        ? accept({
            type: 'PublicRevealSet',
            cardId: command.cardId,
            revealed: command.revealed,
          })
        : reject('not_found', `Card ${command.cardId} does not exist`);
    case 'ExtractDeckCardsForInspection': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      if (state.workAreas[command.playerId]?.inspection) {
        return reject('conflict', 'An inspection is already open');
      }
      if (!Number.isSafeInteger(command.count) || command.count <= 0) {
        return reject('invalid_command', 'Inspection count must be positive');
      }
      if (command.viewerIds.some((viewerId) => !state.players[viewerId])) {
        return reject('not_found', 'Inspection viewer does not exist');
      }
      const deckId = playerZoneId(command.playerId, 'deck');
      const deck = state.zones[deckId];
      if (!deck || deck.cardIds.length === 0) {
        return reject('precondition_failed', 'Deck is empty');
      }
      const count = Math.min(command.count, deck.cardIds.length);
      const cardIds =
        command.edge === 'top'
          ? deck.cardIds.slice(0, count)
          : deck.cardIds.slice(deck.cardIds.length - count);
      const inspectionId = context.nextInspectionId();
      return accept({
        type: 'InspectionOpened',
        playerId: command.playerId,
        workAreaId: asWorkAreaId(
          `work:${command.playerId}:inspection:${inspectionId}`
        ),
        inspectionId,
        sourceZoneId: deck.id,
        cardIds,
        viewerIds: [...new Set(command.viewerIds)],
      });
    }
    case 'CloseInspection': {
      const inspection = state.workAreas[command.playerId]?.inspection;
      if (!inspection || inspection.inspectionId !== command.inspectionId) {
        return reject('stale_reference', 'Inspection is no longer active');
      }
      const destination = state.zones[inspection.sourceZoneId];
      if (!destination)
        return reject('not_found', 'Inspection source zone no longer exists');
      const cardOrder =
        command.returnTo === 'top'
          ? [...inspection.cardIds, ...destination.cardIds]
          : [...destination.cardIds, ...inspection.cardIds];
      return accept({
        type: 'InspectionClosed',
        playerId: command.playerId,
        inspectionId: inspection.inspectionId,
        destinationZoneId: destination.id,
        cardOrder,
        concealIdentity: isConcealedZone(destination),
      });
    }
    case 'SetOncePerGameMarker': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const player = state.players[command.playerId]!;
      const current =
        command.marker === 'gx'
          ? player.oncePerGame.gxUsed
          : player.oncePerGame.vstarUsed;
      if (current === command.used) {
        return reject(
          'invalid_command',
          `${command.marker.toUpperCase()} marker is already set`
        );
      }
      return accept({
        type: 'OncePerGameMarkerSet',
        playerId: command.playerId,
        marker: command.marker,
        used: command.used,
      });
    }
    case 'FlipCoin': {
      const result = context.randomInt(2);
      if (result !== 0 && result !== 1) {
        return reject(
          'invalid_command',
          'Random adapter returned an invalid coin result'
        );
      }
      return accept({
        type: 'CoinFlipped',
        result: result === 0 ? 'heads' : 'tails',
      });
    }
  }
};
