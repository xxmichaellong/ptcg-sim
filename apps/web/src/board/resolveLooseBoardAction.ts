import type {
  LooseBoardCardsDestination,
  MatchViewState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type LooseBoardActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player' | 'empty_board';
    };

/** Maps the four legacy loose-board bulk buttons to one stale-safe command. */
export const resolveLooseBoardAction = (
  view: MatchViewState,
  targetPlayerId: string,
  destination: LooseBoardCardsDestination
): LooseBoardActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  const board = Object.values(view.zones).find(
    (zone) => zone.ownerId === targetPlayerId && zone.kind === 'board'
  );
  if (!board) return { ok: false, reason: 'stale_player' };
  if (board.cards.length === 0) {
    return { ok: false, reason: 'empty_board' };
  }
  return {
    ok: true,
    command: {
      type: 'ResolveLooseBoardCards',
      targetPlayerId,
      expectedBoardCardIds: board.cards.map((card) => card.id),
      destination,
    },
  };
};

export const submitLooseBoardAction = (
  view: MatchViewState,
  targetPlayerId: string,
  destination: LooseBoardCardsDestination,
  submit: (command: WireGameCommand) => void
): LooseBoardActionResolution => {
  const resolution = resolveLooseBoardAction(view, targetPlayerId, destination);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
