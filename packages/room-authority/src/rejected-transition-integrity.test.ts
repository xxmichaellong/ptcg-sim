import {
  asCardDefinitionId,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  playerZoneId,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { createRoomAdmissionState } from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import { assertAuthorityTransactionTransition } from './invariants.js';
import { createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';

const p1 = asPlayerId('reject-player-one');
const p2 = asPlayerId('reject-player-two');

const createSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('reject-match'), [
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
    admission: createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: { [p1]: 'a'.repeat(32), [p2]: 'b'.repeat(32) },
      spectatorCapabilityDigest: 'c'.repeat(32),
    }),
    sessions: {
      'session-one': {
        id: 'session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const rejectedTransaction = (
  current: RoomAuthoritySnapshot,
  candidate: RoomAuthoritySnapshot
): PersistedAuthorityTransaction => ({
  expectedAuthorityVersion: current.authorityVersion,
  expectedRevision: current.state.revision,
  sessionId: 'session-one',
  outcome: {
    commandId: 'command-one',
    clientSequence: 1,
    accepted: false,
    revision: current.state.revision,
    code: 'precondition_failed',
  },
  snapshot: candidate,
});

const advanced = (
  current: RoomAuthoritySnapshot,
  overrides: Partial<RoomAuthoritySnapshot>
): RoomAuthoritySnapshot => ({
  ...current,
  authorityVersion: current.authorityVersion + 1,
  sessions: {
    ...current.sessions,
    'session-one': {
      ...current.sessions['session-one']!,
      nextClientSequence: 2,
      recentOutcomes: [
        {
          commandId: 'command-one',
          clientSequence: 1,
          accepted: false,
          revision: current.state.revision,
          code: 'precondition_failed',
        },
      ],
    },
  },
  ...overrides,
});

// `structurallyEqual` short-circuits on reference identity so a rejected
// command does not canonically serialize the whole match state twice. These
// tests pin that the short-circuit only accelerates the untampered case: a
// candidate that actually differs is still rejected.
describe('rejected authority transition integrity', () => {
  it('accepts a rejection that reuses the current fields by reference', () => {
    const current = createSnapshot();
    const candidate = advanced(current, {});
    expect(candidate.state).toBe(current.state);
    expect(() =>
      assertAuthorityTransactionTransition(
        current,
        rejectedTransaction(current, candidate)
      )
    ).not.toThrow();
  });

  it('rejects a candidate whose match state was tampered with', () => {
    const current = createSnapshot();
    const handId = playerZoneId(p1, 'hand');
    const tampered = advanced(current, {
      state: {
        ...current.state,
        definitions: {
          ...current.state.definitions,
          smuggled: {
            id: asCardDefinitionId('smuggled'),
            name: 'Smuggled',
            category: 'Pokémon',
            imageUrl: '/smuggled.png',
          },
        },
        zones: {
          ...current.state.zones,
          [handId]: { ...current.state.zones[handId]! },
        },
      },
    });
    expect(tampered.state).not.toBe(current.state);
    expect(() =>
      assertAuthorityTransactionTransition(
        current,
        rejectedTransaction(current, tampered)
      )
    ).toThrow(/rejected command changed match state/);
  });

  it('rejects a candidate whose replay history was tampered with', () => {
    const current = createSnapshot();
    const tampered = advanced(current, {
      replayHistory: {
        ...current.replayHistory,
        baseStateHash: `${current.replayHistory.baseStateHash}-tampered`,
      },
    });
    expect(() =>
      assertAuthorityTransactionTransition(
        current,
        rejectedTransaction(current, tampered)
      )
    ).toThrow();
  });

  it('rejects a candidate that silently changed admission state', () => {
    const current = createSnapshot();
    const tampered = advanced(current, {
      admission: {
        ...current.admission,
        spectatorCapabilityDigest: 'd'.repeat(32),
      },
    });
    expect(() =>
      assertAuthorityTransactionTransition(
        current,
        rejectedTransaction(current, tampered)
      )
    ).toThrow(/changed admission state/);
  });
});
