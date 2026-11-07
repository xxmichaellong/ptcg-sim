import {
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

export interface ContinuationRequesterAuthenticationSource {
  readonly digestCapability: (value: string) => Promise<string>;
  readonly equalDigest: (left: string, right: string) => boolean;
}

const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const boundedCapability = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 32 && value.length <= 512;

/**
 * Resolves a live claimed-player session from its existing resume bearer.
 * The raw bearer is never returned or passed into continuation persistence.
 */
export const authenticateContinuationRequester = async (
  snapshot: RoomAuthoritySnapshot,
  resumeCapability: unknown,
  source: ContinuationRequesterAuthenticationSource
): Promise<string | undefined> => {
  validateAuthoritySnapshot(snapshot);
  if (!boundedCapability(resumeCapability)) return undefined;
  const suppliedDigest = await source.digestCapability(resumeCapability);
  if (!DIGEST_PATTERN.test(suppliedDigest)) return undefined;
  const matches = Object.values(snapshot.sessions).filter(
    (session) =>
      typeof session.resumeCapabilityDigest === 'string' &&
      source.equalDigest(session.resumeCapabilityDigest, suppliedDigest)
  );
  if (matches.length !== 1) return undefined;
  const session = matches[0]!;
  if (
    !session.active ||
    session.viewer.kind !== 'player' ||
    snapshot.mode !== 'multiplayer' ||
    snapshot.admission?.seats[session.viewer.playerId]?.claimedSessionId !==
      session.id
  ) {
    return undefined;
  }
  return session.id;
};
