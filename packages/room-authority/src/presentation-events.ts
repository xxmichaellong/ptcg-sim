import type { EventBatch } from '@ptcgsim/game-core';
import type { PresentationEvent } from '@ptcgsim/protocol';

export const presentationEventsForBatch = (
  batch: EventBatch
): readonly PresentationEvent[] =>
  batch.events.flatMap((event): PresentationEvent[] => {
    if (event.type === 'CoinFlipped') {
      return [
        {
          type: 'CoinFlipped',
          revision: batch.revision,
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
      return [
        {
          type: event.revealed ? 'PublicCardsRevealed' : 'PublicCardsHidden',
          revision: batch.revision,
          playerId: event.playerId,
          cardCount: event.cardIds.length,
        },
      ];
    }
    if (event.type === 'InspectionGrantOpened') {
      return event.viewerIds.map((viewerPlayerId) => ({
        type: 'PrivateInspectionStarted',
        revision: batch.revision,
        sourcePlayerId: event.sourcePlayerId,
        viewerPlayerId,
        cardCount: event.cardIds.length,
      }));
    }
    if (event.type === 'InspectionGrantClosed') {
      return [
        {
          type: 'PrivateInspectionEnded',
          revision: batch.revision,
          sourcePlayerId: event.sourcePlayerId,
          viewerPlayerId: event.viewerId,
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
