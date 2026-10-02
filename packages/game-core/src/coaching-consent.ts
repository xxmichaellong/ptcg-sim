import type {
  InspectionId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';
import type { MatchState } from './model.js';

export interface CoachingConsentRevocation {
  readonly inspectionId: InspectionId;
  readonly scope: 'card' | 'zone';
  readonly sourcePlayerId: PlayerId;
  readonly sourceId: ZoneId | StackId | WorkAreaId;
  readonly viewerPlayerId: PlayerId;
  readonly cardCount: number;
}

const compareIdentifiers = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const playersHaveMutualCoachingConsent = (
  state: MatchState,
  sourcePlayerId: PlayerId,
  viewerPlayerId: PlayerId
): boolean =>
  sourcePlayerId === viewerPlayerId ||
  (state.players[sourcePlayerId]?.coachingConsent === true &&
    state.players[viewerPlayerId]?.coachingConsent === true);

export const coachingConsentRevocations = (
  state: MatchState,
  playerId: PlayerId
): readonly CoachingConsentRevocation[] =>
  Object.values(state.visibility.inspectionGrants)
    .sort((left, right) =>
      compareIdentifiers(left.inspectionId, right.inspectionId)
    )
    .flatMap((grant) =>
      [...grant.viewerIds]
        .sort(compareIdentifiers)
        .filter(
          (viewerPlayerId) =>
            (grant.sourcePlayerId === playerId &&
              viewerPlayerId !== playerId) ||
            (grant.sourcePlayerId !== playerId && viewerPlayerId === playerId)
        )
        .map((viewerPlayerId) => ({
          inspectionId: grant.inspectionId,
          scope: grant.scope,
          sourcePlayerId: grant.sourcePlayerId,
          sourceId: grant.sourceId,
          viewerPlayerId,
          cardCount: grant.cardIds.length,
        }))
    );

export const sameCoachingConsentRevocations = (
  left: readonly CoachingConsentRevocation[],
  right: readonly CoachingConsentRevocation[]
): boolean =>
  left.length === right.length &&
  left.every((revocation, index) => {
    const expected = right[index];
    return (
      revocation !== null &&
      typeof revocation === 'object' &&
      expected !== undefined &&
      revocation.inspectionId === expected.inspectionId &&
      revocation.scope === expected.scope &&
      revocation.sourcePlayerId === expected.sourcePlayerId &&
      revocation.sourceId === expected.sourceId &&
      revocation.viewerPlayerId === expected.viewerPlayerId &&
      revocation.cardCount === expected.cardCount
    );
  });
