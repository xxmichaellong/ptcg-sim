import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  createRoomAdmissionState,
  expireDisconnectedRoomSessions,
} from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import { assertAdmissionTransactionTransition } from './invariants.js';
import { createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type AuthoritySession,
  type PersistedAdmissionTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';

const p1 = asPlayerId('expiry-player-one');
const p2 = asPlayerId('expiry-player-two');

/**
 * Real session ids are `session_<base64url>`, and that alphabet spans the
 * case boundary. Code-unit order puts every uppercase letter before every
 * lowercase one; locale collation interleaves them. These two ids are ordered
 * differently by the two rules, which is all it takes.
 */
const upperId = 'session_ZZZZZZZZZZZZZZZZZZZZZZZZ';
const lowerId = 'session_aaaaaaaaaaaaaaaaaaaaaaaa';

const disconnected = (
  id: string,
  reconnectExpiresAt: number
): AuthoritySession => ({
  id,
  viewer: { kind: 'spectator' },
  // A session awaiting reconnect stays admitted; the invariant requires it.
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
  reconnectExpiresAt,
});

const snapshotWithDueSessions = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('expiry-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {
      [upperId]: disconnected(upperId, 1_000),
      [lowerId]: disconnected(lowerId, 1_000),
    },
    admission: createRoomAdmissionState({
      playerSeatLimit: 2,
      playerIds: [p1, p2],
      seatCapabilityDigests: { [p1]: 'a'.repeat(64), [p2]: 'b'.repeat(64) },
      spectatorCapabilityDigest: 'c'.repeat(64),
    }),
  };
};

/**
 * Expiring two reconnect leases in one sweep must commit.
 *
 * The transition invariant requires the declared session ids to be in
 * code-unit order -- it compares them against `[...new Set(ids)].sort()` and
 * against its own `.sort()`ed expectation. The producer sorted them with
 * `localeCompare` instead, and the two rules disagree as soon as the ids differ
 * first across the case boundary, which `session_<base64url>` ids do routinely.
 *
 * The consequence is not cosmetic: the commit throws, the sweep fails, and
 * every disconnected session in it keeps its seat claimed.
 */
describe('session expiry ordering', () => {
  it('commits when two due sessions order differently under collation', async () => {
    const transactions: PersistedAdmissionTransaction[] = [];
    const current = snapshotWithDueSessions();
    const result = await expireDisconnectedRoomSessions(current, 2_000, {
      commitAdmission: async (transaction) => {
        // Exactly what the durable store does before writing, so a
        // declaration the invariant rejects fails here the way it does in
        // production rather than being quietly collected.
        assertAdmissionTransactionTransition(current, transaction);
        transactions.push(transaction);
      },
    });

    expect(result.committed).toBe(true);
    expect(result.expiredSessions.map((session) => session.id).sort()).toEqual(
      [lowerId, upperId].sort()
    );

    const transaction = transactions[0];
    expect(transaction?.kind).toBe('sessions_expired');
    const declared =
      transaction?.kind === 'sessions_expired' ? transaction.sessionIds : [];
    expect(
      [...declared],
      'declared ids are in the code-unit order the invariant requires'
    ).toEqual([...declared].sort());
  });
});
