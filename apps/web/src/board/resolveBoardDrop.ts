import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import type {
  BoardIntent,
  BoardScene,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';

type DropIntent = Extract<BoardIntent, { kind: 'CardDropRequested' }>;
type BoardDropView = MatchViewState;

export type BoardDropResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_scene'
        | 'stale_card'
        | 'stale_target'
        | 'unsupported_source'
        | 'unsupported_target'
        | 'no_op';
    };

const rejected = (
  reason: Exclude<BoardDropResolution, { ok: true }>['reason']
): BoardDropResolution => ({ ok: false, reason });

const playSlotTarget = (
  scene: BoardScene,
  targetId: string
): ZoneSceneNode | undefined =>
  scene.zones.find(
    (zone) =>
      zone.id === targetId &&
      zone.playerId !== null &&
      (zone.kind === 'active' || zone.kind === 'bench')
  );

const containsCard = (
  cards: readonly { readonly id: string }[],
  cardId: string
): boolean => cards.some((card) => card.id === cardId);

/** Converts one renderer-safe drop into an explicit, preconditioned command. */
export const resolveBoardDrop = (
  view: BoardDropView,
  scene: BoardScene,
  intent: DropIntent
): BoardDropResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');
  if (
    scene.matchId !== view.matchId ||
    scene.revision !== view.revision ||
    !scene.cards.some((card) => card.id === intent.cardId)
  ) {
    return rejected('stale_scene');
  }
  const sourceZone = Object.values(view.zones).find((zone) =>
    containsCard(zone.cards, intent.cardId)
  );
  const sourceStack = Object.values(view.stacks).find(
    (stack) =>
      containsCard(stack.evolutionCards, intent.cardId) ||
      containsCard(stack.attachmentCards, intent.cardId)
  );
  const sourceInspection = Object.values(view.workAreas)
    .map((workArea) => workArea.inspection)
    .find(
      (inspection) =>
        inspection !== null && containsCard(inspection.cards, intent.cardId)
    );
  const sourceStagedEntry = Object.entries(view.workAreas).find(
    ([, workArea]) => {
      const resolution = workArea.attachmentResolution;
      return Boolean(
        resolution &&
        (containsCard(resolution.evolutionCards, intent.cardId) ||
          containsCard(resolution.attachmentCards, intent.cardId))
      );
    }
  );
  const sourceStaged = sourceStagedEntry?.[1].attachmentResolution ?? null;
  const sourceStagedPlayerId = sourceStagedEntry?.[0];
  const sourceRepresentsStagedStack =
    sourceStaged?.evolutionCards.at(-1)?.id === intent.cardId;
  const sourceMovesWholeStack =
    sourceStack?.evolutionCards.at(-1)?.id === intent.cardId;
  if (!sourceZone && !sourceStack && !sourceInspection && !sourceStaged) {
    return rejected('stale_card');
  }
  if (sourceStaged && sourceStagedPlayerId !== view.viewer.playerId) {
    return rejected('unsupported_source');
  }

  const destinationZone = view.zones[intent.targetId];
  if (destinationZone) {
    if (!scene.zones.some((zone) => zone.id === destinationZone.id)) {
      return rejected('stale_target');
    }
    if (sourceZone) {
      if (destinationZone.id === sourceZone.id) return rejected('no_op');
      return {
        ok: true,
        command: {
          type: 'MoveCard',
          cardId: intent.cardId,
          expectedSourceZoneId: sourceZone.id,
          destinationZoneId: destinationZone.id,
        },
      };
    }
    if (sourceStack) {
      const evolutionIndex = sourceStack.evolutionCards.findIndex(
        (card) => card.id === intent.cardId
      );
      if (
        evolutionIndex >= 0 &&
        evolutionIndex !== sourceStack.evolutionCards.length - 1
      ) {
        return rejected('unsupported_source');
      }
      return {
        ok: true,
        command: {
          type: 'MoveCardFromStack',
          cardId: intent.cardId,
          expectedStackId: sourceStack.id,
          destinationZoneId: destinationZone.id,
        },
      };
    }
    if (sourceInspection) {
      return {
        ok: true,
        command: {
          type: 'MoveInspectedCard',
          cardId: intent.cardId,
          expectedWorkAreaId: sourceInspection.id,
          destinationZoneId: destinationZone.id,
        },
      };
    }
    if (sourceStaged) {
      return {
        ok: true,
        command: {
          type: 'MoveStagedCard',
          cardId: intent.cardId,
          expectedWorkAreaId: sourceStaged.id,
          destinationZoneId: destinationZone.id,
        },
      };
    }
    return rejected('unsupported_source');
  }

  const targetStack = view.stacks[intent.targetId];
  if (targetStack) {
    if (!scene.cards.some((card) => card.parentId === targetStack.id)) {
      return rejected('stale_target');
    }
    if (sourceStack) {
      if (!sourceMovesWholeStack) return rejected('unsupported_source');
      if (sourceStack.id === targetStack.id) return rejected('no_op');
      if (sourceStack.boardPlayerId !== targetStack.boardPlayerId) {
        return rejected('unsupported_target');
      }
      return {
        ok: true,
        command: {
          type: 'MovePlayStack',
          stackId: sourceStack.id,
          expectedSourceSlot: sourceStack.slot,
          expectedActiveStackId:
            view.boards[sourceStack.boardPlayerId]?.activeStackId ?? null,
          expectedBenchStackIds: [
            ...(view.boards[sourceStack.boardPlayerId]?.benchStackIds ?? []),
          ],
          destinationSlot: targetStack.slot,
          targetStackId: targetStack.id,
        },
      };
    }
    if (!sourceZone) return rejected('unsupported_target');
    return {
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        cardId: intent.cardId,
        expectedSourceZoneId: sourceZone.id,
        boardPlayerId: targetStack.boardPlayerId,
        slot: targetStack.slot,
        targetStackId: targetStack.id,
      },
    };
  }

  const slot = playSlotTarget(scene, intent.targetId);
  if (slot?.playerId) {
    const destinationSlot = slot.kind === 'active' ? 'active' : 'bench';
    if (sourceStaged) {
      if (
        !sourceRepresentsStagedStack ||
        sourceStagedPlayerId !== view.viewer.playerId
      ) {
        return rejected('unsupported_source');
      }
      if (slot.playerId !== sourceStagedPlayerId) {
        return rejected('unsupported_target');
      }
      const board = view.boards[sourceStagedPlayerId];
      if (!board) return rejected('stale_target');
      return {
        ok: true,
        command: {
          type: 'RestoreStagedStack',
          expectedWorkAreaId: sourceStaged.id,
          expectedActiveStackId: board.activeStackId,
          expectedBenchStackIds: [...board.benchStackIds],
          destinationSlot,
        },
      };
    }
    if (sourceStack) {
      if (!sourceMovesWholeStack) return rejected('unsupported_source');
      if (sourceStack.boardPlayerId !== slot.playerId) {
        return rejected('unsupported_target');
      }
      if (sourceStack.slot === 'active' && destinationSlot === 'active') {
        return rejected('no_op');
      }
      return {
        ok: true,
        command: {
          type: 'MovePlayStack',
          stackId: sourceStack.id,
          expectedSourceSlot: sourceStack.slot,
          expectedActiveStackId:
            view.boards[sourceStack.boardPlayerId]?.activeStackId ?? null,
          expectedBenchStackIds: [
            ...(view.boards[sourceStack.boardPlayerId]?.benchStackIds ?? []),
          ],
          destinationSlot,
        },
      };
    }
    if (!sourceZone) return rejected('unsupported_target');
    return {
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        cardId: intent.cardId,
        expectedSourceZoneId: sourceZone.id,
        boardPlayerId: slot.playerId,
        slot: destinationSlot,
      },
    };
  }
  return rejected(
    scene.zones.some((zone) => zone.id === intent.targetId)
      ? 'unsupported_target'
      : 'stale_target'
  );
};

export const submitBoardDrop = (
  view: BoardDropView,
  scene: BoardScene,
  intent: DropIntent,
  submit: (command: WireGameCommand) => void
): BoardDropResolution => {
  const resolution = resolveBoardDrop(view, scene, intent);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
