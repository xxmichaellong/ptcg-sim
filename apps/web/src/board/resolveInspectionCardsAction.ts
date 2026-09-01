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
