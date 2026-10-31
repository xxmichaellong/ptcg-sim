import type { StackReminder } from './stack-reminders.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  ViewCardId,
  ViewDefinitionId,
} from './ids.js';
import { findCardLocation } from './location.js';
import type {
  CardCategory,
  CardDefinition,
  CardFace,
  CardInstance,
  MatchState,
  QuarterTurns,
} from './model.js';

export type ViewerRole =
  | { readonly kind: 'player'; readonly playerId: PlayerId }
  | { readonly kind: 'spectator' };

export interface ProjectionIdentityAdapter {
  readonly viewCardId: (input: {
    readonly viewerKey: string;
    readonly cardId: CardInstanceId;
    readonly visibilityGeneration: number;
    readonly known: boolean;
  }) => ViewCardId;
  readonly viewDefinitionId: (input: {
    readonly viewerKey: string;
    readonly definitionId: CardDefinitionId;
  }) => ViewDefinitionId;
}

export interface KnownViewCard {
  readonly kind: 'known';
  readonly id: ViewCardId;
  readonly definitionId: ViewDefinitionId;
  readonly ownerId: PlayerId;
  readonly category: CardCategory;
  readonly face: CardFace;
  readonly orientationQuarterTurns: QuarterTurns;
  readonly abilityUsed: boolean;
  readonly publiclyRevealed: boolean;
  /**
   * Where this card's name first appears in its owner's declared decklist,
   * which is the order v1's Sort checkbox paints (`zones/general.js` walks
   * `deckData` and appends every card of each name in turn). Every copy of a
   * name shares one rank, so the display order can be rebuilt without telling
   * two copies apart. Absent for a card that is not in the deck baseline.
   */
  readonly decklistRank?: number;
}

export interface ConcealedViewCard {
  readonly kind: 'concealed';
  readonly id: ViewCardId;
  readonly ownerId: PlayerId;
  readonly cardBackUrl: string;
  readonly publiclyRevealed: false;
  /**
   * How a face-down card on the table (in play or the Stadium) is turned,
   * which everyone at the table sees; absent when it isn't, and anywhere
   * else, where it would only help follow a card no one may read.
   */
  readonly orientationQuarterTurns?: QuarterTurns;
}

export type ViewCard = KnownViewCard | ConcealedViewCard;

export interface ViewCardDefinition {
  readonly id: ViewDefinitionId;
  readonly name: string;
  readonly category: CardCategory;
  readonly imageUrl: string;
  readonly imageUrlSmall?: string;
  readonly presentation?: import('./card-presentation.js').CardPresentation;
  readonly playsAs?: import('./card-plays-as.js').CardPlaysAs;
}

export interface MatchViewState {
  readonly matchId: string;
  readonly revision: number;
  readonly lifecycle: MatchState['lifecycle'];
  readonly viewer: ViewerRole;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<
    Record<
      string,
      {
        readonly id: PlayerId;
        readonly displayName: string;
        readonly cardBackUrl: string;
        readonly coachingConsent: boolean;
        readonly oncePerGame: MatchState['players'][string]['oncePerGame'];
      }
    >
  >;
  readonly definitions: Readonly<Record<string, ViewCardDefinition>>;
  readonly zones: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly kind: MatchState['zones'][string]['kind'];
        readonly ownerId: PlayerId | null;
        readonly cards: readonly ViewCard[];
      }
    >
  >;
  readonly boards: Readonly<
    Record<
      string,
      {
        readonly activeStackId: string | null;
        readonly benchStackIds: readonly string[];
      }
    >
  >;
  readonly stacks: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly boardPlayerId: PlayerId;
        readonly slot: 'active' | 'bench';
        readonly evolutionCards: readonly ViewCard[];
        readonly attachmentCards: readonly ViewCard[];
        readonly rotationQuarterTurns: QuarterTurns;
        readonly damage: number | null;
        readonly specialCondition: string | null;
        readonly abilityUsed: boolean;
        /**
         * The reminders on it (STACK_REMINDERS order). Projection always
         * sends the list; a view from before reminders has none.
         */
        readonly reminders?: readonly StackReminder[];
      }
    >
  >;
  readonly workAreas: Readonly<
    Record<
      string,
      {
        readonly inspection: {
          readonly id: string;
          readonly cards: readonly ViewCard[];
          readonly sourceZoneId: string;
        } | null;
        readonly attachmentResolution: {
          readonly id: string;
          readonly sourceStackId: string;
          readonly cards: readonly ViewCard[];
          readonly evolutionCards: readonly ViewCard[];
          readonly attachmentCards: readonly ViewCard[];
          readonly suggestedSlot: 'active' | 'bench';
        } | null;
      }
    >
  >;
  readonly privateInspections: readonly {
    readonly id: string;
    readonly sourcePlayerId: PlayerId;
    readonly sourceId: string;
    readonly cardIds: readonly ViewCardId[];
  }[];
  readonly turn: MatchState['turn'];
}

const viewerKey = (viewer: ViewerRole): string =>
  viewer.kind === 'player' ? `player:${viewer.playerId}` : 'spectator';

