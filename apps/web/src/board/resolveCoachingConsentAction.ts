import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type CoachingConsentActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'stale_player' | 'no_op';
    };

/** Converts the existing lobby choice into a seat-scoped authoritative command. */
export const resolveCoachingConsentAction = (
  view: MatchViewState,
  consent: boolean
): CoachingConsentActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const player = view.players[view.viewer.playerId];
  if (!player) return { ok: false, reason: 'stale_player' };
  if (player.coachingConsent === consent) {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: { type: 'SetCoachingConsent', consent },
  };
};

export const submitCoachingConsentAction = (
  view: MatchViewState,
  consent: boolean,
  submit: (command: WireGameCommand) => void
): CoachingConsentActionResolution => {
  const resolution = resolveCoachingConsentAction(view, consent);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
