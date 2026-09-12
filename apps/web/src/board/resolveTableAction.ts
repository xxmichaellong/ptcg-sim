import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type TableAction = 'startTurn' | 'attack' | 'pass';

export type TableActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player';
    };

/** Maps the legacy turn, attack, and pass buttons to atomic server intents. */
export const resolveTableAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: TableAction
): TableActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  return {
    ok: true,
    command: {
      type:
        action === 'startTurn'
          ? 'StartTurn'
          : action === 'attack'
            ? 'DeclareAttack'
            : 'PassTurn',
      targetPlayerId,
    },
  };
};

export const submitTableAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: TableAction,
  submit: (command: WireGameCommand) => void
): TableActionResolution => {
  const resolution = resolveTableAction(view, targetPlayerId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
