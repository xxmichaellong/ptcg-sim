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
}

export interface ConcealedViewCard {
  readonly kind: 'concealed';
  readonly id: ViewCardId;
  readonly ownerId: PlayerId;
  readonly cardBackUrl: string;
}

export type ViewCard = KnownViewCard | ConcealedViewCard;

export interface ViewCardDefinition {
  readonly id: ViewDefinitionId;
  readonly name: string;
  readonly category: CardCategory;
  readonly imageUrl: string;
  readonly imageUrlSmall?: string;
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
          readonly evolutionCards: readonly ViewCard[];
          readonly attachmentCards: readonly ViewCard[];
          readonly suggestedSlot: 'active' | 'bench';
        } | null;
      }
    >
  >;
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
      areas.inspection.viewerIds.includes(viewer.playerId)
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

const isCardKnown = (
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
    if (zone.kind === 'deck' || zone.kind === 'prizes') return false;
    if (zone.kind === 'hand') {
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

export const projectMatch = (
  state: MatchState,
  viewer: ViewerRole,
  identities: ProjectionIdentityAdapter
): MatchViewState => {
  const key = viewerKey(viewer);
  const definitions: Record<string, ViewCardDefinition> = {};

  const projectCard = (cardId: CardInstanceId): ViewCard => {
    const card = state.cards[cardId];
    if (!card) throw new Error(`Projection references missing card ${cardId}`);
    const known = isCardKnown(state, viewer, card);
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
    return {
      kind: 'known',
      id,
      definitionId,
      ownerId: card.ownerId,
      category: card.currentCategory,
      face: card.face,
      orientationQuarterTurns: card.orientationQuarterTurns,
      abilityUsed: card.abilityUsed,
    };
  };

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
          cards: zone.cardIds.map(projectCard),
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
          evolutionCards: stack.evolutionCardIds.map(projectCard),
          attachmentCards: stack.attachmentCardIds.map(projectCard),
          rotationQuarterTurns: stack.rotationQuarterTurns,
          damage: stack.damage,
          specialCondition: stack.specialCondition,
          abilityUsed: stack.abilityUsed,
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
                cards: areas.inspection.cardIds.map(projectCard),
              }
            : null,
          attachmentResolution: areas.attachmentResolution
            ? {
                id: areas.attachmentResolution.id,
                sourceStackId: areas.attachmentResolution.sourceStackId,
                evolutionCards:
                  areas.attachmentResolution.evolutionCardIds.map(projectCard),
                attachmentCards:
                  areas.attachmentResolution.attachmentCardIds.map(projectCard),
                suggestedSlot: areas.attachmentResolution.suggestedSlot,
              }
            : null,
        },
      ])
    ),
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
  ...(definition.imageUrlSmall
    ? { imageUrlSmall: definition.imageUrlSmall }
    : {}),
});
