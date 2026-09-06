import {
  asViewDefinitionId,
  type KnownViewCard,
  type MatchViewState,
  type ViewCardDefinition,
  type ViewDefinitionId,
  type ViewerRole,
} from '@ptcgsim/game-core';
import {
  MAX_DECK_CARDS,
  MAX_SERVER_FRAME_CODE_UNITS,
  type PresentationEvent,
} from '@ptcgsim/protocol';

import {
  emptyProjectionIdentityState,
  projectRecipient,
  type OpaqueIdSource,
} from './identity-registry.js';
import type { AuthorityMode, ReplayHistory } from './model.js';
import { presentationEventsForBatch } from './presentation-events.js';
import { replayHistoryStates } from './replay-history.js';

export interface ProjectedReplayFrame {
  readonly snapshot: MatchViewState;
  readonly localDisclosure?: {
    readonly zoneIds: readonly string[];
    readonly cards: readonly ReplayLocalDisclosureCard[];
  };
  readonly presentationEvents: readonly PresentationEvent[];
}

type ReplayLocalDisclosureCard = Omit<
  KnownViewCard,
  'face' | 'publiclyRevealed'
> & {
  readonly face: 'up';
  readonly publiclyRevealed: false;
};

export interface ProjectedReplay {
  readonly viewer: ViewerRole;
  readonly startRevision: number;
  readonly endRevision: number;
  readonly truncated: boolean;
  readonly localDisclosureDefinitions?: readonly ViewCardDefinition[];
  readonly frames: readonly ProjectedReplayFrame[];
}

const globallyUniqueOpaqueSource = (source: OpaqueIdSource): OpaqueIdSource => {
  const used = new Set<string>();
  return {
    nextOpaqueId: (kind) => {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const candidate = source.nextOpaqueId(kind);
        if (
          candidate.length >= 16 &&
          candidate.length <= 128 &&
          !used.has(candidate)
        ) {
          used.add(candidate);
          return candidate;
        }
      }
      throw new Error(
        'Opaque ID source failed to produce a globally unique replay identifier'
      );
    },
  };
};

/**
 * Reconstructs canonical history only inside the authority boundary, then
 * emits a fresh, viewer-scoped opaque projection for every retained revision.
 */
