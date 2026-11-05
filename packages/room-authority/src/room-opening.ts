import {
  applyEvent,
  coachingConsentRevocations,
  type MatchState,
} from '@ptcgsim/game-core';

/**
 * Solo's board-flip consent withdrawn from each seat that gave it, as a
 * player's own withdrawal would (CoachingConsentSet): the looks across seats
 * it allowed go with it. A Solo room opened to an opponent starts so
 * (ADR-044): in a room each player gives their own.
 */
export const withdrawSoloConsents = (state: MatchState): MatchState =>
  state.playerOrder.reduce(
    (next, playerId) =>
      next.players[playerId]?.coachingConsent === true
        ? applyEvent(next, {
            type: 'CoachingConsentSet',
            playerId,
            expectedConsent: true,
            consent: false,
            revokedInspections: coachingConsentRevocations(next, playerId),
          })
        : next,
    state
  );
