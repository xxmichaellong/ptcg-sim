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
  stadiumZoneId,
  type CardInstanceId,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  resolveViewCard,
  type ProjectionIdentityState,
} from './identity-registry.js';
import type {
  AuthorityMode,
  AuthorityPolicy,
  AuthoritySession,
  UndoCheckpoint,
} from './model.js';
import { ownEntry } from './own-entry.js';

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
): boolean => ownEntry(state.stacks, stackId)?.boardPlayerId === actorId;

const canControlCard = (
  state: MatchState,
  actorId: PlayerId,
  ownerId: PlayerId,
  known: boolean,
  policy: AuthorityPolicy,
  mode: AuthorityMode
): boolean =>
  ownerId === actorId ||
  // Solo's one player controls both seats' cards, face-down ones too: a
  // flipped board takes the other seat's prizes.
  (mode === 'solo' && Boolean(ownEntry(state.players, ownerId))) ||
  (policy.allowOpponentPublicInteraction &&
    known &&
    Boolean(ownEntry(state.players, ownerId)));

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
      (ownEntry(state.players, actorId)?.coachingConsent === true &&
        ownEntry(state.players, ownerId)?.coachingConsent === true)
    );
  });

/**
 * Each player's card definitions are their own. A catalog ID shared with the
 * other player's deck let a deck load probe that player's concealed cards
 * (game-core refuses a clashing definition) and mixed their decklists' Sort
 * order. Clients only ever see opaque definition IDs, so this never shows.
 */
const ownedDefinitionId = (ownerId: PlayerId, definitionId: string) =>
  asCardDefinitionId(`${ownerId}/${definitionId}`);

