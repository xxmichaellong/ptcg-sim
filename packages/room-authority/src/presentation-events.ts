import {
  isCardKnownToViewer,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import type { PresentationEvent } from '@ptcgsim/protocol';

type PresentationCardSource = Extract<
  PresentationEvent,
  { readonly type: 'PublicCardsRevealed' }
>['source'];

const presentationCardSource = (
  state: MatchState,
  sourceId: string
): PresentationCardSource => {
  const zone = state.zones[sourceId];
  if (zone) return zone.kind;
  const stack = state.stacks[sourceId];
  if (stack) return stack.slot;
  for (const areas of Object.values(state.workAreas)) {
    if (areas.inspection?.id === sourceId) {
      return state.zones[areas.inspection.sourceZoneId]?.kind ?? 'inspection';
    }
    if (areas.attachmentResolution?.id === sourceId) {
      return 'attachmentResolution';
    }
  }
  throw new Error('Presentation event references a missing card source');
};

const publiclyKnownCardName = (
  state: MatchState,
  cardId: string
): string | undefined => {
  const card = state.cards[cardId];
  if (!card || !isCardKnownToViewer(state, { kind: 'spectator' }, card)) {
    return undefined;
  }
  return state.definitions[card.definitionId]?.name;
};

export const presentationEventsForBatch = (
  batch: EventBatch,
  state: MatchState
): readonly PresentationEvent[] => {
  if (state.revision !== batch.revision) {
    throw new Error('Presentation state revision does not match event batch');
  }
  return batch.events.flatMap((event): PresentationEvent[] => {
    if (event.type === 'CoinFlipped') {
      return [
        {
          type: 'CoinFlipped',
          revision: batch.revision,
          playerId: event.playerId,
          result: event.result,
        },
      ];
    }
    if (event.type === 'PlayerReset') {
      return [
        {
          type: 'PlayerReset',
          revision: batch.revision,
          playerId: event.playerId,
        },
      ];
    }
    if (event.type === 'DeckLoaded') {
      return [
        {
          type: 'DeckLoaded',
          revision: batch.revision,
          playerId: event.playerId,
          cardCount: event.deckOrder.length,
        },
      ];
    }
    if (event.type === 'PlayerSetup') {
      return [
        {
          type: 'PlayerSetup',
          revision: batch.revision,
          playerId: event.playerId,
          handCount: event.handOrder.length,
          prizeCount: event.prizeOrder.length,
        },
      ];
    }
    if (event.type === 'RandomHandCardPlayedFaceDown') {
      return [
        {
          type: 'RandomCardPlayedFaceDown',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
        },
      ];
    }
    if (event.type === 'PublicRevealSet') {
      const source = presentationCardSource(state, event.expectedSourceId);
      const cardName =
        event.revealed && event.scope === 'card'
          ? publiclyKnownCardName(state, event.cardIds[0]!)
          : undefined;
      if (event.revealed && event.scope === 'card' && !cardName) {
        throw new Error(
          'Public single-card reveal is not known to the spectator projection'
        );
      }
      return [
        {
          type: event.revealed ? 'PublicCardsRevealed' : 'PublicCardsHidden',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          playerId: event.playerId,
          scope: event.scope,
          source,
          cardCount: event.cardIds.length,
          ...(cardName ? { cardName } : {}),
        },
      ];
    }
    if (event.type === 'InspectionGrantOpened') {
      const source = presentationCardSource(state, event.sourceId);
      return event.viewerIds.map((viewerPlayerId) => ({
        type: 'PrivateInspectionStarted',
        revision: batch.revision,
        sourcePlayerId: event.sourcePlayerId,
        viewerPlayerId,
        scope: event.scope,
        source,
        cardCount: event.cardIds.length,
      }));
    }
    if (event.type === 'InspectionGrantClosed') {
      const source = presentationCardSource(state, event.sourceId);
      return [
        {
          type: 'PrivateInspectionEnded',
          revision: batch.revision,
          sourcePlayerId: event.sourcePlayerId,
          viewerPlayerId: event.viewerId,
          scope: event.scope,
          source,
          cardCount: event.expectedCardIds.length,
        },
      ];
    }
    if (event.type === 'UndoApplied') {
      return [
        {
          type: 'UndoApplied',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
          revertedRevision: event.revertedRevision,
        },
      ];
    }
    if (event.type !== 'TableActionDeclared') return [];
    const common = {
      revision: batch.revision,
      playerId: event.playerId,
      turnNumber: event.turnNumber,
    };
    if (event.action === 'attack') {
      return [{ type: 'AttackDeclared', ...common }];
    }
    if (event.action === 'pass') {
      return [{ type: 'PassDeclared', ...common }];
    }
    return [
      {
        type:
          event.outcome === 'drawn' ? 'TurnStarted' : 'TurnStartFailedNoDeck',
        ...common,
      },
    ];
  });
};
