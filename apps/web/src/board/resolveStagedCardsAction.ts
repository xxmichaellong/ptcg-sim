import type {
  MatchViewState,
  StagedCardsDestination,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type StagedCardsActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | { readonly ok: false; readonly reason: 'not_player' | 'no_work_area' };

/** Resolves one legacy attached-card bulk button into a stale-safe command. */
export const resolveStagedCardsAction = (
  view: MatchViewState,
  destination: StagedCardsDestination
): StagedCardsActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const resolution = view.workAreas[view.viewer.playerId]?.attachmentResolution;
  if (!resolution) return { ok: false, reason: 'no_work_area' };
  return {
    ok: true,
    command: {
      type: 'ResolveStagedCards',
      expectedWorkAreaId: resolution.id,
      destination,
    },
  };
};

export const submitStagedCardsAction = (
  view: MatchViewState,
  destination: StagedCardsDestination,
  submit: (command: WireGameCommand) => void
): StagedCardsActionResolution => {
  const resolution = resolveStagedCardsAction(view, destination);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
