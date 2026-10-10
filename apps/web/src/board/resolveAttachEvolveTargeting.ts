import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

export type AttachEvolvePlacementMode = 'attachment' | 'evolution';

export interface BoardPlayTargetingState {
  readonly kind: 'attachOrEvolve';
  readonly sourceCardId: ViewCardId;
  readonly expectedSourceId: string;
  readonly mode: AttachEvolvePlacementMode;
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
  cardId: ViewCardId
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
    mode = source.card.category === 'Pokémon' ? 'evolution' : 'attachment';
  }

  const board = view.boards[source.sourcePlayerId];
  if (!board) return rejectedTargeting('unsupported_target');
  const stackIds = [
    ...(board.activeStackId ? [board.activeStackId] : []),
    ...board.benchStackIds,
  ];
  const targets = stackIds.flatMap((stackId) => {
    const stack = view.stacks[stackId];
    const topCardId = stack?.evolutionCards.at(-1)?.id;
    return stack && stack.boardPlayerId === source.sourcePlayerId && topCardId
      ? [{ stackId, topCardId }]
      : [];
  });
  if (targets.length === 0) return rejectedTargeting('unsupported_target');

  return {
    ok: true,
    targeting: {
      kind: 'attachOrEvolve',
      sourceCardId: cardId,
      expectedSourceId: source.sourceId,
      mode,
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
  const current = resolveAttachEvolveTargeting(view, targeting.sourceCardId);
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
    },
  };
};
