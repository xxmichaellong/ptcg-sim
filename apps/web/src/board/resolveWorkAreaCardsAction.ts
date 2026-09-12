import type {
  MatchViewState,
  WorkAreaCardsDestination,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type WorkAreaCardsActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | { readonly ok: false; readonly reason: 'not_player' | 'no_work_area' };

export const resolveWorkAreaCardsAction = (
  view: MatchViewState,
  source: 'inspection' | 'staged',
  destination: WorkAreaCardsDestination
): WorkAreaCardsActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const areas = view.workAreas[view.viewer.playerId];
  const workArea =
    source === 'inspection' ? areas?.inspection : areas?.attachmentResolution;
  if (!workArea) return { ok: false, reason: 'no_work_area' };
  return {
    ok: true,
    command: {
      type:
        source === 'inspection'
          ? 'ResolveInspectionCards'
          : 'ResolveStagedCards',
      expectedWorkAreaId: workArea.id,
      destination,
    },
  };
};

export const submitWorkAreaCardsAction = (
  view: MatchViewState,
  source: 'inspection' | 'staged',
  destination: WorkAreaCardsDestination,
  submit: (command: WireGameCommand) => void
): WorkAreaCardsActionResolution => {
  const resolution = resolveWorkAreaCardsAction(view, source, destination);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