export const resolveWireCommand = (
  state: MatchState,
  identities: ProjectionIdentityState,
  session: AuthoritySession,
  wire: WireGameCommand,
  policy: AuthorityPolicy,
  observedRevision: number = state.revision,
  undoContext: {
    readonly mode: AuthorityMode;
    readonly checkpoint?: UndoCheckpoint;
  } = { mode: 'multiplayer' }
): CommandResolution => {
  if (session.viewer.kind !== 'player') return rejected('unauthorized');
  const actorId = session.viewer.playerId;
  if (
    (wire.type === 'StartTurn' ||
      wire.type === 'DeclareAttack' ||
      wire.type === 'PassTurn' ||
      wire.type === 'PlayRandomCardFaceDown' ||
      wire.type === 'SetupPlayer' ||
      wire.type === 'ResetPlayer' ||
      wire.type === 'LoadDeck' ||
      wire.type === 'SetCardBack' ||
      wire.type === 'ApplySoloUndo' ||
      wire.type === 'SetPublicReveal' ||
      wire.type === 'SetZonePublicReveal' ||
      wire.type === 'BeginZoneInspection' ||
      wire.type === 'BeginCardInspection' ||
      wire.type === 'EndPrivateInspection') &&
    observedRevision !== state.revision
  ) {
    return rejected('stale_reference');
  }

  // Solo's one player controls both seats, and so both seats' windows (a
  // look at a deck, attached cards being moved) whichever side is down.
  const controlsSeat = (playerId: PlayerId): boolean =>
    playerId === actorId || undoContext.mode === 'solo';

  const resolveCard = (alias: string) => {
    return resolveViewCard(
      state,
      identities,
      session.viewer,
      alias,
      undoContext.mode
    );
  };

  switch (wire.type) {
    case 'LoadDeck': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
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
              id: ownedDefinitionId(targetPlayerId, entry.definition.id),
            },
            count: entry.count,
          })),
        },
      };
    }
    case 'SetCardBack': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (targetPlayerId !== actorId && undoContext.mode !== 'solo') {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'SetCardBack',
          playerId: targetPlayerId,
          cardBackUrl: wire.cardBackUrl,
        },
      };
    }
    case 'ResetPlayer':
    case 'SetupPlayer': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
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
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      if (
        !ownEntry(state.zones, wire.expectedSourceZoneId) ||
        !ownEntry(state.zones, wire.destinationZoneId)
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
          // Public-pile controls rearrange a card in place. Internal legacy
          // callers omit this mode and keep their historical move semantics.
          ...(wire.expectedSourceZoneId === wire.destinationZoneId &&
          (ownEntry(state.zones, wire.destinationZoneId)?.kind === 'discard' ||
            ownEntry(state.zones, wire.destinationZoneId)?.kind === 'lostZone')
            ? { publicPileOrderVersion: 1 as const }
            : {}),
          // A native indexed arrangement stays in its hand or loose board.
          // Unflagged internal/legacy moves retain their original behavior.
          ...(wire.expectedSourceZoneId === wire.destinationZoneId &&
          typeof wire.destinationIndex === 'number' &&
          Number.isSafeInteger(wire.destinationIndex) &&
          wire.destinationIndex >= 0 &&
          (ownEntry(state.zones, wire.destinationZoneId)?.kind === 'hand' ||
            ownEntry(state.zones, wire.destinationZoneId)?.kind === 'board')
            ? { arrangementOrderVersion: 1 as const }
            : {}),
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
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      if (
        !ownEntry(state.players, wire.boardPlayerId) ||
        !ownEntry(state.zones, wire.expectedSourceZoneId)
      ) {
        return rejected('stale_reference');
      }
      if (wire.targetStackId && !ownEntry(state.stacks, wire.targetStackId)) {
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
    case 'PlaceCardOnPlayStack': {
      const card = resolveCard(wire.cardId);
      const expectedTargetTop = resolveCard(wire.expectedTargetTopCardId);
      if (!card || !expectedTargetTop) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId];
      const location = canonicalCard
        ? findCardLocation(state, canonicalCard.id)
        : null;
      if (!canonicalCard || !location) return rejected('stale_reference');

      let sourceId: string;
      let sourcePlayerId: PlayerId;
      let expectedSourceId:
        | ReturnType<typeof asZoneId>
        | ReturnType<typeof asStackId>
        | ReturnType<typeof asWorkAreaId>;
      switch (location.kind) {
        case 'zone': {
          const zone = ownEntry(state.zones, location.zoneId);
          if (!zone) return rejected('stale_reference');
          sourceId = zone.id;
          sourcePlayerId = zone.ownerId ?? canonicalCard.ownerId;
          expectedSourceId = asZoneId(wire.expectedSourceId);
          break;
        }
        case 'stackEvolution':
        case 'stackAttachment': {
          const stack = ownEntry(state.stacks, location.stackId);
          if (!stack) return rejected('stale_reference');
          sourceId = stack.id;
          sourcePlayerId = stack.boardPlayerId;
          expectedSourceId = asStackId(wire.expectedSourceId);
          break;
        }
        case 'inspectionWorkArea': {
          const inspection = ownEntry(
            state.workAreas,
            location.playerId
          )?.inspection;
          if (!inspection || !controlsSeat(location.playerId)) {
            return rejected('unauthorized');
          }
          sourceId = inspection.id;
          sourcePlayerId = location.playerId;
          expectedSourceId = asWorkAreaId(wire.expectedSourceId);
          break;
        }
        case 'attachmentResolutionWorkArea': {
          const resolution = ownEntry(
            state.workAreas,
            location.playerId
          )?.attachmentResolution;
          if (!resolution || !controlsSeat(location.playerId)) {
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
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }

      const target = ownEntry(state.stacks, wire.targetStackId);
      if (
        !target ||
        target.evolutionCardIds.at(-1) !== expectedTargetTop.cardId
      ) {
        return rejected('stale_reference');
      }
      let derivedMode: typeof wire.mode;
      if (location.kind === 'stackEvolution') {
        const sourceStack = ownEntry(state.stacks, location.stackId);
        if (
          !sourceStack ||
          location.index >= sourceStack.evolutionCardIds.length - 1
        ) {
          return rejected('precondition_failed');
        }
        derivedMode = 'attachment';
      } else if (location.kind === 'stackAttachment') {
        derivedMode = 'attachment';
      } else {
        derivedMode =
          canonicalCard.currentCategory === 'Pokémon'
            ? 'evolution'
            : 'attachment';
      }
      if (derivedMode !== wire.mode) return rejected('stale_reference');
      // A Pokémon evolving one on the other player's board changes their
      // Pokémon: a room that keeps players to their own cards refuses it.
      // (Attaching, a Tool such as Head Ringer included, is the game's own.)
      if (
        derivedMode === 'evolution' &&
        target.boardPlayerId !== sourcePlayerId &&
        !controlsSeat(target.boardPlayerId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }

      return {
        accepted: true,
        command: {
          type: 'PlaceCardOnPlayStack',
          playerId: sourcePlayerId,
          cardId: canonicalCard.id,
          expectedSourceId,
          targetStackId: asStackId(wire.targetStackId),
          expectedTargetTopCardId: expectedTargetTop.cardId,
          mode: derivedMode,
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
          policy,
          undoContext.mode
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
        !ownEntry(state.zones, wire.destinationZoneId)
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
    case 'MovePlayStackToZone': {
      const stack = ownEntry(state.stacks, wire.stackId);
      if (!stack || !ownEntry(state.zones, wire.destinationZoneId)) {
        return rejected('stale_reference');
      }
      if (
        !ownsStack(state, actorId, wire.stackId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const carried = [
        ...wire.expectedEvolutionCardIds,
        ...wire.expectedAttachmentCardIds,
      ].map(resolveCard);
      if (carried.some((card) => !card)) return rejected('stale_reference');
      // Every card it carries must be one the actor may move on its own: a
      // face-down card of the opponent's would be turned up by the move.
      if (
        carried.some(
          (card) =>
            !canControlCard(
              state,
              actorId,
              state.cards[card!.cardId]!.ownerId,
              card!.known,
              policy,
              undoContext.mode
            )
        )
      ) {
        return rejected('unauthorized');
      }
      const canonical = (aliases: readonly string[]) =>
        aliases.map((alias) => resolveCard(alias)!.cardId);
      const evolutionCardIds = canonical(wire.expectedEvolutionCardIds);
      const attachmentCardIds = canonical(wire.expectedAttachmentCardIds);
      return {
        accepted: true,
        command: {
          type: 'MovePlayStackToZone',
          stackId: asStackId(wire.stackId),
          expectedEvolutionCardIds: evolutionCardIds as CardInstanceId[],
          expectedAttachmentCardIds: attachmentCardIds as CardInstanceId[],
          destinationZoneId: asZoneId(wire.destinationZoneId),
          ...(wire.destinationIndex === undefined
            ? {}
            : { destinationIndex: wire.destinationIndex }),
        },
      };
    }
    case 'MovePlayStack': {
      const stack = ownEntry(state.stacks, wire.stackId);
      if (!stack) return rejected('stale_reference');
      // Moved to the other board since it was seen: a stale move.
      if (
        wire.expectedSourceBoardPlayerId !== undefined &&
        wire.expectedSourceBoardPlayerId !== stack.boardPlayerId
      ) {
        return rejected('stale_reference');
      }
      if (
        !ownsStack(state, actorId, wire.stackId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      // Onto the other player's board: the Pokémon traded with or pushed
      // aside there, and the board itself, are theirs.
      const across =
        wire.destinationBoard &&
        wire.destinationBoard.boardPlayerId !== stack.boardPlayerId
          ? wire.destinationBoard
          : undefined;
      const destinationPlayerId = across
        ? asPlayerId(across.boardPlayerId)
        : stack.boardPlayerId;
      if (across) {
        if (!ownEntry(state.boards, destinationPlayerId)) {
          return rejected('stale_reference');
        }
        if (
          !controlsSeat(destinationPlayerId) &&
          !policy.allowOpponentPublicInteraction
        ) {
          return rejected('unauthorized');
        }
      }
      const target = wire.targetStackId
        ? ownEntry(state.stacks, wire.targetStackId)
        : undefined;
      if (
        (wire.targetStackId && !target) ||
        (target &&
          (target.boardPlayerId !== destinationPlayerId ||
            target.slot !== wire.destinationSlot))
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MovePlayStack',
          stackId: asStackId(wire.stackId),
          ...(wire.expectedSourceBoardPlayerId === undefined
            ? {}
            : {
                expectedSourceBoardPlayerId: asPlayerId(
                  wire.expectedSourceBoardPlayerId
                ),
              }),
          expectedSourceSlot: wire.expectedSourceSlot,
          expectedActiveStackId: wire.expectedActiveStackId
            ? asStackId(wire.expectedActiveStackId)
            : null,
          expectedBenchStackIds: wire.expectedBenchStackIds.map(asStackId),
          destinationSlot: wire.destinationSlot,
          ...(wire.targetStackId
            ? { targetStackId: asStackId(wire.targetStackId) }
            : {}),
          ...(wire.benchIndex === undefined
            ? {}
            : { benchIndex: wire.benchIndex }),
          ...(across
            ? {
                destinationBoard: {
                  boardPlayerId: destinationPlayerId,
                  expectedActiveStackId: across.expectedActiveStackId
                    ? asStackId(across.expectedActiveStackId)
                    : null,
                  expectedBenchStackIds:
                    across.expectedBenchStackIds.map(asStackId),
                },
              }
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
        !controlsSeat(location.playerId) ||
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      const inspection = ownEntry(
        state.workAreas,
        location.playerId
      )?.inspection;
      if (
        !inspection ||
        inspection.id !== wire.expectedWorkAreaId ||
        !ownEntry(state.zones, wire.destinationZoneId)
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
    case 'MoveInspectedCardToPlay': {
      // A card being looked at, played straight to Active or the Bench: as
      // MoveInspectedCard to its owner's hand and MoveCardToPlay from there.
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const location = findCardLocation(state, card.cardId);
      if (!location || location.kind !== 'inspectionWorkArea') {
        return rejected('stale_reference');
      }
      if (
        !controlsSeat(location.playerId) ||
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      const inspection = ownEntry(
        state.workAreas,
        location.playerId
      )?.inspection;
      if (
        !inspection ||
        inspection.id !== wire.expectedWorkAreaId ||
        !ownEntry(state.players, wire.boardPlayerId)
      ) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveInspectedCardToPlay',
          cardId: card.cardId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          boardPlayerId: asPlayerId(wire.boardPlayerId),
          slot: wire.slot,
          ...(wire.benchIndex === undefined
            ? {}
            : { benchIndex: wire.benchIndex }),
        },
      };
    }
    case 'MoveCardToWorkArea': {
      // v1's popups accept drops as well as produce them: a card dragged onto
      // the deck viewer or the attached-card window joins that set. The area
      // must be the actor's own open window, as with every other work-area
      // command, and the card must be one the actor may move.
      const card = resolveCard(wire.cardId);
      if (!card) return rejected('stale_reference');
      const canonicalCard = state.cards[card.cardId]!;
      const open = Object.entries(state.workAreas).some(
        ([playerId, areas]) =>
          controlsSeat(asPlayerId(playerId)) &&
          (areas?.inspection?.id === wire.expectedWorkAreaId ||
            areas?.attachmentResolution?.id === wire.expectedWorkAreaId)
      );
      if (!open) return rejected('stale_reference');
      if (
        !canControlCard(
          state,
          actorId,
          canonicalCard.ownerId,
          card.known,
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'MoveCardToWorkArea',
          cardId: card.cardId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
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
        !controlsSeat(location.playerId)
      ) {
        return rejected('unauthorized');
      }
      const resolution = ownEntry(
        state.workAreas,
        location.playerId
      )?.attachmentResolution;
      if (
        !resolution ||
        resolution.id !== wire.expectedWorkAreaId ||
        !ownEntry(state.zones, wire.destinationZoneId)
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
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (targetPlayerId !== actorId && undoContext.mode !== 'solo')
        return rejected('unauthorized');
      const resolution = ownEntry(
        state.workAreas,
        targetPlayerId
      )?.attachmentResolution;
      const destinationPlayerId = wire.destinationBoardPlayerId
        ? asPlayerId(wire.destinationBoardPlayerId)
        : targetPlayerId;
      const board = ownEntry(state.boards, destinationPlayerId);
      if (!resolution || resolution.id !== wire.expectedWorkAreaId || !board) {
        return rejected('stale_reference');
      }
      if (
        !controlsSeat(destinationPlayerId) &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'RestoreStagedStack',
          playerId: targetPlayerId,
          ...(destinationPlayerId === targetPlayerId
            ? {}
            : { destinationBoardPlayerId: destinationPlayerId }),
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
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (targetPlayerId !== actorId && undoContext.mode !== 'solo')
        return rejected('unauthorized');
      const resolution = ownEntry(
        state.workAreas,
        targetPlayerId
      )?.attachmentResolution;
      if (!resolution || resolution.id !== wire.expectedWorkAreaId) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'ResolveStagedCards',
          playerId: targetPlayerId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destination: wire.destination,
        },
      };
    }
    case 'ResolveInspectionCards': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (targetPlayerId !== actorId && undoContext.mode !== 'solo')
        return rejected('unauthorized');
      const inspection = ownEntry(state.workAreas, targetPlayerId)?.inspection;
      if (!inspection || inspection.id !== wire.expectedWorkAreaId) {
        return rejected('stale_reference');
      }
      return {
        accepted: true,
        command: {
          type: 'ResolveInspectionCards',
          playerId: targetPlayerId,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          destination: wire.destination,
        },
      };
    }
    case 'MoveCardToDeckTop':
    case 'MoveCardToDeckBottom':
    case 'ShuffleCardIntoDeck':
    case 'MoveCardToStadium':
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
          const zone = ownEntry(state.zones, location.zoneId);
          if (!zone) return rejected('stale_reference');
          sourceId = zone.id;
          sourcePlayerId = zone.ownerId ?? canonicalCard.ownerId;
          expectedSourceId = asZoneId(wire.expectedSourceId);
          break;
        }
        case 'stackEvolution':
        case 'stackAttachment': {
          const stack = ownEntry(state.stacks, location.stackId);
          if (!stack) return rejected('stale_reference');
          sourceId = stack.id;
          sourcePlayerId = stack.boardPlayerId;
          expectedSourceId = asStackId(wire.expectedSourceId);
          break;
        }
        case 'inspectionWorkArea': {
          const inspection = ownEntry(
            state.workAreas,
            location.playerId
          )?.inspection;
          if (!inspection || !controlsSeat(location.playerId)) {
            return rejected('unauthorized');
          }
          sourceId = inspection.id;
          sourcePlayerId = location.playerId;
          expectedSourceId = asWorkAreaId(wire.expectedSourceId);
          break;
        }
        case 'attachmentResolutionWorkArea': {
          const resolution = ownEntry(
            state.workAreas,
            location.playerId
          )?.attachmentResolution;
          if (!resolution || !controlsSeat(location.playerId)) {
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
          policy,
          undoContext.mode
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
      if (wire.type === 'MoveCardToStadium') {
        const stadium = ownEntry(state.zones, stadiumZoneId());
        if (!stadium || stadium.kind !== 'stadium') {
          return rejected('stale_reference');
        }
        const expectedStadiumCard = wire.expectedStadiumCardId
          ? resolveCard(wire.expectedStadiumCardId)
          : null;
        const expectedCards = wire.expectedStadiumCardIds?.map(
          (id) => resolveCard(id)?.cardId
        );
        if (
          (expectedCards
            ? expectedCards.length !== stadium.cardIds.length ||
              expectedCards.some(
                (id, index) => !id || id !== stadium.cardIds[index]
              )
            : stadium.cardIds.length > 1 || wire.placement === 'add') ||
          (wire.expectedStadiumCardId !== null && !expectedStadiumCard) ||
          (stadium.cardIds[0] ?? null) !== (expectedStadiumCard?.cardId ?? null)
        ) {
          return rejected('stale_reference');
        }
        return {
          accepted: true,
          command: {
            type: 'MoveCardToStadium',
            playerId: sourcePlayerId,
            cardId: card.cardId,
            expectedSourceId,
            expectedStadiumCardId: expectedStadiumCard?.cardId ?? null,
            ...(expectedCards
              ? {
                  expectedStadiumCardIds: expectedCards as NonNullable<
                    typeof expectedStadiumCard
                  >['cardId'][],
                }
              : {}),
            ...(wire.placement ? { placement: wire.placement } : {}),
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
    case 'MovePrizesToDeckBottom': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: { type: 'MovePrizesToDeckBottom', playerId: targetPlayerId },
      };
    }
    case 'ShuffleZone': {
      const zone = ownEntry(state.zones, wire.zoneId);
      if (!zone) return rejected('stale_reference');
      // Solo's player shuffles either seat's deck from a flipped board.
      if (zone.ownerId !== actorId && undoContext.mode !== 'solo')
        return rejected('unauthorized');
      return {
        accepted: true,
        command: { type: 'ShuffleZone', zoneId: asZoneId(wire.zoneId) },
      };
    }
    case 'DrawCards': {
      // v1's flipped solo board (and a coaching flip) act for the seat at
      // the bottom; the same gate as SetupPlayer decides who may do that.
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'DrawCards',
          playerId: targetPlayerId,
          count: wire.count,
        },
      };
    }
    case 'PlayRandomCardFaceDown': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'PlayRandomCardFaceDown',
          actorPlayerId: actorId,
          targetPlayerId,
        },
      };
    }
    case 'StartTurn':
    case 'DeclareAttack':
    case 'PassTurn': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
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
      const source = ownEntry(state.zones, wire.sourceZoneId);
      const destination = ownEntry(state.zones, wire.destinationZoneId);
      if (!source || !destination) return rejected('stale_reference');
      if (
        !source.ownerId ||
        !controlsSeat(source.ownerId) ||
        destination.ownerId !== source.ownerId
      ) {
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
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const board = ownEntry(
        state.zones,
        playerZoneId(targetPlayerId, 'board')
      );
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
      const source = ownEntry(state.zones, wire.sourceZoneId);
      if (!source) return rejected('stale_reference');
      // Into the deck of the pile's owner (either seat, in Solo).
      if (!source.ownerId || !controlsSeat(source.ownerId))
        return rejected('unauthorized');
      if (source.kind === 'board') return rejected('precondition_failed');
      return {
        accepted: true,
        command: {
          type: wire.type,
          playerId: source.ownerId,
          sourceZoneId: asZoneId(wire.sourceZoneId),
        },
      };
    }
    case 'DiscardHandAndDraw':
    case 'ShuffleHandIntoDeckAndDraw':
    case 'ShuffleHandToDeckBottomAndDraw': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: wire.type,
          playerId: targetPlayerId,
          count: wire.count,
        },
      };
    }
    case 'SetDamage':
    case 'SetSpecialCondition':
    case 'SetAbilityUsed':
    case 'RotateStack': {
      const stack = ownEntry(state.stacks, wire.stackId);
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
          policy,
          undoContext.mode
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
          policy,
          undoContext.mode
        )
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: {
          type: 'SetPublicReveal',
          actorPlayerId: actorId,
          playerId: source.playerId,
          cardId: card.cardId,
          expectedSourceId: source.id,
          revealed: wire.revealed,
        },
      };
    }
    case 'SetZonePublicReveal': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      const zone = ownEntry(state.zones, wire.zoneId);
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
          actorPlayerId: actorId,
          playerId: targetPlayerId,
          zoneId: zone.id,
          expectedCardIds: [...zone.cardIds],
          revealed: wire.revealed,
        },
      };
    }
    case 'BeginZoneInspection': {
      const sourcePlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, sourcePlayerId))
        return rejected('stale_reference');
      const zone = ownEntry(state.zones, wire.zoneId);
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
      const grant = ownEntry(state.visibility.inspectionGrants, inspectionId);
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
      if (!ownEntry(state.players, ownerId)) return rejected('stale_reference');
      // A private look at the other seat's deck is Solo's alone: its one
      // player controls both seats, and only that player is shown the cards.
      if (
        ownerId !== actorId &&
        undoContext.mode !== 'solo' &&
        !(wire.visibility === 'public' && policy.allowOpponentPublicInteraction)
      ) {
        return rejected('unauthorized');
      }
      // v1's deck viewer accumulates: viewing more cards while a view is
      // open adds them to it. Extend the owner's open deck inspection rather
      // than letting game-core refuse a second one.
      const openInspection = ownEntry(state.workAreas, ownerId)?.inspection;
      const extend =
        openInspection &&
        openInspection.sourceZoneId === playerZoneId(ownerId, 'deck')
          ? {
              expectedInspection: {
                inspectionId: openInspection.inspectionId,
                workAreaId: openInspection.id,
                cardIds: [...openInspection.cardIds],
                viewerIdsByCardId: Object.fromEntries(
                  openInspection.cardIds.map((cardId) => [
                    cardId,
                    [...(openInspection.viewerIdsByCardId[cardId] ?? [])],
                  ])
                ),
              },
            }
          : {};
      return {
        accepted: true,
        command: {
          type: 'ExtractDeckCardsForInspection',
          playerId: ownerId,
          viewerIds:
            wire.visibility === 'public' ? state.playerOrder : [actorId],
          count: wire.count,
          edge: wire.edge,
          ...extend,
        },
      };
    }
    case 'CloseInspection': {
      const owner = state.playerOrder.find(
        (playerId) =>
          controlsSeat(playerId) &&
          ownEntry(state.workAreas, playerId)?.inspection?.id ===
            wire.expectedWorkAreaId
      );
      if (!owner) return rejected('stale_reference');
      return {
        accepted: true,
        command: {
          type: 'CloseInspection',
          playerId: owner,
          expectedWorkAreaId: asWorkAreaId(wire.expectedWorkAreaId),
          returnTo: wire.returnTo,
        },
      };
    }
    case 'SetCoachingConsent':
      // Solo's one player sits in both seats, which consent to each other
      // from the start; taking it back would only lock a flipped board out
      // of the other seat's private cards.
      if (undoContext.mode === 'solo') return rejected('precondition_failed');
      return {
        accepted: true,
        command: {
          type: 'SetCoachingConsent',
          playerId: actorId,
          consent: wire.consent,
        },
      };
    case 'SetOncePerGameMarker': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
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
    case 'ApplySoloUndo': {
      const targetPlayerId = asPlayerId(wire.targetPlayerId);
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      // Solo's controller announces the undo for whichever seat is at the
      // bottom; a multiplayer player only ever takes back their own move.
      if (undoContext.mode !== 'solo' && targetPlayerId !== actorId) {
        return rejected('unauthorized');
      }
      if (!undoContext.checkpoint) return rejected('precondition_failed');
      return {
        accepted: true,
        command: {
          type: 'ApplySoloUndo',
          actorPlayerId: actorId,
          targetPlayerId,
          revertedCommandId: undoContext.checkpoint.revertedCommandId,
          revertedRevision: undoContext.checkpoint.revertedRevision,
          checkpoint: undoContext.checkpoint.state,
        },
      };
    }
    case 'FlipCoin': {
      const targetPlayerId = wire.targetPlayerId
        ? asPlayerId(wire.targetPlayerId)
        : actorId;
      if (!ownEntry(state.players, targetPlayerId))
        return rejected('stale_reference');
      if (
        targetPlayerId !== actorId &&
        !policy.allowOpponentPublicInteraction
      ) {
        return rejected('unauthorized');
      }
      return {
        accepted: true,
        command: { type: 'FlipCoin', playerId: targetPlayerId },
      };
    }
    case 'ApplyCardSteps':
      // Not built yet: every step is resolved as it would be alone, on the
      // table the steps before it left (ADR-042 §4).
      return rejected('precondition_failed');
  }
  const exhaustive: never = wire;
  void exhaustive;
  return rejected('precondition_failed');
};
