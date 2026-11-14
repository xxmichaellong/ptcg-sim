import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type LifecycleAction = 'setup' | 'reset';
export type LoadDeckEntries = Extract<
  WireGameCommand,
  { readonly type: 'LoadDeck' }
>['entries'];

export type LifecycleActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player';
    };

/** Maps legacy per-side setup/reset buttons to one authority transaction. */
export const resolveLifecycleAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: LifecycleAction
): LifecycleActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  return {
    ok: true,
    command: {
      type: action === 'setup' ? 'SetupPlayer' : 'ResetPlayer',
      targetPlayerId,
    },
  };
};

export const submitLifecycleAction = (
  view: MatchViewState,
  targetPlayerId: string,
  action: LifecycleAction,
  submit: (command: WireGameCommand) => void
): LifecycleActionResolution => {
  const resolution = resolveLifecycleAction(view, targetPlayerId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};

export const resolveLoadDeckAction = (
  view: MatchViewState,
  targetPlayerId: string,
  entries: LoadDeckEntries
): LifecycleActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  return {
    ok: true,
    command: { type: 'LoadDeck', targetPlayerId, entries },
  };
};