export const buildProjectedReplay = (
  history: ReplayHistory,
  viewer: ViewerRole,
  opaqueIds: OpaqueIdSource,
  mode: AuthorityMode
): ProjectedReplay => {
  if (viewer.kind === 'player' && !history.baseState.players[viewer.playerId]) {
    throw new Error('Replay viewer is not a player in this match');
  }
  const states = replayHistoryStates(history);
  const localDisclosurePlayerId =
    mode === 'solo' && viewer.kind === 'player' ? viewer.playerId : undefined;
  const candidateLocalDefinitions = new Map<
    string,
    (typeof states)[number]['definitions'][string]
  >();
  if (localDisclosurePlayerId) {
    for (const state of states) {
      for (const zone of Object.values(state.zones)) {
        if (
          zone.kind !== 'prizes' &&
          !(zone.kind === 'hand' && zone.ownerId !== localDisclosurePlayerId)
        ) {
          continue;
        }
        for (const cardId of zone.cardIds) {
          const card = state.cards[cardId];
          const definition = card
            ? state.definitions[card.definitionId]
            : undefined;
          if (definition)
            candidateLocalDefinitions.set(definition.id, definition);
        }
      }
    }
  }
  // The catalog shares one bounded server frame. Long-running deck churn must
  // disable this optional convenience instead of producing an unparseable or
  // unbounded replay artifact. The ordinary safe replay remains available.
  const estimatedCatalogCodeUnits = [...candidateLocalDefinitions.values()]
    .map(
      (definition) =>
        JSON.stringify({
          ...definition,
          id: 'x'.repeat(128),
        }).length
    )
    .reduce((total, length) => total + length + 1, 2);
  const permitsLocalDisclosure =
    localDisclosurePlayerId !== undefined &&
    candidateLocalDefinitions.size <= MAX_DECK_CARDS * 2 &&
    estimatedCatalogCodeUnits <= MAX_SERVER_FRAME_CODE_UNITS * 0.75;
  const replayOpaqueIds = permitsLocalDisclosure
    ? globallyUniqueOpaqueSource(opaqueIds)
    : opaqueIds;
  const localDefinitionIds = new Map<string, ViewDefinitionId>();
  const localDisclosureDefinitions: ViewCardDefinition[] = [];
  let identities = emptyProjectionIdentityState();
  const frames: ProjectedReplayFrame[] = [];
  for (const [index, state] of states.entries()) {
    const entry = index === 0 ? undefined : history.entries[index - 1];
    if (entry?.batch.events.some((event) => event.type === 'UndoApplied')) {
      // Undo restores an older visibility generation. Rotating all replay-local
      // aliases prevents correlation with identities from the discarded branch.
      identities = emptyProjectionIdentityState();
    }
    const projected = projectRecipient(
      state,
      viewer,
      identities,
      replayOpaqueIds
    );
    identities = projected.identities;
    const localDisclosure = permitsLocalDisclosure
      ? (() => {
          const zoneIds: string[] = [];
          const cards: ReplayLocalDisclosureCard[] = [];
          for (const zone of Object.values(state.zones)) {
            const eligible =
              zone.kind === 'prizes' ||
              (zone.kind === 'hand' &&
                zone.ownerId !== localDisclosurePlayerId);
            if (!eligible) continue;
            const projectedZone = projected.snapshot.zones[zone.id];
            if (
              !projectedZone ||
              projectedZone.kind !== zone.kind ||
              projectedZone.ownerId !== zone.ownerId ||
              projectedZone.cards.length !== zone.cardIds.length
            ) {
              throw new Error(
                'Replay local disclosure zone diverged from its safe projection'
              );
            }
            zoneIds.push(zone.id);
            for (const [cardIndex, cardId] of zone.cardIds.entries()) {
              const projectedCard = projectedZone.cards[cardIndex];
              if (!projectedCard || projectedCard.kind !== 'concealed')
                continue;
              const card = state.cards[cardId];
              const definition = card
                ? state.definitions[card.definitionId]
                : undefined;
              if (
                !card ||
                !definition ||
                card.ownerId !== projectedCard.ownerId
              ) {
                throw new Error(
                  'Replay local disclosure card diverged from canonical state'
                );
              }
              let definitionId = localDefinitionIds.get(definition.id);
              if (!definitionId) {
                definitionId = asViewDefinitionId(
                  replayOpaqueIds.nextOpaqueId('definition')
                );
                localDefinitionIds.set(definition.id, definitionId);
                localDisclosureDefinitions.push({
                  id: definitionId,
                  name: definition.name,
                  category: definition.category,
                  imageUrl: definition.imageUrl,
                  ...(definition.imageUrlSmall
                    ? { imageUrlSmall: definition.imageUrlSmall }
                    : {}),
                });
              }
              cards.push({
                kind: 'known',
                id: projectedCard.id,
                definitionId,
                ownerId: card.ownerId,
                category: card.currentCategory,
                face: 'up',
                orientationQuarterTurns: card.orientationQuarterTurns,
                abilityUsed: card.abilityUsed,
                publiclyRevealed: false,
              });
            }
          }
          return { zoneIds, cards };
        })()
      : undefined;
    frames.push({
      snapshot: projected.snapshot,
      ...(localDisclosure ? { localDisclosure } : {}),
      presentationEvents: entry
        ? presentationEventsForBatch(entry.batch, state)
        : [],
    });
  }
  const startRevision = frames[0]!.snapshot.revision;
  return {
    viewer:
      viewer.kind === 'player'
        ? { kind: 'player', playerId: viewer.playerId }
        : { kind: 'spectator' },
    startRevision,
    endRevision: frames.at(-1)!.snapshot.revision,
    truncated: startRevision > 0,
    ...(permitsLocalDisclosure ? { localDisclosureDefinitions } : {}),
    frames,
  };
};
