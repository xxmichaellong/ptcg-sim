import type {
  CommandContext,
  CommandRejection,
  GameCommand,
} from './commands.js';
import { playerZoneId, stadiumZoneId } from './create-match.js';
import type { DomainEvent } from './events.js';
import { asWorkAreaId, type CardInstanceId, type PlayerId } from './ids.js';
import { findCardLocation } from './location.js';
import type { CardInstance, CardZone, MatchState } from './model.js';

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

const uniqueCardIds = (
  cardIds: readonly CardInstanceId[]
): readonly CardInstanceId[] => [...new Set(cardIds)];

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
      if (
        location.kind === 'stackEvolution' &&
        location.index !== stack.evolutionCardIds.length - 1
      ) {
        return reject(
          'precondition_failed',
          'Only the top evolution card may leave a play stack directly'
        );
      }
      if (
        location.kind === 'stackEvolution' &&
        stack.evolutionCardIds.length === 1 &&
        stack.attachmentCardIds.length > 0
      ) {
        return reject(
          'precondition_failed',
          'Resolve attached cards before removing the stack base'
        );
      }
      return accept({
        type: 'CardMovedFromStack',
        cardId: card.id,
        expectedStackId: stack.id,
        source: location.kind === 'stackEvolution' ? 'evolution' : 'attachment',
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
    case 'ShuffleZoneIntoDeck': {
      const playerError = requirePlayer(state, command.playerId);
      if (playerError) return playerError;
      const source = state.zones[command.sourceZoneId];
      const deck = state.zones[playerZoneId(command.playerId, 'deck')];
      if (!source || !deck) return reject('not_found', 'Zone does not exist');
      if (source.ownerId !== command.playerId) {
        return reject('precondition_failed', 'Source is not owned by player');
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
      if (!state.stacks[command.stackId]) {
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
      return accept({
        type: 'StackDamageSet',
        stackId: command.stackId,
        damage: command.damage,
      });
    }
    case 'SetSpecialCondition': {
      if (!state.stacks[command.stackId]) {
        return reject('not_found', `Stack ${command.stackId} does not exist`);
      }
      if (command.condition !== null && command.condition.length > 16) {
        return reject('invalid_command', 'Condition marker is too long');
      }
      return accept({
        type: 'StackConditionSet',
        stackId: command.stackId,
        condition: command.condition,
      });
    }
    case 'SetAbilityUsed':
      return state.stacks[command.stackId]
        ? accept({
            type: 'StackAbilitySet',
            stackId: command.stackId,
            used: command.used,
          })
        : reject('not_found', `Stack ${command.stackId} does not exist`);
    case 'RotateStack':
      return state.stacks[command.stackId]
        ? accept({
            type: 'StackRotationSet',
            stackId: command.stackId,
            rotationQuarterTurns: command.rotationQuarterTurns,
          })
        : reject('not_found', `Stack ${command.stackId} does not exist`);
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
