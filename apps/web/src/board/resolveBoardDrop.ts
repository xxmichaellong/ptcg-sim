import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import { resolveAttachEvolveTargeting } from './resolveAttachEvolveTargeting.js';
import { resolveCardStadiumMoveAction } from './resolveCardStadiumMoveAction.js';
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

/**
 * A card that is not a whole Pokémon (an attached Energy or Tool, a card
 * under the top, or one in a Looking-at-cards or attached-card window)
 * dropped on a Pokémon joins it, exactly as the Q/E keys place it: v1's
 * drop does the same. Sharing the keys' rules keeps the two from drifting
 * on who may target which board and whether a card attaches or evolves.
 */
const placeOnPokemon = (
  view: BoardDropView,
  cardId: ViewCardId,
  targetStackId: string
): BoardDropResolution => {
  const targeting = resolveAttachEvolveTargeting(view, cardId);
  if (!targeting.ok) {
    return rejected(
      targeting.reason === 'stale_source' ? 'stale_card' : targeting.reason
    );
  }
  if (targeting.targeting.expectedSourceId === targetStackId) {
    return rejected('no_op');
  }
  const target = targeting.targeting.targets.find(
    (candidate) => candidate.stackId === targetStackId
  );
  if (!target) return rejected('unsupported_target');
  return {
    ok: true,
    command: {
      type: 'PlaceCardOnPlayStack',
      cardId,
      expectedSourceId: targeting.targeting.expectedSourceId,
      targetStackId: target.stackId,
      expectedTargetTopCardId: target.topCardId,
      mode: targeting.targeting.mode,
    },
  };
};

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
 * Zones whose order the player sets freely (arrangement.ts): a hand and the
 * loose board. Piles keep their order; a deck's is hidden.
 */
const ARRANGED_ZONE_KINDS = new Set(['hand', 'board']);

/** The place asked for, where the destination keeps an order a player sets. */
const placeIn = (
  kind: string,
  index: number | undefined
): { readonly destinationIndex?: number } =>
  index !== undefined && ARRANGED_ZONE_KINDS.has(kind)
    ? { destinationIndex: index }
    : {};

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
  const sourceInspectionEntry = Object.entries(view.workAreas).find(
    ([, workArea]) =>
      workArea.inspection !== null &&
      containsCard(workArea.inspection.cards, intent.cardId)
  );
  const sourceInspection = sourceInspectionEntry?.[1].inspection ?? null;
  const sourceInspectionPlayerId = sourceInspectionEntry?.[0];
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
  // A Pokémon moves whole: grabbing any card of the Pokémon itself takes
  // everything under and attached to it, into play or into a pile. A card
  // lifted off by a long press (`detached`) moves alone, as an attached
  // Energy or Tool always does.
  const sourceMovesWholeStack =
    intent.detached !== true &&
    Boolean(
      sourceStack?.evolutionCards.some((card) => card.id === intent.cardId)
    );
  if (!sourceZone && !sourceStack && !sourceInspection && !sourceStaged) {
    return rejected('stale_card');
  }
  if (sourceStaged && sourceStagedPlayerId !== view.viewer.playerId) {
    return rejected('unsupported_source');
  }
  if (sourceInspection && sourceInspectionPlayerId !== view.viewer.playerId) {
    return rejected('unsupported_source');
  }

  const destinationZone = view.zones[intent.targetId];
  if (destinationZone) {
    if (!scene.zones.some((zone) => zone.id === destinationZone.id)) {
      return rejected('stale_target');
    }
    if (destinationZone.kind === 'stadium')
      return resolveCardStadiumMoveAction(view, intent.cardId);
    const place = placeIn(destinationZone.kind, intent.index);
    if (sourceZone) {
      if (destinationZone.id === sourceZone.id) {
        // Rearranged within its zone: a new place in an order the player
        // sets, or nothing to do.
        const at = sourceZone.cards.findIndex(
          (card) => card.id === intent.cardId
        );
        if (
          place.destinationIndex === undefined ||
          place.destinationIndex === at
        ) {
          return rejected('no_op');
        }
      }
      return {
        ok: true,
        command: {
          type: 'MoveCard',
          cardId: intent.cardId,
          expectedSourceZoneId: sourceZone.id,
          destinationZoneId: destinationZone.id,
          ...place,
        },
      };
    }
    if (sourceStack && sourceMovesWholeStack) {
      return {
        ok: true,
        command: {
          type: 'MovePlayStackToZone',
          stackId: sourceStack.id,
          expectedEvolutionCardIds: sourceStack.evolutionCards.map(
            (card) => card.id
          ),
          expectedAttachmentCardIds: sourceStack.attachmentCards.map(
            (card) => card.id
          ),
          destinationZoneId: destinationZone.id,
          ...place,
        },
      };
    }
    if (sourceStack) {
      return {
        ok: true,
        command: {
          type: 'MoveCardFromStack',
          cardId: intent.cardId,
          expectedStackId: sourceStack.id,
          destinationZoneId: destinationZone.id,
          ...place,
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
          ...place,
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
          ...place,
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
      if (!sourceMovesWholeStack) {
        return placeOnPokemon(view, intent.cardId, targetStack.id);
      }
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
    if (sourceInspection || sourceStaged) {
      return placeOnPokemon(view, intent.cardId, targetStack.id);
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

  // v1's work-area popups are drop targets as well as sources: a card dragged
  // onto the open deck viewer or attached-card window joins that set.
  const workAreaTarget = scene.zones.find(
    (zone) =>
      zone.id === intent.targetId &&
      (zone.kind === 'inspection' || zone.kind === 'attachmentResolution')
  );
  if (workAreaTarget) {
    if (workAreaTarget.playerId !== view.viewer.playerId) {
      return rejected('unsupported_target');
    }
    if (
      sourceInspection?.id === workAreaTarget.id ||
      sourceStaged?.id === workAreaTarget.id
    ) {
      return rejected('no_op');
    }
    const card = scene.cards.find((entry) => entry.id === intent.cardId);
    if (card && card.ownerId !== view.viewer.playerId) {
      return rejected('unsupported_source');
    }
    return {
      ok: true,
      command: {
        type: 'MoveCardToWorkArea',
        cardId: intent.cardId,
        expectedWorkAreaId: workAreaTarget.id,
      },
    };
  }

  const slot = playSlotTarget(scene, intent.targetId);
  if (slot?.playerId) {
    const destinationSlot = slot.kind === 'active' ? 'active' : 'bench';
    // A place on the bench, counted among the Pokémon that stay there.
    const benchPlace =
      destinationSlot === 'bench' && intent.index !== undefined
        ? { benchIndex: intent.index }
        : {};
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
          ...benchPlace,
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
      const bench = view.boards[sourceStack.boardPlayerId]?.benchStackIds ?? [];
      if (
        sourceStack.slot === 'bench' &&
        destinationSlot === 'bench' &&
        intent.index !== undefined &&
        bench.indexOf(sourceStack.id) === intent.index
      ) {
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
          expectedBenchStackIds: [...bench],
          destinationSlot,
          ...benchPlace,
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
        ...benchPlace,
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
