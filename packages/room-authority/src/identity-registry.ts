import {
  asViewCardId,
  asViewDefinitionId,
  isCardKnownToViewer,
  projectMatch,
  type CardDefinitionId,
  type CardInstanceId,
  type MatchState,
  type MatchViewState,
  type ProjectionIdentityAdapter,
  type ViewerRole,
} from '@ptcgsim/game-core';

export interface CardAlias {
  readonly alias: string;
  readonly viewerKey: string;
  readonly cardId: CardInstanceId;
  readonly visibilityGeneration: number;
  readonly known: boolean;
}

export interface DefinitionAlias {
  readonly alias: string;
  readonly viewerKey: string;
  readonly definitionId: CardDefinitionId;
}

export interface ProjectionIdentityState {
  readonly cardAliases: readonly CardAlias[];
  readonly definitionAliases: readonly DefinitionAlias[];
}

export interface OpaqueIdSource {
  readonly nextOpaqueId: (kind: 'card' | 'definition') => string;
}

export const emptyProjectionIdentityState = (): ProjectionIdentityState => ({
  cardAliases: [],
  definitionAliases: [],
});

export const viewerIdentityKey = (viewer: ViewerRole): string =>
  viewer.kind === 'player' ? `player:${viewer.playerId}` : 'spectator';

const cardAliasKey = (entry: Omit<CardAlias, 'alias'>): string =>
  `${entry.viewerKey}\u0000${entry.cardId}\u0000${entry.visibilityGeneration}\u0000${entry.known ? 'known' : 'concealed'}`;

const definitionAliasKey = (entry: Omit<DefinitionAlias, 'alias'>): string =>
  `${entry.viewerKey}\u0000${entry.definitionId}`;

const uniqueAlias = (
  kind: 'card' | 'definition',
  used: ReadonlySet<string>,
  source: OpaqueIdSource
): string => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = source.nextOpaqueId(kind);
    if (
      candidate.length >= 16 &&
      candidate.length <= 128 &&
      !used.has(candidate)
    ) {
      return candidate;
    }
  }
  throw new Error(
    'Opaque ID source failed to produce a unique bounded identifier'
  );
};

export interface ProjectedRecipient {
  readonly snapshot: MatchViewState;
  readonly identities: ProjectionIdentityState;
}

export const projectRecipient = (
  state: MatchState,
  viewer: ViewerRole,
  identities: ProjectionIdentityState,
  source: OpaqueIdSource
): ProjectedRecipient => {
  const viewerKey = viewerIdentityKey(viewer);
  const cardByKey = new Map(
    identities.cardAliases
      .filter((entry) => Boolean(state.cards[entry.cardId]))
      .map((entry) => [cardAliasKey(entry), entry])
  );
  const definitionByKey = new Map(
    identities.definitionAliases
      .filter((entry) => Boolean(state.definitions[entry.definitionId]))
      .map((entry) => [definitionAliasKey(entry), entry])
  );
  const usedAliases = new Set([
    ...identities.cardAliases.map((entry) => entry.alias),
    ...identities.definitionAliases.map((entry) => entry.alias),
  ]);
  const activeCardKeys = new Set<string>();
  const activeDefinitionKeys = new Set<string>();

  const adapter: ProjectionIdentityAdapter = {
    viewCardId: (input) => {
      const prospective = {
        viewerKey: input.viewerKey,
        cardId: input.cardId,
        visibilityGeneration: input.visibilityGeneration,
        known: input.known,
      };
      const key = cardAliasKey(prospective);
      activeCardKeys.add(key);
      let entry = cardByKey.get(key);
      if (!entry) {
        entry = {
          ...prospective,
          alias: uniqueAlias('card', usedAliases, source),
        };
        usedAliases.add(entry.alias);
        cardByKey.set(key, entry);
      }
      return asViewCardId(entry.alias);
    },
    viewDefinitionId: (input) => {
      const prospective = {
        viewerKey: input.viewerKey,
        definitionId: input.definitionId,
      };
      const key = definitionAliasKey(prospective);
      activeDefinitionKeys.add(key);
      let entry = definitionByKey.get(key);
      if (!entry) {
        entry = {
          ...prospective,
          alias: uniqueAlias('definition', usedAliases, source),
        };
        usedAliases.add(entry.alias);
        definitionByKey.set(key, entry);
      }
      return asViewDefinitionId(entry.alias);
    },
  };

  const snapshot = projectMatch(state, viewer, adapter);
  return {
    snapshot,
    identities: {
      cardAliases: [...cardByKey.entries()]
        .filter(([key, entry]) =>
          entry.viewerKey === viewerKey ? activeCardKeys.has(key) : true
        )
        .map(([, entry]) => entry),
      definitionAliases: [...definitionByKey.entries()]
        .filter(([key, entry]) =>
          entry.viewerKey === viewerKey ? activeDefinitionKeys.has(key) : true
        )
        .map(([, entry]) => entry),
    },
  };
};

export const resolveViewCard = (
  state: MatchState,
  identities: ProjectionIdentityState,
  viewer: ViewerRole,
  alias: string
): CardAlias | undefined => {
  const viewerKey = viewerIdentityKey(viewer);
  const entry = identities.cardAliases.find(
    (entry) => entry.viewerKey === viewerKey && entry.alias === alias
  );
  if (!entry) return undefined;
  const card = state.cards[entry.cardId];
  if (
    !card ||
    entry.visibilityGeneration !== card.visibilityGeneration ||
    entry.known !== isCardKnownToViewer(state, viewer, card)
  ) {
    return undefined;
  }
  return entry;
};
