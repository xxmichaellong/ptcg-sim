import type {
  ConcealedViewCard,
  MatchViewState,
  PlayerId,
  ViewCard,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

/**
 * Optimistic prediction of a wire command on the recipient-safe view.
 *
 * The room stays authoritative: nothing here is sent anywhere, and the
 * authoritative publication always replaces the prediction. What this buys
 * is that the table shows the outcome of a command the instant it is
 * submitted rather than one round trip later. Predictions are applied on top
 * of every authoritative view until the command leaves the session's queue,
 * so a prediction is rebased when another publication lands first.
 *
 * Every predictor is strict about its preconditions and returns null when
 * the view is not in the shape the command expects -- including when the
 * authoritative view already contains the command's effect, which is what a
 * rebase on the publication that carried it looks like. A null prediction is
 * simply not shown; it never fails a command.
 *
 * Predictions work only with what the view discloses. A card moving into a
 * zone the viewer cannot read is shown as its back, matching the alias the
 * room will publish; work areas and new play stacks get predicted ids that
 * the publication replaces.
 */
export const predictWireCommand = (
  view: MatchViewState,
  command: WireGameCommand
): MatchViewState | null => {
  if (view.viewer.kind !== 'player') return null;
  const viewerId = view.viewer.playerId;
  try {
    return predict(view, command, viewerId);
  } catch {
    return null;
  }
};

type Zone = MatchViewState['zones'][string];
type Stack = MatchViewState['stacks'][string];
type WorkAreas = MatchViewState['workAreas'][string];

const zoneKindOf = (view: MatchViewState, zoneId: string) =>
  view.zones[zoneId]?.kind;

/** A card entering a zone the viewer cannot read is shown as its back. */
const asPlacedIn = (
  view: MatchViewState,
  viewerId: PlayerId,
  zone: Zone,
  card: ViewCard
): ViewCard => {
  const hiddenFromViewer =
    zone.kind === 'prizes' ||
    ((zone.kind === 'hand' || zone.kind === 'deck') &&
      zone.ownerId !== viewerId);
  if (!hiddenFromViewer || card.kind === 'concealed') return card;
  const concealed: ConcealedViewCard = {
    kind: 'concealed',
    id: card.id,
    ownerId: card.ownerId,
    cardBackUrl: view.players[card.ownerId]?.cardBackUrl ?? '',
    publiclyRevealed: false,
  };
  return concealed;
};

const withZone = (view: MatchViewState, zone: Zone): MatchViewState => ({
  ...view,
  zones: { ...view.zones, [zone.id]: zone },
});

const withStack = (view: MatchViewState, stack: Stack): MatchViewState => ({
  ...view,
  stacks: { ...view.stacks, [stack.id]: stack },
});

const withoutStack = (
  view: MatchViewState,
  stackId: string
): MatchViewState => {
  const stacks = { ...view.stacks };
  delete stacks[stackId];
  return { ...view, stacks };
};

const withBoard = (
  view: MatchViewState,
  playerId: PlayerId,
  board: MatchViewState['boards'][string]
): MatchViewState => ({
  ...view,
  boards: { ...view.boards, [playerId]: board },
});

const withWorkAreas = (
  view: MatchViewState,
  playerId: PlayerId,
  areas: WorkAreas
): MatchViewState => ({
  ...view,
  workAreas: { ...view.workAreas, [playerId]: areas },
});

const takeFromZone = (
  view: MatchViewState,
  zoneId: string,
  cardId: string
): { readonly view: MatchViewState; readonly card: ViewCard } | null => {
  const zone = view.zones[zoneId];
  if (!zone) return null;
  const index = zone.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return null;
  const card = zone.cards[index]!;
  return {
    view: withZone(view, {
      ...zone,
      cards: zone.cards.filter((_, position) => position !== index),
    }),
    card,
  };
};

const placeInZone = (
  view: MatchViewState,
  viewerId: PlayerId,
  zoneId: string,
  card: ViewCard,
  index?: number
): MatchViewState | null => {
  const zone = view.zones[zoneId];
  if (!zone) return null;
  const at = Math.max(
    0,
    Math.min(index ?? zone.cards.length, zone.cards.length)
  );
  const cards = [...zone.cards];
  cards.splice(at, 0, asPlacedIn(view, viewerId, zone, card));
  return withZone(view, { ...zone, cards });
};

/** Removes a stack from its board, whichever slot holds it. */
const detachStackFromBoard = (
  view: MatchViewState,
  stack: Stack
): MatchViewState => {
  const board = view.boards[stack.boardPlayerId];
  if (!board) return view;
  return withBoard(view, stack.boardPlayerId, {
    activeStackId:
      board.activeStackId === stack.id ? null : board.activeStackId,
    benchStackIds: board.benchStackIds.filter((id) => id !== stack.id),
  });
};

/**
 * Takes a card out of a play stack. Taking the top Pokémon departs the whole
 * stack: its remaining cards go to the owner's attached-card work area (or
 * the stack simply disappears when nothing remains), as the room does.
 */
const takeFromStack = (
  view: MatchViewState,
  stackId: string,
  cardId: string
): { readonly view: MatchViewState; readonly card: ViewCard } | null => {
  const stack = view.stacks[stackId];
  if (!stack) return null;
  const attachmentIndex = stack.attachmentCards.findIndex(
    (card) => card.id === cardId
  );
  if (attachmentIndex >= 0) {
    return {
      view: withStack(view, {
        ...stack,
        attachmentCards: stack.attachmentCards.filter(
          (_, position) => position !== attachmentIndex
        ),
      }),
      card: stack.attachmentCards[attachmentIndex]!,
    };
  }
  const evolutionIndex = stack.evolutionCards.findIndex(
    (card) => card.id === cardId
  );
  if (evolutionIndex < 0) return null;
  const card = stack.evolutionCards[evolutionIndex]!;
  if (evolutionIndex < stack.evolutionCards.length - 1) {
    return {
      view: withStack(view, {
        ...stack,
        evolutionCards: stack.evolutionCards.filter(
          (_, position) => position !== evolutionIndex
        ),
      }),
      card,
    };
  }
  const evolutionCards = stack.evolutionCards.slice(0, -1);
  const attachmentCards = stack.attachmentCards;
  let next = withoutStack(detachStackFromBoard(view, stack), stack.id);
  if (evolutionCards.length + attachmentCards.length > 0) {
    const areas = next.workAreas[stack.boardPlayerId];
    if (!areas || areas.attachmentResolution) return null;
    next = withWorkAreas(next, stack.boardPlayerId, {
      ...areas,
      attachmentResolution: {
        id: `predicted-work-area:${stack.id}`,
        sourceStackId: stack.id,
        cards: [...[...evolutionCards].reverse(), ...attachmentCards],
        evolutionCards,
        attachmentCards,
        suggestedSlot: stack.slot,
      },
    });
  }
  return { view: next, card };
};

const takeFromWorkArea = (
  view: MatchViewState,
  workAreaId: string,
  cardId: string
): { readonly view: MatchViewState; readonly card: ViewCard } | null => {
  for (const [playerId, areas] of Object.entries(view.workAreas)) {
    const inspection = areas.inspection;
    if (inspection?.id === workAreaId) {
      const card = inspection.cards.find(
        (candidate) => candidate.id === cardId
      );
      if (!card) return null;
      return {
        view: withWorkAreas(view, playerId as PlayerId, {
          ...areas,
          inspection: {
            ...inspection,
            cards: inspection.cards.filter((candidate) => candidate !== card),
          },
        }),
        card,
      };
    }
    const staged = areas.attachmentResolution;
    if (staged?.id === workAreaId) {
      const card = staged.cards.find((candidate) => candidate.id === cardId);
      if (!card) return null;
      const remaining = {
        ...staged,
        cards: staged.cards.filter((candidate) => candidate !== card),
        evolutionCards: staged.evolutionCards.filter(
          (candidate) => candidate.id !== cardId
        ),
        attachmentCards: staged.attachmentCards.filter(
          (candidate) => candidate.id !== cardId
        ),
      };
      return {
        view: withWorkAreas(view, playerId as PlayerId, {
          ...areas,
          attachmentResolution: remaining.cards.length === 0 ? null : remaining,
        }),
        card,
      };
    }
  }
  return null;
};

/** Takes a card from a zone, a play stack, or a work area by source id. */
const takeFromSource = (
  view: MatchViewState,
  sourceId: string,
  cardId: string
) =>
  takeFromZone(view, sourceId, cardId) ??
  takeFromStack(view, sourceId, cardId) ??
  takeFromWorkArea(view, sourceId, cardId);

/** v1 orders attachments energies first, then trainers (attachment-order.ts). */
const attachTo = (stack: Stack, card: ViewCard): Stack => {
  const cards = [...stack.attachmentCards, card];
  const categories = cards.map((candidate) =>
    candidate.kind === 'known' ? candidate.category : 'Unknown'
  );
  if (
    card.kind === 'known' &&
    card.category === 'Energy' &&
    categories.every(
      (category) => category === 'Energy' || category === 'Trainer'
    )
  ) {
    return {
      ...stack,
      attachmentCards: [
        ...cards.filter((_, index) => categories[index] === 'Energy'),
        ...cards.filter((_, index) => categories[index] === 'Trainer'),
      ],
    };
  }
  return { ...stack, attachmentCards: cards };
};

const evolveWith = (stack: Stack, card: ViewCard): Stack => ({
  ...stack,
  evolutionCards: [...stack.evolutionCards, card],
});

/** Puts a new stack on a board the way the room lays it out. */
const placeNewStack = (
  view: MatchViewState,
  stack: Stack,
  slot: 'active' | 'bench',
  benchIndex: number | undefined
): MatchViewState | null => {
  const board = view.boards[stack.boardPlayerId];
  if (!board) return null;
  let next = withStack(view, { ...stack, slot });
  if (slot === 'active') {
    const benchStackIds = [...board.benchStackIds];
    if (board.activeStackId) {
      const prior = next.stacks[board.activeStackId];
      if (!prior) return null;
      benchStackIds.push(board.activeStackId);
      next = withStack(next, { ...prior, slot: 'bench' });
    }
    return withBoard(next, stack.boardPlayerId, {
      activeStackId: stack.id,
      benchStackIds,
    });
  }
  const benchStackIds = [...board.benchStackIds];
  const at = Math.max(
    0,
    Math.min(benchIndex ?? benchStackIds.length, benchStackIds.length)
  );
  benchStackIds.splice(at, 0, stack.id);
  return withBoard(next, stack.boardPlayerId, {
    activeStackId: board.activeStackId,
    benchStackIds,
  });
};

const emptyStack = (
  id: string,
  boardPlayerId: PlayerId,
  slot: 'active' | 'bench',
  evolutionCards: readonly ViewCard[],
  attachmentCards: readonly ViewCard[]
): Stack => ({
  id,
  boardPlayerId,
  slot,
  evolutionCards,
  attachmentCards,
  rotationQuarterTurns: 0,
  damage: null,
  specialCondition: null,
  abilityUsed: false,
});

const updateCard = (
  view: MatchViewState,
  cardId: string,
  update: (card: ViewCard) => ViewCard
): MatchViewState | null => {
  for (const zone of Object.values(view.zones)) {
    if (zone.cards.some((card) => card.id === cardId)) {
      return withZone(view, {
        ...zone,
        cards: zone.cards.map((card) =>
          card.id === cardId ? update(card) : card
        ),
      });
    }
  }
  for (const stack of Object.values(view.stacks)) {
    if (
      stack.evolutionCards.some((card) => card.id === cardId) ||
      stack.attachmentCards.some((card) => card.id === cardId)
    ) {
      return withStack(view, {
        ...stack,
        evolutionCards: stack.evolutionCards.map((card) =>
          card.id === cardId ? update(card) : card
        ),
        attachmentCards: stack.attachmentCards.map((card) =>
          card.id === cardId ? update(card) : card
        ),
      });
    }
  }
  return null;
};

const updateStack = (
  view: MatchViewState,
  stackId: string,
  update: (stack: Stack) => Stack
): MatchViewState | null => {
  const stack = view.stacks[stackId];
  return stack ? withStack(view, update(stack)) : null;
};

const ownZone = (
  view: MatchViewState,
  playerId: PlayerId,
  kind: Zone['kind']
): Zone | undefined =>
  Object.values(view.zones).find(
    (zone) => zone.ownerId === playerId && zone.kind === kind
  );

/** Moves every card of one zone to the end of another. */
const moveZoneContents = (
  view: MatchViewState,
  viewerId: PlayerId,
  sourceId: string,
  destinationId: string,
  index?: number
): MatchViewState | null => {
  const source = view.zones[sourceId];
  const destination = view.zones[destinationId];
  if (!source || !destination || source.cards.length === 0) return null;
  const cards = [...destination.cards];
  const at = Math.max(0, Math.min(index ?? cards.length, cards.length));
  cards.splice(
    at,
    0,
    ...source.cards.map((card) => asPlacedIn(view, viewerId, destination, card))
  );
  return withZone(withZone(view, { ...source, cards: [] }), {
    ...destination,
    cards,
  });
};

/** The seat a command acts for: the viewer unless it names another player. */
const targetSeat = (
  view: MatchViewState,
  viewerId: PlayerId,
  targetPlayerId: string | undefined
): PlayerId | null => {
  if (targetPlayerId === undefined) return viewerId;
  return view.players[targetPlayerId] ? (targetPlayerId as PlayerId) : null;
};

/** Draws from the top of a seat's deck into its hand. */
const drawFor = (
  view: MatchViewState,
  viewerId: PlayerId,
  playerId: PlayerId,
  count: number
): MatchViewState | null => {
  const deck = ownZone(view, playerId, 'deck');
  const hand = ownZone(view, playerId, 'hand');
  if (!deck || !hand) return null;
  const drawn = deck.cards.slice(0, count);
  if (drawn.length === 0) return view;
  return withZone(
    withZone(view, { ...deck, cards: deck.cards.slice(drawn.length) }),
    {
      ...hand,
      cards: [
        ...hand.cards,
        ...drawn.map((card) => asPlacedIn(view, viewerId, hand, card)),
      ],
    }
  );
};

const predict = (
  view: MatchViewState,
  command: WireGameCommand,
  viewerId: PlayerId
): MatchViewState | null => {
  switch (command.type) {
    case 'MoveCard': {
      const taken = takeFromZone(
        view,
        command.expectedSourceZoneId,
        command.cardId
      );
      if (!taken) return null;
      const destinationKind = zoneKindOf(view, command.destinationZoneId);
      if (destinationKind === 'stadium') return null;
      return placeInZone(
        taken.view,
        viewerId,
        command.destinationZoneId,
        taken.card,
        command.destinationIndex
      );
    }
    case 'MoveCardToPlay': {
      const taken = takeFromZone(
        view,
        command.expectedSourceZoneId,
        command.cardId
      );
      if (!taken) return null;
      const card = taken.card;
      if (command.targetStackId) {
        const target = taken.view.stacks[command.targetStackId];
        if (!target) return null;
        const isPokemon = card.kind === 'known' && card.category === 'Pokémon';
        return withStack(
          taken.view,
          isPokemon ? evolveWith(target, card) : attachTo(target, card)
        );
      }
      return placeNewStack(
        taken.view,
        emptyStack(
          `predicted-stack:${card.id}`,
          command.boardPlayerId as PlayerId,
          command.slot,
          [card],
          []
        ),
        command.slot,
        command.benchIndex
      );
    }
    case 'PlaceCardOnPlayStack': {
      const target = view.stacks[command.targetStackId];
      if (
        !target ||
        target.evolutionCards.at(-1)?.id !== command.expectedTargetTopCardId
      ) {
        return null;
      }
      const taken = takeFromSource(
        view,
        command.expectedSourceId,
        command.cardId
      );
      if (!taken) return null;
      const refreshed = taken.view.stacks[command.targetStackId];
      if (!refreshed) return null;
      return withStack(
        taken.view,
        command.mode === 'evolution'
          ? evolveWith(refreshed, taken.card)
          : attachTo(refreshed, taken.card)
      );
    }
    case 'MoveCardFromStack': {
      const taken = takeFromStack(
        view,
        command.expectedStackId,
        command.cardId
      );
      if (!taken) return null;
      if (zoneKindOf(view, command.destinationZoneId) === 'stadium')
        return null;
      return placeInZone(
        taken.view,
        viewerId,
        command.destinationZoneId,
        taken.card,
        command.destinationIndex
      );
    }
    case 'MovePlayStack': {
      const stack = view.stacks[command.stackId];
      if (!stack || stack.slot !== command.expectedSourceSlot) return null;
      const board = view.boards[stack.boardPlayerId];
      if (
        !board ||
        board.activeStackId !== command.expectedActiveStackId ||
        board.benchStackIds.join(' ') !== command.expectedBenchStackIds.join(' ')
      ) {
        return null;
      }
      const target = command.targetStackId
        ? view.stacks[command.targetStackId]
        : undefined;
      if (command.targetStackId && !target) return null;
      let activeStackId = board.activeStackId;
      const benchStackIds = [...board.benchStackIds];
      const sourceBenchIndex = benchStackIds.indexOf(stack.id);
      if (target) {
        if (stack.slot === 'active') {
          const targetIndex = benchStackIds.indexOf(target.id);
          if (targetIndex < 0) return null;
          activeStackId = target.id;
          benchStackIds[targetIndex] = stack.id;
        } else if (target.slot === 'active') {
          activeStackId = stack.id;
          benchStackIds[sourceBenchIndex] = target.id;
        } else {
          const targetIndex = benchStackIds.indexOf(target.id);
          if (targetIndex < 0) return null;
          benchStackIds[sourceBenchIndex] = target.id;
          benchStackIds[targetIndex] = stack.id;
        }
      } else if (command.destinationSlot === 'active') {
        if (stack.slot === 'active') return null;
        benchStackIds.splice(sourceBenchIndex, 1);
        if (activeStackId) benchStackIds.push(activeStackId);
        activeStackId = stack.id;
      } else if (stack.slot === 'active') {
        activeStackId = null;
        benchStackIds.push(stack.id);
        if (benchStackIds.length === 2) activeStackId = benchStackIds.shift()!;
      } else {
        benchStackIds.splice(sourceBenchIndex, 1);
        benchStackIds.push(stack.id);
      }
      let next = withBoard(view, stack.boardPlayerId, {
        activeStackId,
        benchStackIds,
      });
      for (const id of [stack.id, ...(target ? [target.id] : [])]) {
        const moved = next.stacks[id];
        if (!moved) return null;
        next = withStack(next, {
          ...moved,
          slot: activeStackId === id ? 'active' : 'bench',
        });
      }
      return next;
    }
    case 'MoveInspectedCard':
    case 'MoveStagedCard': {
      const taken = takeFromWorkArea(
        view,
        command.expectedWorkAreaId,
        command.cardId
      );
      if (!taken) return null;
      if (zoneKindOf(view, command.destinationZoneId) === 'stadium')
        return null;
      return placeInZone(
        taken.view,
        viewerId,
        command.destinationZoneId,
        taken.card,
        command.destinationIndex
      );
    }
    case 'RestoreStagedStack': {
      const entry = Object.entries(view.workAreas).find(
        ([, areas]) =>
          areas.attachmentResolution?.id === command.expectedWorkAreaId
      );
      if (!entry) return null;
      const [playerId, areas] = entry;
      const staged = areas.attachmentResolution!;
      const board = view.boards[playerId as PlayerId];
      if (
        !board ||
        staged.evolutionCards.length === 0 ||
        board.activeStackId !== command.expectedActiveStackId ||
        board.benchStackIds.join(' ') !== command.expectedBenchStackIds.join(' ')
      ) {
        return null;
      }
      const cleared = withWorkAreas(view, playerId as PlayerId, {
        ...areas,
        attachmentResolution: null,
      });
      return placeNewStack(
        cleared,
        emptyStack(
          `predicted-stack:${staged.evolutionCards[0]!.id}`,
          playerId as PlayerId,
          command.destinationSlot,
          staged.evolutionCards,
          staged.attachmentCards
        ),
        command.destinationSlot,
        command.benchIndex
      );
    }
    case 'MoveCardToDeckTop':
    case 'MoveCardToDeckBottom':
    case 'ShuffleCardIntoDeck': {
      const taken = takeFromSource(
        view,
        command.expectedSourceId,
        command.cardId
      );
      if (!taken) return null;
      const deck = ownZone(taken.view, taken.card.ownerId, 'deck');
      if (!deck) return null;
      return placeInZone(
        taken.view,
        viewerId,
        deck.id,
        taken.card,
        command.type === 'MoveCardToDeckTop' ? 0 : undefined
      );
    }
    case 'DrawCards': {
      // A flipped solo board draws for the seat at the bottom; that seat's
      // deck is readable in solo, and the card is shown as a back otherwise.
      const target = targetSeat(view, viewerId, command.targetPlayerId);
      return target ? drawFor(view, viewerId, target, command.count) : null;
    }
    case 'DiscardHandAndDraw': {
      const target = targetSeat(view, viewerId, command.targetPlayerId);
      if (!target) return null;
      const hand = ownZone(view, target, 'hand');
      const discard = ownZone(view, target, 'discard');
      if (!hand || !discard) return null;
      const emptied =
        hand.cards.length === 0
          ? view
          : moveZoneContents(view, viewerId, hand.id, discard.id);
      return emptied ? drawFor(emptied, viewerId, target, command.count) : null;
    }
    case 'ShuffleHandIntoDeckAndDraw':
    case 'ShuffleHandToDeckBottomAndDraw': {
      // The deck is reshuffled by the room, so which cards come back cannot
      // be known here; only the hand leaving is shown.
      const target = targetSeat(view, viewerId, command.targetPlayerId);
      if (!target) return null;
      const hand = ownZone(view, target, 'hand');
      const deck = ownZone(view, target, 'deck');
      if (!hand || !deck || hand.cards.length === 0) return null;
      return moveZoneContents(view, viewerId, hand.id, deck.id);
    }
    case 'MoveZoneContents':
      return moveZoneContents(
        view,
        viewerId,
        command.sourceZoneId,
        command.destinationZoneId
      );
    case 'ShuffleZoneIntoDeck':
    case 'ShuffleZoneToDeckBottom': {
      const source = view.zones[command.sourceZoneId];
      const deck = source?.ownerId
        ? ownZone(view, source.ownerId, 'deck')
        : undefined;
      if (!source || !deck) return null;
      return moveZoneContents(view, viewerId, source.id, deck.id);
    }
    case 'MovePrizesToDeckBottom': {
      const prizes = ownZone(view, viewerId, 'prizes');
      const deck = ownZone(view, viewerId, 'deck');
      if (!prizes || !deck) return null;
      return moveZoneContents(view, viewerId, prizes.id, deck.id);
    }
    case 'ResolveLooseBoardCards': {
      const owner = command.targetPlayerId as PlayerId;
      const board = ownZone(view, owner, 'board');
      if (
        !board ||
        board.cards.map((card) => card.id).join(' ') !==
          command.expectedBoardCardIds.join(' ')
      ) {
        return null;
      }
      const destination = ownZone(
        view,
        owner,
        command.destination === 'shuffleIntoDeck' ? 'deck' : command.destination
      );
      if (!destination) return null;
      return moveZoneContents(view, viewerId, board.id, destination.id);
    }
    case 'SetDamage':
      return updateStack(view, command.stackId, (stack) => ({
        ...stack,
        damage: command.damage,
      }));
    case 'SetSpecialCondition':
      return updateStack(view, command.stackId, (stack) => ({
        ...stack,
        specialCondition: command.condition,
      }));
    case 'SetAbilityUsed':
      return updateStack(view, command.stackId, (stack) => ({
        ...stack,
        abilityUsed: command.used,
      }));
    case 'RotateStack':
      return updateStack(view, command.stackId, (stack) => ({
        ...stack,
        rotationQuarterTurns: command.rotationQuarterTurns,
      }));
    case 'SetCardOrientation':
      return updateCard(view, command.cardId, (card) =>
        card.kind === 'known'
          ? {
              ...card,
              orientationQuarterTurns: command.orientationQuarterTurns,
            }
          : card
      );
    case 'SetCardAbilityUsed':
      return updateCard(view, command.cardId, (card) =>
        card.kind === 'known' ? { ...card, abilityUsed: command.used } : card
      );
    case 'ChangeCardCategory':
      return updateCard(view, command.cardId, (card) =>
        card.kind === 'known' ? { ...card, category: command.category } : card
      );
    case 'SetCardFace':
      return updateCard(view, command.cardId, (card) =>
        card.kind === 'known' ? { ...card, face: command.face } : card
      );
    default:
      return null;
  }
};
