import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import { attachesAsEnergy } from './plays-as.js';
import { resolveAttachEvolveTargeting } from './resolveAttachEvolveTargeting.js';
import { resolveCardStadiumMoveAction } from './resolveCardStadiumMoveAction.js';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { arrangementIndexAt } from '@ptcgsim/renderer-contract';
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
 * dropped on a Pokémon joins it, as the Q/E keys place it: v1's drop does
 * the same. Sharing the keys' rules keeps the two from drifting on whether
 * a card attaches or evolves; a drop may evolve a Pokémon on either board.
 */
const placeOnPokemon = (
  view: BoardDropView,
  cardId: ViewCardId,
  targetStackId: string
): BoardDropResolution => {
  // A Holon's Pokémon put on a Pokémon is attached as an Energy.
  const asEnergy = attachesAsEnergy(view, cardId);
  const targeting = resolveAttachEvolveTargeting(view, cardId, {
    evolveOnEitherBoard: true,
    ...(asEnergy ? { asCategory: 'Energy' as const } : {}),
  });
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
      ...(asEnergy ? { asCategory: 'Energy' as const } : {}),
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
 * Zones whose order the player sets freely (arrangement.ts): a hand, the
 * loose board and the Prizes' grid. Piles keep their order; a deck's is
 * hidden.
 */
const ARRANGED_ZONE_KINDS = new Set(['hand', 'board', 'prizes']);

/**
 * The place asked for, where the destination keeps an order a player sets.
 * A card put on a deck goes on top, the next draw, as v1's drop on the deck
 * and the ↑ key put it.
 */
const placeIn = (
  kind: string,
  index: number | undefined
): { readonly destinationIndex?: number } =>
  kind === 'deck'
    ? { destinationIndex: 0 }
    : index !== undefined && ARRANGED_ZONE_KINDS.has(kind)
      ? { destinationIndex: index }
      : {};

type ViewStack = BoardDropView['stacks'][string];

/**
 * A whole Pokémon moved onto the other player's board (game-core's
 * layOutPlayStackAcrossBoards), with both boards as last seen.
 */
const moveStackAcross = (
  view: BoardDropView,
  stack: ViewStack,
  destinationPlayerId: string,
  destinationSlot: 'active' | 'bench',
  place: { readonly targetStackId?: string; readonly benchIndex?: number }
): BoardDropResolution => {
  const source = view.boards[stack.boardPlayerId];
  const destination = view.boards[destinationPlayerId];
  if (!source || !destination) return rejected('stale_target');
  return {
    ok: true,
    command: {
      type: 'MovePlayStack',
      stackId: stack.id,
      expectedSourceBoardPlayerId: stack.boardPlayerId,
      expectedSourceSlot: stack.slot,
      expectedActiveStackId: source.activeStackId,
      expectedBenchStackIds: [...source.benchStackIds],
      destinationSlot,
      ...(place.targetStackId ? { targetStackId: place.targetStackId } : {}),
      ...(place.benchIndex === undefined
        ? {}
        : { benchIndex: place.benchIndex }),
      destinationBoard: {
        boardPlayerId: destinationPlayerId,
        expectedActiveStackId: destination.activeStackId,
        expectedBenchStackIds: [...destination.benchStackIds],
      },
    },
  };
};

/**
 * Where on its Bench a Pokémon dropped over a Benched one of the other
 * player's goes: the side of it the pointer is on, as over their Bench.
 */
const benchPlaceOver = (
  view: BoardDropView,
  scene: BoardScene,
  intent: DropIntent,
  target: ViewStack
): number | undefined => {
  const bench = scene.zones.find(
    (zone) => zone.kind === 'bench' && zone.playerId === target.boardPlayerId
  );
  const pointed = bench
    ? arrangementIndexAt(scene, intent.cardId, bench.id, intent.x, intent.y)
    : null;
  if (pointed !== null) return pointed;
  const at = view.boards[target.boardPlayerId]?.benchStackIds.indexOf(
    target.id
  );
  return at === undefined || at < 0 ? undefined : at;
};

/** Converts one renderer-safe drop into an explicit, preconditioned command. */
export interface BoardDropOptions {
  /**
   * Cards may leave and join either seat's open window (a look at a deck,
   * attached cards being moved), and either seat's cards may, not only the
   * viewer's: Solo, whose one player controls both seats.
   */
  readonly eitherSeatsWindows?: boolean;
}

export const resolveBoardDrop = (
  view: BoardDropView,
  scene: BoardScene,
  intent: DropIntent,
  options: BoardDropOptions = {}
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
  if (intent.pilePosition !== undefined) {
    if (intent.pilePosition !== 'top' && intent.pilePosition !== 'bottom') {
      return rejected('unsupported_target');
    }
    if (
      !sourceZone ||
      (sourceZone.kind !== 'discard' && sourceZone.kind !== 'lostZone')
    ) {
      return rejected('unsupported_source');
    }
    if (intent.targetId !== sourceZone.id)
      return rejected('unsupported_target');
    if (
      !scene.zones.some((zone) => zone.id === sourceZone.id && zone.interactive)
    ) {
      return rejected('stale_target');
    }
    return {
      ok: true,
      command: {
        type: 'MoveCard',
        cardId: intent.cardId,
        expectedSourceZoneId: sourceZone.id,
        destinationZoneId: sourceZone.id,
        // Top follows the pile's live end, including a peer's later discard.
        ...(intent.pilePosition === 'bottom' ? { destinationIndex: 0 } : {}),
      },
    };
  }
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
  const viewerPlayerId = view.viewer.playerId;
  const worksWindowOf = (playerId: string | undefined): boolean =>
    playerId === viewerPlayerId || options.eitherSeatsWindows === true;
  if (sourceStaged && !worksWindowOf(sourceStagedPlayerId)) {
    return rejected('unsupported_source');
  }
  if (sourceInspection && !worksWindowOf(sourceInspectionPlayerId)) {
    return rejected('unsupported_source');
  }

  const destinationZone = view.zones[intent.targetId];
  if (destinationZone) {
    if (!scene.zones.some((zone) => zone.id === destinationZone.id)) {
      return rejected('stale_target');
    }
    if (destinationZone.kind === 'stadium')
      return resolveCardStadiumMoveAction(
        view,
        intent.cardId,
        undefined,
        options.eitherSeatsWindows
          ? (sourceInspectionPlayerId ?? sourceStagedPlayerId)
          : undefined
      );
    const place = placeIn(destinationZone.kind, intent.index);
    if (sourceZone) {
      if (destinationZone.id === sourceZone.id) {
        // Rearranged within its zone: a new place in an order the player
        // sets, or nothing to do (a deck's own card goes up by its keys).
        const at = sourceZone.cards.findIndex(
          (card) => card.id === intent.cardId
        );
        if (
          !ARRANGED_ZONE_KINDS.has(destinationZone.kind) ||
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
        // Onto the other player's Pokémon: the Active trades places with
        // it; a Benched one makes room, as their Bench does for a drop.
        const destination = targetStack.boardPlayerId;
        if (targetStack.slot === 'active')
          return moveStackAcross(view, sourceStack, destination, 'active', {
            targetStackId: targetStack.id,
          });
        const benchIndex = benchPlaceOver(view, scene, intent, targetStack);
        return moveStackAcross(
          view,
          sourceStack,
          destination,
          'bench',
          benchIndex === undefined ? {} : { benchIndex }
        );
      }
      return {
        ok: true,
        command: {
          type: 'MovePlayStack',
          stackId: sourceStack.id,
          expectedSourceBoardPlayerId: sourceStack.boardPlayerId,
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
        // A Holon's Pokémon put on a Pokémon is attached as an Energy.
        ...(attachesAsEnergy(view, intent.cardId)
          ? { asCategory: 'Energy' as const }
          : {}),
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
    if (!worksWindowOf(workAreaTarget.playerId ?? undefined)) {
      return rejected('unsupported_target');
    }
    if (
      sourceInspection?.id === workAreaTarget.id ||
      sourceStaged?.id === workAreaTarget.id
    ) {
      return rejected('no_op');
    }
    const card = scene.cards.find((entry) => entry.id === intent.cardId);
    if (card && !worksWindowOf(card.ownerId)) {
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
        !sourceStagedPlayerId ||
        !worksWindowOf(sourceStagedPlayerId)
      ) {
        return rejected('unsupported_source');
      }
      // Back together on either board: the one it is put on.
      const board = view.boards[slot.playerId];
      if (!board) return rejected('stale_target');
      return {
        ok: true,
        command: {
          type: 'RestoreStagedStack',
          ...(sourceStagedPlayerId === view.viewer.playerId
            ? {}
            : { targetPlayerId: sourceStagedPlayerId }),
          expectedWorkAreaId: sourceStaged.id,
          expectedActiveStackId: board.activeStackId,
          expectedBenchStackIds: [...board.benchStackIds],
          destinationSlot,
          ...benchPlace,
          ...(slot.playerId === sourceStagedPlayerId
            ? {}
            : { destinationBoardPlayerId: slot.playerId }),
        },
      };
    }
    if (sourceStack) {
      if (!sourceMovesWholeStack) return rejected('unsupported_source');
      if (sourceStack.boardPlayerId !== slot.playerId) {
        return moveStackAcross(
          view,
          sourceStack,
          slot.playerId,
          destinationSlot,
          benchPlace
        );
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
          expectedSourceBoardPlayerId: sourceStack.boardPlayerId,
          expectedSourceSlot: sourceStack.slot,
          expectedActiveStackId:
            view.boards[sourceStack.boardPlayerId]?.activeStackId ?? null,
          expectedBenchStackIds: [...bench],
          destinationSlot,
          ...benchPlace,
        },
      };
    }
    // v1's card viewer: a card being looked at goes straight into play.
    if (sourceInspection) {
      if (!worksWindowOf(sourceInspectionPlayerId)) {
        return rejected('unsupported_source');
      }
      return {
        ok: true,
        command: {
          type: 'MoveInspectedCardToPlay',
          cardId: intent.cardId,
          expectedWorkAreaId: sourceInspection.id,
          boardPlayerId: slot.playerId,
          slot: destinationSlot,
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
