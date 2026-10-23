import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type SoloUndoActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | { readonly ok: false; readonly reason: 'not_player' | 'stale_player' };

/**
 * Maps the existing solo undo control to a selector-free authority intent.
 * Availability is deliberately decided by the authority because checkpoint
 * contents and depth are not part of the public match view.
 */
export const resolveSoloUndoAction = (
  view: MatchViewState,
  targetPlayerId: string
): SoloUndoActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  return {
    ok: true,
    command: { type: 'ApplySoloUndo', targetPlayerId },
  };
};

export const submitSoloUndoAction = (
  view: MatchViewState,
  targetPlayerId: string,
  submit: (command: WireGameCommand) => void
): SoloUndoActionResolution => {
  const resolution = resolveSoloUndoAction(view, targetPlayerId);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
