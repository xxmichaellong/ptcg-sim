import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type RandomFaceDownActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player' | 'empty_hand';
    };

/** Maps the legacy random-hand button without exposing a card selector. */
export const resolveRandomFaceDownAction = (
  view: MatchViewState,
  targetPlayerId: string
): RandomFaceDownActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  const hand = Object.values(view.zones).find(
    (zone) => zone.ownerId === targetPlayerId && zone.kind === 'hand'
  );
  if (!hand) return { ok: false, reason: 'stale_player' };
  if (hand.cards.length === 0) return { ok: false, reason: 'empty_hand' };
  return {
    ok: true,
    command: { type: 'PlayRandomCardFaceDown', targetPlayerId },
  };
};

export const submitRandomFaceDownAction = (
  view: MatchViewState,
  targetPlayerId: string,
  submit: (command: WireGameCommand) => void
): RandomFaceDownActionResolution => {
  const resolution = resolveRandomFaceDownAction(view, targetPlayerId);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
