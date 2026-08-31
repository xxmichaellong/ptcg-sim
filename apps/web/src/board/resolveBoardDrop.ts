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

/**
 * Converts one renderer-safe drop into a protocol command. It deliberately
 * refuses stack/work-area sources until the core has explicit commands for
 * those transitions instead of guessing from visual parentage.
 */
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
  if (!sourceZone) {
    const existsOutsideZone =
      Object.values(view.stacks).some(
        (stack) =>
          containsCard(stack.evolutionCards, intent.cardId) ||
          containsCard(stack.attachmentCards, intent.cardId)
      ) ||
      Object.values(view.workAreas).some(
        (workArea) =>
          containsCard(workArea.inspection?.cards ?? [], intent.cardId) ||
          containsCard(
            workArea.attachmentResolution?.cards ?? [],
            intent.cardId
          )
      );
    return rejected(existsOutsideZone ? 'unsupported_source' : 'stale_card');
  }

  const destinationZone = view.zones[intent.targetId];
  if (destinationZone) {
    if (destinationZone.id === sourceZone.id) return rejected('no_op');
    if (!scene.zones.some((zone) => zone.id === destinationZone.id)) {
      return rejected('stale_target');
    }
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

  const targetStack = view.stacks[intent.targetId];
  if (targetStack) {
    if (!scene.cards.some((card) => card.parentId === targetStack.id)) {
      return rejected('stale_target');
    }
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
    return {
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        cardId: intent.cardId,
        expectedSourceZoneId: sourceZone.id,
        boardPlayerId: slot.playerId,
        slot: slot.kind === 'active' ? 'active' : 'bench',
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
