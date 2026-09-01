import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION, type ClientMessage } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { establishSession } from './session-handshake.js';

type Hello = Extract<ClientMessage, { type: 'Hello' }>;
const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const fixture = async () => {
  const crypto = new WebCryptoAuthoritySource();
  const seatToken = crypto.nextSeatCapability();
  const otherSeatToken = crypto.nextSeatCapability();
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state: createEmptyMatch(asMatchId('handshake-room'), [
      { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
    ]),
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: await crypto.digestCapability(seatToken),
        [p2]: await crypto.digestCapability(otherSeatToken),
      },
    }),
  };
  const transactions: unknown[] = [];
  return {
    snapshot,
    seatToken,
    crypto,
    transactions,
    dependencies: {
      crypto,
      opaqueIds: crypto,
      persistence: {
        commitAdmission: async (transaction: unknown) => {
          transactions.push(transaction);
        },
      },
    },
  };
};

const hello = (overrides: Partial<Hello> = {}): Hello => ({
  type: 'Hello',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'client-build',
  roomCode: 'ROOM',
  displayName: 'Blue',
  requestedRole: 'player',
  ...overrides,
});

describe('session handshake', () => {
  it('returns a full welcome snapshot only after capability admission commits', async () => {
    const setup = await fixture();
    const result = await establishSession(
      setup.snapshot,
      hello({ admissionTicket: setup.seatToken }),
      'server-build',
      setup.dependencies
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(setup.transactions).toHaveLength(1);
    expect(result.message).toMatchObject({
      type: 'Welcome',
      buildId: 'server-build',
      role: 'player',
      playerId: p1,
      nextClientSequence: 1,
      snapshot: { revision: 0 },
    });
    expect(result.message.resumeToken).toBe(setup.seatToken);
  });

  it('rejects ambiguous or missing credentials before hashing or persistence', async () => {
    const setup = await fixture();
    const both = await establishSession(
      setup.snapshot,
      hello({
        admissionTicket: setup.seatToken,
        resumeToken: setup.crypto.nextResumeCapability(),
      }),
      'server-build',
      setup.dependencies
    );
    const neither = await establishSession(
      setup.snapshot,
      hello(),
      'server-build',
      setup.dependencies
    );

    expect(both).toMatchObject({
      accepted: false,
      message: { code: 'invalid_admission' },
    });
    expect(neither).toMatchObject({
      accepted: false,
      message: { code: 'admission_required' },
    });
    expect(setup.transactions).toHaveLength(0);
  });

  it('does not echo a rejected capability in the notice', async () => {
    const setup = await fixture();
    const invalid = 'invalid-seat-capability-00000000000000';
    const result = await establishSession(
      setup.snapshot,
      hello({ admissionTicket: invalid }),
      'server-build',
      setup.dependencies
    );

    expect(result).toMatchObject({
      accepted: false,
      message: { code: 'invalid_capability' },
    });
    expect(JSON.stringify(result)).not.toContain(invalid);
  });
});
