import type {
  MatchViewState,
  StagedCardsDestination,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  resolveWorkAreaCardsAction,
  submitWorkAreaCardsAction,
  type WorkAreaCardsActionResolution,
} from './resolveWorkAreaCardsAction.js';

export type StagedCardsActionResolution = WorkAreaCardsActionResolution;

/** Resolves one legacy attached-card bulk button into a stale-safe command. */
export const resolveStagedCardsAction = (
  view: MatchViewState,
  destination: StagedCardsDestination
): StagedCardsActionResolution => {
  return resolveWorkAreaCardsAction(view, 'staged', destination);
};

export const submitStagedCardsAction = (
  view: MatchViewState,
  destination: StagedCardsDestination,
  submit: (command: WireGameCommand) => void
): StagedCardsActionResolution => {
  return submitWorkAreaCardsAction(view, 'staged', destination, submit);
};
