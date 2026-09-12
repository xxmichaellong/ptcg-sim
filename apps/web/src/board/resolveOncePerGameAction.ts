import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type OncePerGameAction =
  | {
      readonly type: 'set';
      readonly marker: 'gx' | 'vstar';
      readonly used: boolean;
    }
  | { readonly type: 'toggle'; readonly marker: 'gx' | 'vstar' };

export type OncePerGameActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player' | 'no_op';
    };

/** Maps the legacy GX/VSTAR buttons to explicit, independently targeted state. */
export const resolveOncePerGameAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: OncePerGameAction
): OncePerGameActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const target = view.players[targetPlayerId];
  if (!target) return { ok: false, reason: 'stale_player' };
  const current =
    action.marker === 'gx'
      ? target.oncePerGame.gxUsed
      : target.oncePerGame.vstarUsed;
  const used = action.type === 'toggle' ? !current : action.used;
  if (used === current) return { ok: false, reason: 'no_op' };
  return {
    ok: true,
    command: {
      type: 'SetOncePerGameMarker',
      targetPlayerId,
      marker: action.marker,
      used,
    },
  };
};

export const submitOncePerGameAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: OncePerGameAction,
  submit: (command: WireGameCommand) => void
): OncePerGameActionResolution => {
  const resolution = resolveOncePerGameAction(view, targetPlayerId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
