import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

export type AttachEvolvePlacementMode = 'attachment' | 'evolution';

export interface BoardPlayTargetingState {
  readonly kind: 'attachOrEvolve';
  readonly sourceCardId: ViewCardId;
  readonly expectedSourceId: string;
  readonly mode: AttachEvolvePlacementMode;
  /** Attached as an Energy whatever its kind (a Holon's Pokémon). */
  readonly asCategory?: 'Energy';
  readonly targets: readonly {
    readonly stackId: string;
    readonly topCardId: ViewCardId;
  }[];
}

export type AttachEvolveTargetingRejectionReason =
  | 'not_player'
  | 'stale_card'
  | 'stale_source'
  | 'stale_target'
  | 'unsupported_source'
  | 'unsupported_target';

export type AttachEvolveTargetingResolution =
  | { readonly ok: true; readonly targeting: BoardPlayTargetingState }
  | {
      readonly ok: false;
      readonly reason: AttachEvolveTargetingRejectionReason;
    };

export type AttachEvolvePlacementResolution =
  | {
      readonly ok: true;
      readonly command: Extract<
        WireGameCommand,
        { readonly type: 'PlaceCardOnPlayStack' }
      >;
    }
  | {
      readonly ok: false;
      readonly reason: AttachEvolveTargetingRejectionReason;
    };

const rejectedTargeting = (
  reason: AttachEvolveTargetingRejectionReason
): AttachEvolveTargetingResolution => ({ ok: false, reason });

const rejectedPlacement = (
  reason: AttachEvolveTargetingRejectionReason
): AttachEvolvePlacementResolution => ({ ok: false, reason });

/**
 * Resolves Q/E's local first stage from one recipient-safe projection.
 * Target order deliberately follows the V1 active-then-bench paint order.
 */
export const resolveAttachEvolveTargeting = (
  view: MatchViewState,
  cardId: ViewCardId,
  options: {
    /**
     * A Pokémon may evolve one on either board, as a drop puts it anywhere.
     * Q/E's targets keep to its own board, where it evolves every time.
     */
    readonly evolveOnEitherBoard?: boolean;
    /** Attached as an Energy whatever its kind (a Holon's Pokémon). */
    readonly asCategory?: 'Energy';
  } = {}
): AttachEvolveTargetingResolution => {
  if (view.viewer.kind !== 'player') return rejectedTargeting('not_player');
  const source = locateViewCardActionSource(view, cardId);
  if (!source) return rejectedTargeting('stale_card');

  let mode: AttachEvolvePlacementMode;
  if (source.sourceKind === 'stack') {
    const sourceStack = view.stacks[source.sourceId];
    if (!sourceStack) return rejectedTargeting('stale_source');
    const isAttachment = sourceStack.attachmentCards.some(
      (card) => card.id === cardId
    );
    if (!isAttachment && !source.isLowerEvolution) {
      return rejectedTargeting('unsupported_source');
    }
    mode = 'attachment';
  } else {
    if (source.card.kind !== 'known') {
      return rejectedTargeting('unsupported_source');
    }
    mode =
      options.asCategory || source.card.category !== 'Pokémon'
        ? 'attachment'
        : 'evolution';
  }

  const boardIds =
    mode === 'attachment' || options.evolveOnEitherBoard === true
      ? view.playerOrder
      : [source.sourcePlayerId];
  const targets = boardIds.flatMap((playerId) => {
    const board = view.boards[playerId];
    if (!board) return [];
    return [
      ...(board.activeStackId ? [board.activeStackId] : []),
      ...board.benchStackIds,
    ].flatMap((stackId) => {
      const stack = view.stacks[stackId];
      const topCardId = stack?.evolutionCards.at(-1)?.id;
      return stack && stack.boardPlayerId === playerId && topCardId
        ? [{ stackId, topCardId }]
        : [];
    });
  });
  if (targets.length === 0) return rejectedTargeting('unsupported_target');

  return {
    ok: true,
    targeting: {
      kind: 'attachOrEvolve',
      sourceCardId: cardId,
      expectedSourceId: source.sourceId,
      mode,
      ...(options.asCategory ? { asCategory: options.asCategory } : {}),
      targets,
    },
  };
};

/** Resolves a target click and revalidates every revision-bound descriptor. */
export const resolveAttachEvolveTarget = (
  view: MatchViewState,
  targeting: BoardPlayTargetingState,
  targetCardId: ViewCardId
): AttachEvolvePlacementResolution => {
  const current = resolveAttachEvolveTargeting(
    view,
    targeting.sourceCardId,
    targeting.asCategory ? { asCategory: targeting.asCategory } : {}
  );
  if (!current.ok) return rejectedPlacement(current.reason);
  if (current.targeting.expectedSourceId !== targeting.expectedSourceId) {
    return rejectedPlacement('stale_source');
  }
  if (current.targeting.mode !== targeting.mode) {
    return rejectedPlacement('stale_source');
  }
  const expectedTarget = targeting.targets.find(
    (target) => target.topCardId === targetCardId
  );
  if (!expectedTarget) return rejectedPlacement('unsupported_target');
  const currentTarget = current.targeting.targets.find(
    (target) => target.stackId === expectedTarget.stackId
  );
  if (!currentTarget || currentTarget.topCardId !== targetCardId) {
    return rejectedPlacement('stale_target');
  }

  return {
    ok: true,
    command: {
      type: 'PlaceCardOnPlayStack',
      cardId: targeting.sourceCardId,
      expectedSourceId: targeting.expectedSourceId,
      targetStackId: expectedTarget.stackId,
      expectedTargetTopCardId: targetCardId,
      mode: targeting.mode,
      ...(targeting.asCategory ? { asCategory: targeting.asCategory } : {}),
    },
  };
};