const isGrantedInspection = (
  state: MatchState,
  viewer: ViewerRole,
  cardId: CardInstanceId
): boolean => {
  if (viewer.kind !== 'player') return false;
  for (const areas of Object.values(state.workAreas)) {
    if (
      areas.inspection?.cardIds.includes(cardId) &&
      areas.inspection.viewerIdsByCardId[cardId]?.includes(viewer.playerId)
    ) {
      return true;
    }
  }
  return Object.values(state.visibility.inspectionGrants).some(
    (grant) =>
      grant.cardIds.includes(cardId) &&
      grant.viewerIds.includes(viewer.playerId)
  );
};

export const isCardKnownToViewer = (
  state: MatchState,
  viewer: ViewerRole,
  card: CardInstance
): boolean => {
  if (state.visibility.publicCardIds.includes(card.id)) return true;
  if (isGrantedInspection(state, viewer, card.id)) return true;
  const location = findCardLocation(state, card.id);
  if (!location) return false;
  if (location.kind === 'inspectionWorkArea') return false;
  if (location.kind === 'attachmentResolutionWorkArea') {
    return viewer.kind === 'player' && viewer.playerId === location.playerId;
  }
  if (location.kind === 'zone') {
    const zone = state.zones[location.zoneId];
    if (!zone) return false;
    if (zone.kind === 'prizes') return false;
    // v1 lets a player look through their own deck (and hand); the opponent
    // and spectators still see only backs. Prizes stay face down for everyone
    // until revealed or looked at.
    if (zone.kind === 'deck' || zone.kind === 'hand') {
      return viewer.kind === 'player' && viewer.playerId === zone.ownerId;
    }
    if (card.face === 'down') {
      return viewer.kind === 'player' && viewer.playerId === card.ownerId;
    }
    return true;
  }
  if (card.face === 'down') {
    return viewer.kind === 'player' && viewer.playerId === card.ownerId;
  }
  return true;
};

/**
 * Where a card sorts in its owner's hand. v1's Sort walks the decklist in
 * declared order and gathers every card of each entry's name, so two
 * printings of one card (Iono PAL 185 and PAL 254) sort together; the
 * baseline deck list keeps that order, and ranking by the first card of
 * each name keeps copies indistinguishable, as they are in v1. Ranked per
 * owner: two players' decks may share a card.
 */
export const decklistRanks = (
  state: MatchState
): ((card: CardInstance) => number | undefined) => {
  const ranks = new Map<string, number>();
  const key = (card: CardInstance) =>
    `${card.ownerId}\u0000${state.definitions[card.definitionId]?.name ?? card.definitionId}`;
  for (const cardIds of Object.values(state.deckLists)) {
    cardIds.forEach((cardId, index) => {
      const card = state.cards[cardId];
      if (!card) return;
      const cardKey = key(card);
      if (!ranks.has(cardKey)) ranks.set(cardKey, index);
    });
  }
  return (card) => ranks.get(key(card));
};

