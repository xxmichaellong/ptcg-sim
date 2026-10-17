import type {
  MatchViewState,
  WorkAreaCardsDestination,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  resolveWorkAreaCardsAction,
  submitWorkAreaCardsAction,
  type WorkAreaCardsActionResolution,
} from './resolveWorkAreaCardsAction.js';

export type InspectionCardsActionResolution = WorkAreaCardsActionResolution;

export type CloseInspectionActionResolution = WorkAreaCardsActionResolution;

/** Resolves one legacy view-card bulk button into a stale-safe command. */
export const resolveInspectionCardsAction = (
  view: MatchViewState,
  destination: WorkAreaCardsDestination
): InspectionCardsActionResolution =>
  resolveWorkAreaCardsAction(view, 'inspection', destination);

export const submitInspectionCardsAction = (
  view: MatchViewState,
  destination: WorkAreaCardsDestination,
  submit: (command: WireGameCommand) => void
): InspectionCardsActionResolution =>
  submitWorkAreaCardsAction(view, 'inspection', destination, submit);

/** Resolves closing the projected inspection without exposing its canonical token. */
export const resolveCloseInspectionAction = (
  view: MatchViewState,
  returnTo: 'top' | 'bottom'
): CloseInspectionActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const inspection = view.workAreas[view.viewer.playerId]?.inspection;
  if (!inspection) return { ok: false, reason: 'no_work_area' };
  return {
    ok: true,
    command: {
      type: 'CloseInspection',
      expectedWorkAreaId: inspection.id,
      returnTo,
    },
  };
};

export const submitCloseInspectionAction = (
  view: MatchViewState,
  returnTo: 'top' | 'bottom',
  submit: (command: WireGameCommand) => void
): CloseInspectionActionResolution => {
  const resolution = resolveCloseInspectionAction(view, returnTo);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
