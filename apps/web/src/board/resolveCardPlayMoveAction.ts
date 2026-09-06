import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export const CARD_PLAY_MOVE_DESTINATIONS = ['active', 'bench'] as const;

export type CardPlayMoveDestination =
  (typeof CARD_PLAY_MOVE_DESTINATIONS)[number];

export const isCardPlayMoveDestination = (
  value: unknown
): value is CardPlayMoveDestination =>
  typeof value === 'string' &&
  (CARD_PLAY_MOVE_DESTINATIONS as readonly string[]).includes(value);

export type CardPlayMoveResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'unsupported_source'
        | 'unsupported_target'
        | 'no_op';
    };

const containsCard = (
  cards: readonly { readonly id: string }[],
  cardId: string
): boolean => cards.some((card) => card.id === cardId);

const rejected = (
  reason: Exclude<CardPlayMoveResolution, { ok: true }>['reason']
): CardPlayMoveResolution => ({ ok: false, reason });

/** Resolves one selected card or whole play stack onto its current board side. */
export const resolveCardPlayMoveAction = (
  view: MatchViewState,
  cardId: ViewCardId,
  destinationSlot: CardPlayMoveDestination
): CardPlayMoveResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');

  const sourceZone = Object.values(view.zones).find((zone) =>
    containsCard(zone.cards, cardId)
  );
  const sourceStack = Object.values(view.stacks).find(
    (stack) =>
      containsCard(stack.evolutionCards, cardId) ||
      containsCard(stack.attachmentCards, cardId)
  );
  const sourceInspection = Object.values(view.workAreas)
    .map((workArea) => workArea.inspection)
    .find(
      (inspection) =>
        inspection !== null && containsCard(inspection.cards, cardId)
    );
  const stagedEntry = Object.entries(view.workAreas).find(([, workArea]) => {
    const staged = workArea.attachmentResolution;
    return Boolean(
      staged &&
      (containsCard(staged.evolutionCards, cardId) ||
        containsCard(staged.attachmentCards, cardId))
    );
  });
  const sourceStaged = stagedEntry?.[1].attachmentResolution ?? null;
  const sourceStagedPlayerId = stagedEntry?.[0];
  if (!sourceZone && !sourceStack && !sourceInspection && !sourceStaged) {
    return rejected('stale_card');
  }

  if (sourceInspection) return rejected('unsupported_source');
  if (sourceStaged) {
    if (
      sourceStagedPlayerId !== view.viewer.playerId ||
      sourceStaged.evolutionCards.at(-1)?.id !== cardId
    ) {
      return rejected('unsupported_source');
    }
    const board = view.boards[sourceStagedPlayerId];
    if (!board) return rejected('unsupported_target');
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
    if (sourceStack.evolutionCards.at(-1)?.id !== cardId) {
      return rejected('unsupported_source');
    }
    const board = view.boards[sourceStack.boardPlayerId];
    if (!board) return rejected('unsupported_target');
    if (sourceStack.slot === 'active' && destinationSlot === 'active') {
      return rejected('no_op');
    }
    return {
      ok: true,
      command: {
        type: 'MovePlayStack',
        stackId: sourceStack.id,
        expectedSourceSlot: sourceStack.slot,
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot,
      },
    };
  }

  if (!sourceZone) return rejected('unsupported_source');
  const sourceCard = sourceZone.cards.find((card) => card.id === cardId)!;
  const boardPlayerId = sourceZone.ownerId ?? sourceCard.ownerId;
  if (!view.boards[boardPlayerId]) return rejected('unsupported_target');
  return {
    ok: true,
    command: {
      type: 'MoveCardToPlay',
      cardId,
      expectedSourceZoneId: sourceZone.id,
      boardPlayerId,
      slot: destinationSlot,
    },
  };
};
