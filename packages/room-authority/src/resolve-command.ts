import {
  asCardDefinitionId,
  asInspectionId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  asZoneId,
  findCardLocation,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  resolveViewCard,
  type ProjectionIdentityState,
} from './identity-registry.js';
import type { AuthorityPolicy, AuthoritySession } from './model.js';

export type CommandResolution =
  | { readonly accepted: true; readonly command: GameCommand }
  | {
      readonly accepted: false;
      readonly code: 'unauthorized' | 'stale_reference' | 'precondition_failed';
    };

const rejected = (
  code: Exclude<CommandResolution, { accepted: true }>['code']
): CommandResolution => ({ accepted: false, code });

const ownsStack = (
  state: MatchState,
  actorId: PlayerId,
  stackId: string
): boolean => state.stacks[stackId]?.boardPlayerId === actorId;

const canControlCard = (
  state: MatchState,
  actorId: PlayerId,
  ownerId: PlayerId,
  known: boolean,
  policy: AuthorityPolicy
): boolean =>
  ownerId === actorId ||
  (policy.allowOpponentPublicInteraction &&
    known &&
    Boolean(state.players[ownerId]));

export const resolveWireCommand = (
  state: MatchState,
  identities: ProjectionIdentityState,
  session: AuthoritySession,
  wire: WireGameCommand,
  policy: AuthorityPolicy
): CommandResolution => {
  if (session.viewer.kind !== 'player') return rejected('unauthorized');
  const actorId = session.viewer.playerId;

  const resolveCard = (alias: string) => {
    const entry = resolveViewCard(identities, session.viewer, alias);
    if (!entry || !state.cards[entry.cardId]) return undefined;
    return entry;
  };

  switch (wire.type) {
    case 'LoadDeck':
      return {
        accepted: true,
        command: {
          type: 'LoadDeck',
          playerId: actorId,
          entries: wire.entries.map((entry) => ({
            definition: {
              ...entry.definition,
              id: asCardDefinitionId(entry.definition.id),
            },
            count: entry.count,
          })),
        },
      };
    case 'ResetPlayer':
      return {
        accepted: true,
        command: { type: 'ResetPlayer', playerId: actorId },
      };
    case 'SetupPlayer':
      return {
        accepted: true,
        command: { type: 'SetupPlayer', playerId: actorId },
      };
    case 'MoveCard': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      if (
        !canControlCard(
          state,
          actorId,
          state.cards[card.cardId]!.ownerId,
          card.known,
          policy
        )
      ) {
        return rejected('unauthorized');
      }
      if (
        !state.zones[wire.expectedSourceZoneId] ||
        !state.zones[wire.destinationZoneId]
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveCard',
          cardId: card.cardId,
          expectedSourceZoneId: asZoneId(wire.expectedSourceZoneId),
          destinationZoneId: asZoneId(wire.destinationZoneId),
          ...(wire.destinationIndex === undefined
            ? {}
            : { destinationIndex: wire.destinationIndex }),
        },
      };
    }
    case 'MoveCardToPlay': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      if (
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy
        )
      ) {
        return rejected('unauthorized');
      }
      if (
        !state.players[wire.boardPlayerId] ||
        !state.zones[wire.expectedSourceZoneId]
      ) {
        return rejected('stale_reference');
      }
      if (wire.targetStackId && !state.stacks[wire.targetStackId]) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveCardToPlay',
          cardId: card.cardId,
          expectedSourceZoneId: asZoneId(wire.expectedSourceZoneId),
          boardPlayerId: asPlayerId(wire.boardPlayerId),
          slot: wire.slot,
          ...(wire.targetStackId
            ? { targetStackId: asStackId(wire.targetStackId) }
            : {}),
          ...(wire.benchIndex === undefined
            ? {}
            : { benchIndex: wire.benchIndex }),
        },
      };
    }
    case 'MoveCardFromStack': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      if (
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy
        )
      ) {
        return rejected('unauthorized');
      }
      const location = findCardLocation(state, card.cardId);
      if (
        !location ||
        (location.kind !== 'stackEvolution' &&
          location.kind !== 'stackAttachment') ||
        location.stackId !== wire.expectedStackId ||
        !state.zones[wire.destinationZoneId]
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveCardFromStack',
          cardId: card.cardId,
          expectedStackId: asStackId(wire.expectedStackId),
          destinationZoneId: asZoneId(wire.destinationZoneId),
          ...(wire.destinationIndex === undefined
            ? {}
            : { destinationIndex: wire.destinationIndex }),
        },
      };
    }
    case 'MovePlayStack': {
      const stack = state.stacks[wire.stackId];
      if (!stack) return rejected('stale_reference');
      if (
        !ownsStack(state, actorId, wire.stackId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const target = wire.targetStackId
        ? state.stacks[wire.targetStackId]
        : undefined;
      if (
        (wire.targetStackId && !target) ||
        (target &&
          (target.boardPlayerId !== stack.boardPlayerId ||
            target.slot !== wire.destinationSlot))
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MovePlayStack',
          stackId: asStackId(wire.stackId),
          expectedSourceSlot: wire.expectedSourceSlot,
          expectedActiveStackId: wire.expectedActiveStackId
            ? asStackId(wire.expectedActiveStackId)
            : null,
          expectedBenchStackIds: wire.expectedBenchStackIds.map(asStackId),
          destinationSlot: wire.destinationSlot,
          ...(wire.targetStackId
            ? { targetStackId: asStackId(wire.targetStackId) }
            : {}),
        },
      };
    }
    case 'MoveInspectedCard': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const location = findCardLocation(state, card.cardId);
      if (!location || location.kind !== 'inspectionWorkArea') {
        return rejected('stale_reference');
      }
      if (
        location.playerId !== actorId ||
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy
        )
      ) {
        return rejected('unauthorized');
      }
      const inspection = state.workAreas[actorId]?.inspection;
      if (
        !inspection ||
        inspection.id !== wire.expectedWorkAreaId ||
        !state.zones[wire.destinationZoneId]
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveInspectedCard',
          cardId: card.cardId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destinationZoneId: asZoneId(wire.destinationZoneId),
          ...(wire.destinationIndex === undefined
            ? {}
            : { destinationIndex: wire.destinationIndex }),
        },
      };
    }
    case 'ShuffleZone': {
      const zone = state.zones[wire.zoneId];
      if (!zone) return rejected('stale_reference');
      if (zone.ownerId !== actorId) return rejected('unauthorized');
      return {
        accepted: true,
        command: { type: 'ShuffleZone', zoneId: asZoneId(wire.zoneId) },
      };
    }
    case 'DrawCards':
      return {
        accepted: true,
        command: { type: 'DrawCards', playerId: actorId, count: wire.count },
      };
    case 'MoveZoneContents': {
      const source = state.zones[wire.sourceZoneId];
      const destination = state.zones[wire.destinationZoneId];
      if (!source || !destination) return rejected('stale_reference');
      if (source.ownerId !== actorId || destination.ownerId !== actorId) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveZoneContents',
          sourceZoneId: asZoneId(wire.sourceZoneId),
          destinationZoneId: asZoneId(wire.destinationZoneId),
        },
      };
    }
    case 'ShuffleZoneIntoDeck':
    case 'ShuffleZoneToDeckBottom': {
      const source = state.zones[wire.sourceZoneId];
      if (!source) return rejected('stale_reference');
      if (source.ownerId !== actorId) return rejected('unauthorized');
      return {
        accepted: true,
        command: {
          type: wire.type,
          playerId: actorId,
          sourceZoneId: asZoneId(wire.sourceZoneId),
        },
      };
    }
    case 'DiscardHandAndDraw':
    case 'ShuffleHandIntoDeckAndDraw':
    case 'ShuffleHandToDeckBottomAndDraw':
      return {
        accepted: true,
        command: {
          type: wire.type,
          playerId: actorId,
          count: wire.count,
        },
      };
    case 'SetDamage':
    case 'SetSpecialCondition':
    case 'SetAbilityUsed':
    case 'RotateStack': {
      const stack = state.stacks[wire.stackId];
      if (!stack) return rejected('stale_reference');
      if (
        !ownsStack(state, actorId, wire.stackId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      if (wire.type === 'SetDamage') {
        return {
          accepted: true,
          command: {
            type: 'SetDamage',
            stackId: asStackId(wire.stackId),
            damage: wire.damage,
          },
        };
      }
      if (wire.type === 'SetSpecialCondition') {
        return {
          accepted: true,
          command: {
            type: 'SetSpecialCondition',
            stackId: asStackId(wire.stackId),
            condition: wire.condition,
          },
        };
      }
      if (wire.type === 'SetAbilityUsed') {
        return {
          accepted: true,
          command: {
            type: 'SetAbilityUsed',
            stackId: asStackId(wire.stackId),
            used: wire.used,
          },
        };
      }
      return {
        accepted: true,
        command: {
          type: 'RotateStack',
          stackId: asStackId(wire.stackId),
          rotationQuarterTurns: wire.rotationQuarterTurns,
        },
      };
    }
    case 'SetCardFace':
    case 'SetCardCategory':
    case 'SetPublicReveal': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      if (
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy
        )
      ) {
        return rejected('unauthorized');
      }
      if (wire.type === 'SetCardFace') {
        return {
          accepted: true,
          command: {
            type: 'SetCardFace',
            cardId: card.cardId,
            face: wire.face,
          },
        };
      }
      if (wire.type === 'SetCardCategory') {
        return {
          accepted: true,
          command: {
            type: 'SetCardCategory',
            cardId: card.cardId,
            category: wire.category,
          },
        };
      }
      return {
        accepted: true,
        command: {
          type: 'SetPublicReveal',
          cardId: card.cardId,
          revealed: wire.revealed,
        },
      };
    }
    case 'ExtractDeckCardsForInspection': {
      const ownerId = asPlayerId(wire.ownerPlayerId);
      if (!state.players[ownerId]) return rejected('stale_reference');
      if (
        ownerId !== actorId &&
        !(wire.visibility === 'public' && policy.allowOpponentPublicInteraction)
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'ExtractDeckCardsForInspection',
          playerId: ownerId,
          viewerIds:
            wire.visibility === 'public' ? state.playerOrder : [actorId],
          count: wire.count,
          edge: wire.edge,
        },
      };
    }
    case 'CloseInspection':
      return {
        accepted: true,
        command: {
          type: 'CloseInspection',
          playerId: actorId,
          inspectionId: asInspectionId(wire.inspectionId),
          returnTo: wire.returnTo,
        },
      };
    case 'SetOncePerGameMarker':
      return {
        accepted: true,
        command: {
          type: 'SetOncePerGameMarker',
          playerId: actorId,
          marker: wire.marker,
          used: wire.used,
        },
      };
    case 'FlipCoin':
      return { accepted: true, command: { type: 'FlipCoin' } };
  }
};
