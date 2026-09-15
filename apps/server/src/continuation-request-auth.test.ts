import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { authenticateContinuationRequester } from './continuation-request-auth.js';

const p1 = asPlayerId('continuation-auth-player-one');
const p2 = asPlayerId('continuation-auth-player-two');
const resumeCapability = 'resume_continuation-auth-player-one-00000000000001';
const otherResumeCapability =
  'resume_continuation-auth-player-two-00000000000002';

const snapshotFixture = async (): Promise<RoomAuthoritySnapshot> => {
  const source = new WebCryptoAuthoritySource();
  const state = createEmptyMatch(asMatchId('continuation-auth-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: 'a'.repeat(43),
      [p2]: 'b'.repeat(43),
    },
  });
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 3,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: {
      ...admission,
      seats: {
        ...admission.seats,
        [p1]: { ...admission.seats[p1]!, claimedSessionId: 'auth-session-one' },
      },
    },
    sessions: {
      'auth-session-one': {
        id: 'auth-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
        resumeCapabilityDigest: await source.digestCapability(resumeCapability),
      },
      'auth-session-two': {
        id: 'auth-session-two',
        viewer: { kind: 'player', playerId: p2 },
        active: false,
        nextClientSequence: 1,
        recentOutcomes: [],
        resumeCapabilityDigest: await source.digestCapability(
          otherResumeCapability
        ),
      },
    },
  };
};

describe('continuation requester authentication', () => {
  it('derives only the live claimed multiplayer player session', async () => {
    const source = new WebCryptoAuthoritySource();
    const equalDigest = vi.spyOn(source, 'equalDigest');
    await expect(
      authenticateContinuationRequester(
        await snapshotFixture(),
        resumeCapability,
        source
      )
    ).resolves.toBe('auth-session-one');
    expect(equalDigest).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong, inactive, spectator, and solo bearers', async () => {
    const source = new WebCryptoAuthoritySource();
    const snapshot = await snapshotFixture();
    await expect(
      authenticateContinuationRequester(
        snapshot,
        'resume_wrong-continuation-requester-00000000000001',
        source
      )
    ).resolves.toBeUndefined();

    for (const altered of [
      {
        ...snapshot,
        sessions: {
          'auth-session-one': {
            ...snapshot.sessions['auth-session-one']!,
            active: false,
          },
        },
      },
      {
        ...snapshot,
        admission: {
          ...snapshot.admission!,
          seats: {
            ...snapshot.admission!.seats,
            [p1]: {
              ...snapshot.admission!.seats[p1]!,
              claimedSessionId: null,
            },
          },
        },
        sessions: {
          'auth-session-one': {
            ...snapshot.sessions['auth-session-one']!,
            viewer: { kind: 'spectator' as const },
          },
        },
      },
      {
        ...snapshot,
        mode: 'solo' as const,
        admission: {
          ...snapshot.admission!,
          playerSeatLimit: 1 as const,
        },
      },
    ]) {
      await expect(
        authenticateContinuationRequester(altered, resumeCapability, source)
      ).resolves.toBeUndefined();
    }
  });

  it('rejects malformed capabilities before identity work', async () => {
    const source = new WebCryptoAuthoritySource();
    const digestCapability = vi.spyOn(source, 'digestCapability');
    const snapshot = await snapshotFixture();
    await expect(
      authenticateContinuationRequester(snapshot, 'short', source)
    ).resolves.toBeUndefined();
    expect(digestCapability).not.toHaveBeenCalled();
  });
});
