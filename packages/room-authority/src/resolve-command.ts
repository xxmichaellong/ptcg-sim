import {
  asCardDefinitionId,
  asInspectionId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  asZoneId,
  cardSourceSnapshot,
  findCardLocation,
  playerZoneId,
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

const canInspectPrivateCards = (
  state: MatchState,
  actorId: PlayerId,
  cardIds: readonly string[]
): boolean =>
  cardIds.every((cardId) => {
    const ownerId = state.cards[cardId]?.ownerId;
    if (!ownerId) return false;
    return (
      ownerId === actorId ||
      (state.players[actorId]?.coachingConsent === true &&
        state.players[ownerId]?.coachingConsent === true)
    );
  });

export const resolveWireCommand = (
  state: MatchState,
  identities: ProjectionIdentityState,
  session: AuthoritySession,
  wire: WireGameCommand,
  policy: AuthorityPolicy,
  observedRevision: number = state.revision
): CommandResolution => {
  if (session.viewer.kind !== 'player') return rejected('unauthorized');
  const actorId = session.viewer.playerId;
  if (
    (wire.type === 'StartTurn' ||
      wire.type === 'DeclareAttack' ||
      wire.type === 'PassTurn' ||
      wire.type === 'SetupPlayer' ||
      wire.type === 'ResetPlayer' ||
      wire.type === 'LoadDeck' ||
      wire.type === 'SetPublicReveal' ||
      wire.type === 'SetZonePublicReveal' ||
      wire.type === 'BeginZoneInspection' ||
      wire.type === 'BeginCardInspection' ||
      wire.type === 'EndPrivateInspection') &&
    observedRevision !== state.revision
  ) {
    return rejected('stale_reference');
  }

  const resolveCard = (alias: string) => {
    const entry = resolveViewCard(identities, session.viewer, alias);
    if (!entry || !state.cards[entry.cardId]) return undefined;
    return entry;
  };

  switch (wire.type) {
    case 'LoadDeck': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'LoadDeck',
          playerId: targetPlayerId,
          entries: wire.entries.map((entry) => ({
            definition: {
              ...entry.definition,
              id: asCardDefinitionId(entry.definition.id),
            },
            count: entry.count,
          })),
        },
      };
    }
    case 'ResetPlayer':
    case 'SetupPlayer': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command:
          wire.type === 'SetupPlayer'
            ? { type: 'SetupPlayer', playerId: targetPlayerId }
            : { type: 'ResetPlayer', playerId: targetPlayerId },
      };
    }
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
    case 'MoveStagedCard': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const location = findCardLocation(state, card.cardId);
      if (
        !location ||
        location.kind !== 'attachmentResolutionWorkArea' ||
        location.playerId !== actorId
      ) {
        return rejected('unauthorized');
      }
      const resolution = state.workAreas[actorId]?.attachmentResolution;
      if (
        !resolution ||
        resolution.id !== wire.expectedWorkAreaId ||
        !state.zones[wire.destinationZoneId]
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveStagedCard',
          cardId: card.cardId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destinationZoneId: asZoneId(wire.destinationZoneId),
          ...(wire.destinationIndex === undefined
            ? {}
            : { destinationIndex: wire.destinationIndex }),
        },
      };
    }
    case 'RestoreStagedStack': {
      const resolution = state.workAreas[actorId]?.attachmentResolution;
      const board = state.boards[actorId];
      if (!resolution || resolution.id !== wire.expectedWorkAreaId || !board) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'RestoreStagedStack',
          playerId: actorId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          expectedActiveStackId: wire.expectedActiveStackId
            ? asStackId(wire.expectedActiveStackId)
            : null,
          expectedBenchStackIds: wire.expectedBenchStackIds.map(asStackId),
          destinationSlot: wire.destinationSlot,
          ...(wire.benchIndex === undefined
            ? {}
            : { benchIndex: wire.benchIndex }),
        },
      };
    }
    case 'ResolveStagedCards': {
      const resolution = state.workAreas[actorId]?.attachmentResolution;
      if (!resolution || resolution.id !== wire.expectedWorkAreaId) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'ResolveStagedCards',
          playerId: actorId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destination: wire.destination,
        },
      };
    }
    case 'ResolveInspectionCards': {
      const inspection = state.workAreas[actorId]?.inspection;
      if (!inspection || inspection.id !== wire.expectedWorkAreaId) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'ResolveInspectionCards',
          playerId: actorId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destination: wire.destination,
        },
      };
    }
    case 'MoveCardToDeckTop':
    case 'MoveCardToDeckBottom':
    case 'ShuffleCardIntoDeck':
    case 'ChangeCardCategory':
    case 'SwapCardWithDeckTop': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const location = findCardLocation(state, card.cardId);
      if (!location) return rejected('stale_reference');

      let sourceId: string;
      let sourcePlayerId: PlayerId;
      let expectedSourceId:
        | ReturnType<typeof asZoneId>
        | ReturnType<typeof asStackId>
        | ReturnType<typeof asWorkAreaId>;
      switch (location.kind) {
        case 'zone': {
          const zone = state.zones[location.zoneId];
          if (!zone) return rejected('stale_reference');
          sourceId = zone.id;
          sourcePlayerId = zone.ownerId ?? canonicalCard.ownerId;
          expectedSourceId = asZoneId(wire.expectedSourceId);
          break;
        }
        case 'stackEvolution':
        case 'stackAttachment': {
          const stack = state.stacks[location.stackId];
          if (!stack) return rejected('stale_reference');
          sourceId = stack.id;
          sourcePlayerId = stack.boardPlayerId;
          expectedSourceId = asStackId(wire.expectedSourceId);
          break;
        }
        case 'inspectionWorkArea': {
          const inspection = state.workAreas[location.playerId]?.inspection;
          if (!inspection || location.playerId !== actorId) {
            return rejected('unauthorized');
          }
          sourceId = inspection.id;
          sourcePlayerId = location.playerId;
          expectedSourceId = asWorkAreaId(wire.expectedSourceId);
          break;
        }
        case 'attachmentResolutionWorkArea': {
          const resolution =
            state.workAreas[location.playerId]?.attachmentResolution;
          if (!resolution || location.playerId !== actorId) {
            return rejected('unauthorized');
          }
          sourceId = resolution.id;
          sourcePlayerId = location.playerId;
          expectedSourceId = asWorkAreaId(wire.expectedSourceId);
          break;
        }
      }
      if (sourceId !== wire.expectedSourceId) {
        return rejected('stale_reference');
      }
      if (
        sourcePlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      if (
        location.kind !== 'attachmentResolutionWorkArea' &&
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
      if (wire.type === 'ChangeCardCategory') {
        return {
          accepted: true,
          command: {
            type: 'ChangeCardCategory',
            playerId: sourcePlayerId,
            cardId: card.cardId,
            expectedSourceId,
            category: wire.category,
          },
        };
      }
      return {
        accepted: true,
        command: {
          type: wire.type,
          playerId: sourcePlayerId,
          cardId: card.cardId,
          expectedSourceId,
        },
      };
    }
    case 'MovePrizesToDeckBottom':
      return {
        accepted: true,
        command: { type: 'MovePrizesToDeckBottom', playerId: actorId },
      };
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
    case 'StartTurn':
    case 'DeclareAttack':
    case 'PassTurn': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command:
          wire.type === 'StartTurn'
            ? { type: 'StartTurn', playerId: targetPlayerId }
            : wire.type === 'DeclareAttack'
              ? { type: 'DeclareAttack', playerId: targetPlayerId }
              : { type: 'PassTurn', playerId: targetPlayerId },
      };
    }
    case 'MoveZoneContents': {
      const source = state.zones[wire.sourceZoneId];
      const destination = state.zones[wire.destinationZoneId];
      if (!source || !destination) return rejected('stale_reference');
      if (source.ownerId !== actorId || destination.ownerId !== actorId) {
        return rejected('unauthorized');
      }
      if (source.kind === 'board' || destination.kind === 'board') {
        return rejected('precondition_failed');
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
    case 'ResolveLooseBoardCards': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const board = state.zones[playerZoneId(targetPlayerId, 'board')];
      if (!board || board.ownerId !== targetPlayerId) {
        return rejected('stale_reference');
      }
      const resolvedCards = wire.expectedBoardCardIds.map(resolveCard);
      if (resolvedCards.some((card) => !card)) {
        return rejected('stale_reference');
      }
      const expectedBoardCardIds = resolvedCards.map((card) => card!.cardId);
      if (
        board.cardIds.length !== expectedBoardCardIds.length ||
        board.cardIds.some(
          (cardId, index) => cardId !== expectedBoardCardIds[index]
        )
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'ResolveLooseBoardCards',
          playerId: targetPlayerId,
          expectedBoardCardIds,
          destination: wire.destination,
        },
      };
    }
    case 'ShuffleZoneIntoDeck':
    case 'ShuffleZoneToDeckBottom': {
      const source = state.zones[wire.sourceZoneId];
      if (!source) return rejected('stale_reference');
      if (source.ownerId !== actorId) return rejected('unauthorized');
      if (source.kind === 'board') return rejected('precondition_failed');
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
    case 'SetCardOrientation':
    case 'SetCardAbilityUsed': {
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
      if (wire.type === 'SetCardOrientation') {
        return {
          accepted: true,
          command: {
            type: 'SetCardOrientation',
            cardId: card.cardId,
            orientationQuarterTurns: wire.orientationQuarterTurns,
          },
        };
      }
      if (wire.type === 'SetCardAbilityUsed') {
        return {
          accepted: true,
          command: {
            type: 'SetCardAbilityUsed',
            cardId: card.cardId,
            used: wire.used,
          },
        };
      }
      throw new Error('Unreachable card annotation command');
    }
    case 'SetPublicReveal': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const location = findCardLocation(state, card.cardId);
      const source = location
        ? cardSourceSnapshot(state, canonicalCard, location)
        : null;
      if (!source || source.id !== wire.expectedSourceId) {
        return rejected('stale_reference');
      }
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
      return {
        accepted: true,
        command: {
          type: 'SetPublicReveal',
          playerId: source.playerId,
          cardId: card.cardId,
          expectedSourceId: source.id,
          revealed: wire.revealed,
        },
      };
    }
    case 'SetZonePublicReveal': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const zone = state.zones[wire.zoneId];
      if (
        !zone ||
        zone.id !== playerZoneId(targetPlayerId, 'prizes') ||
        zone.kind !== 'prizes' ||
        zone.ownerId !== targetPlayerId
      ) {
        return rejected('stale_reference');
      }
      const cardIds = wire.expectedCardIds.map(
        (alias) => resolveCard(alias)?.cardId
      );
      if (
        cardIds.some((cardId) => cardId === undefined) ||
        new Set(cardIds).size !== cardIds.length ||
        cardIds.length !== zone.cardIds.length ||
        cardIds.some((cardId, index) => cardId !== zone.cardIds[index])
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'SetZonePublicReveal',
          playerId: targetPlayerId,
          zoneId: zone.id,
          expectedCardIds: [...zone.cardIds],
          revealed: wire.revealed,
        },
      };
    }
    case 'BeginZoneInspection': {
      const sourcePlayerId = asPlayerId(wire.targetPlayerId);
      if (!state.players[sourcePlayerId]) return rejected('stale_reference');
      const zone = state.zones[wire.zoneId];
      if (
        !zone ||
        zone.ownerId !== sourcePlayerId ||
        (zone.kind !== 'hand' && zone.kind !== 'prizes')
      ) {
        return rejected('stale_reference');
      }
      const cardIds = wire.expectedCardIds.map(
        (alias) => resolveCard(alias)?.cardId
      );
      if (
        cardIds.some((cardId) => cardId === undefined) ||
        new Set(cardIds).size !== cardIds.length ||
        cardIds.length !== zone.cardIds.length ||
        cardIds.some((cardId, index) => cardId !== zone.cardIds[index])
      ) {
        return rejected('stale_reference');
      }
      if (!canInspectPrivateCards(state, actorId, zone.cardIds)) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'BeginZoneInspection',
          sourcePlayerId,
          viewerPlayerId: actorId,
          sourceZoneId: zone.id,
          expectedCardIds: [...zone.cardIds],
        },
      };
    }
    case 'BeginCardInspection': {
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const location = findCardLocation(state, card.cardId);
      const source = location
        ? cardSourceSnapshot(state, canonicalCard, location)
        : null;
      if (!source || source.id !== wire.expectedSourceId) {
        return rejected('stale_reference');
      }
      if (!canInspectPrivateCards(state, actorId, [card.cardId])) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'BeginCardInspection',
          playerId: source.playerId,
          viewerPlayerId: actorId,
          cardId: card.cardId,
          expectedSourceId: source.id,
        },
      };
    }
    case 'EndPrivateInspection': {
      const inspectionId = asInspectionId(wire.inspectionId);
      const grant = state.visibility.inspectionGrants[inspectionId];
      if (!grant || !grant.viewerIds.includes(actorId)) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'EndPrivateInspection',
          viewerPlayerId: actorId,
          inspectionId,
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
    case 'SetOncePerGameMarker': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!state.players[targetPlayerId]) return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'SetOncePerGameMarker',
          playerId: targetPlayerId,
          marker: wire.marker,
          used: wire.used,
        },
      };
    }
    case 'FlipCoin':
      return { accepted: true, command: { type: 'FlipCoin' } };
  }
};