export const projectMatch = (
  state: MatchState,
  viewer: ViewerRole,
  identities: ProjectionIdentityAdapter
): MatchViewState => {
  const key = viewerKey(viewer);
  const definitions: Record<string, ViewCardDefinition> = {};
  const decklistRankOf = decklistRanks(state);
  // Another player's card ranks only among that player's cards this viewer
  // can read: its place in the whole decklist would tell how many cards,
  // and which, the hidden rest of the deck holds.
  // Keyed by name, as the decklist ranks are: printings of one card share
  // a rank here too.
  const sharedRanks = new Map<string, number>();
  const sharedKey = (card: CardInstance): string =>
    `${card.ownerId}\u0000${state.definitions[card.definitionId]?.name ?? card.definitionId}`;
  {
    const seen = new Map<PlayerId, Map<string, number>>();
    for (const card of Object.values(state.cards)) {
      if (viewer.kind === 'player' && viewer.playerId === card.ownerId)
        continue;
      const rank = decklistRankOf(card);
      if (rank === undefined || !isCardKnownToViewer(state, viewer, card))
        continue;
      const owner = seen.get(card.ownerId) ?? new Map<string, number>();
      seen.set(card.ownerId, owner);
      owner.set(sharedKey(card), rank);
    }
    for (const names of seen.values()) {
      [...names.entries()]
        .sort(([, left], [, right]) => left - right)
        .forEach(([name], index) => sharedRanks.set(name, index));
    }
  }
  const visibleRankOf = (card: CardInstance): number | undefined =>
    viewer.kind === 'player' && viewer.playerId === card.ownerId
      ? decklistRankOf(card)
      : sharedRanks.get(sharedKey(card));

  const projectCard = (cardId: CardInstanceId, onTable: boolean): ViewCard => {
    const card = state.cards[cardId];
    if (!card) throw new Error(`Projection references missing card ${cardId}`);
    const known = isCardKnownToViewer(state, viewer, card);
    const id = identities.viewCardId({
      viewerKey: key,
      cardId: card.id,
      visibilityGeneration: card.visibilityGeneration,
      known,
    });
    if (!known) {
      return {
        kind: 'concealed',
        id,
        ownerId: card.ownerId,
        cardBackUrl: state.players[card.ownerId]?.cardBackUrl ?? '',
        publiclyRevealed: false,
        ...(onTable && card.orientationQuarterTurns !== 0
          ? { orientationQuarterTurns: card.orientationQuarterTurns }
          : {}),
      };
    }
    const definition = state.definitions[card.definitionId];
    if (!definition) {
      throw new Error(
        `Projection references missing definition ${card.definitionId}`
      );
    }
    const definitionId = identities.viewDefinitionId({
      viewerKey: key,
      definitionId: definition.id,
    });
    if (!definitions[definitionId]) {
      definitions[definitionId] = projectDefinition(definitionId, definition);
    }
    const decklistRank = visibleRankOf(card);
    return {
      kind: 'known',
      id,
      definitionId,
      ownerId: card.ownerId,
      category: card.currentCategory,
      face: card.face,
      orientationQuarterTurns: card.orientationQuarterTurns,
      abilityUsed: card.abilityUsed,
      publiclyRevealed: state.visibility.publicCardIds.includes(card.id),
      ...(decklistRank === undefined ? {} : { decklistRank }),
    };
  };
  /** A card in a work area: in no one's play. */
  const offTable = (cardId: CardInstanceId): ViewCard =>
    projectCard(cardId, false);

  return {
    matchId: state.matchId,
    revision: state.revision,
    lifecycle: state.lifecycle,
    viewer,
    playerOrder: [...state.playerOrder],
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, player]) => [
        id,
        {
          id: player.id,
          displayName: player.displayName,
          cardBackUrl: player.cardBackUrl,
          coachingConsent: player.coachingConsent,
          oncePerGame: { ...player.oncePerGame },
        },
      ])
    ),
    definitions,
    zones: Object.fromEntries(
      Object.entries(state.zones).map(([id, zone]) => [
        id,
        {
          id: zone.id,
          kind: zone.kind,
          ownerId: zone.ownerId,
          cards: zone.cardIds.map((cardId) =>
            projectCard(cardId, zone.kind === 'stadium')
          ),
        },
      ])
    ),
    boards: Object.fromEntries(
      Object.entries(state.boards).map(([id, board]) => [
        id,
        {
          activeStackId: board.activeStackId,
          benchStackIds: [...board.benchStackIds],
        },
      ])
    ),
    stacks: Object.fromEntries(
      Object.entries(state.stacks).map(([id, stack]) => [
        id,
        {
          id: stack.id,
          boardPlayerId: stack.boardPlayerId,
          slot: stack.slot,
          evolutionCards: stack.evolutionCardIds.map((cardId) =>
            projectCard(cardId, true)
          ),
          attachmentCards: stack.attachmentCardIds.map((cardId) =>
            projectCard(cardId, true)
          ),
          rotationQuarterTurns: stack.rotationQuarterTurns,
          damage: stack.damage,
          specialCondition: stack.specialCondition,
          abilityUsed: stack.abilityUsed,
          reminders: [...(stack.reminders ?? [])],
        },
      ])
    ),
    workAreas: Object.fromEntries(
      Object.entries(state.workAreas).map(([id, areas]) => [
        id,
        {
          inspection: areas.inspection
            ? {
                id: areas.inspection.id,
                sourceZoneId: areas.inspection.sourceZoneId,
                cards: areas.inspection.cardIds.map(offTable),
              }
            : null,
          attachmentResolution: areas.attachmentResolution
            ? {
                id: areas.attachmentResolution.id,
                sourceStackId: areas.attachmentResolution.sourceStackId,
                cards: areas.attachmentResolution.cardIds.map(offTable),
                evolutionCards:
                  areas.attachmentResolution.evolutionCardIds.map(offTable),
                attachmentCards:
                  areas.attachmentResolution.attachmentCardIds.map(offTable),
                suggestedSlot: areas.attachmentResolution.suggestedSlot,
              }
            : null,
        },
      ])
    ),
    privateInspections:
      viewer.kind === 'player'
        ? Object.values(state.visibility.inspectionGrants)
            .filter((grant) => grant.viewerIds.includes(viewer.playerId))
            .map((grant) => ({
              id: grant.inspectionId,
              sourcePlayerId: grant.sourcePlayerId,
              sourceId: grant.sourceId,
              cardIds: grant.cardIds.map(
                (cardId) => projectCard(cardId, false).id
              ),
            }))
        : [],
    turn: { ...state.turn },
  };
};

const projectDefinition = (
  id: ViewDefinitionId,
  definition: CardDefinition
): ViewCardDefinition => ({
  id,
  name: definition.name,
  category: definition.category,
  imageUrl: definition.imageUrl,
  ...(definition.presentation
    ? {
        presentation: {
          ...definition.presentation,
          ...(definition.presentation.join
            ? { join: { ...definition.presentation.join } }
            : {}),
        },
      }
    : {}),
  ...(definition.imageUrlSmall
    ? { imageUrlSmall: definition.imageUrlSmall }
    : {}),
  ...(definition.playsAs ? { playsAs: definition.playsAs } : {}),
});
