import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  admitRoomSession,
  createRoomAdmissionState,
  type AdmissionCrypto,
} from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type PersistedAdmissionTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
const seatOneToken = 'seat-one-capability-0000000000000001';
const seatTwoToken = 'seat-two-capability-0000000000000002';
const spectatorToken = 'spectator-capability-000000000000003';

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, '0').repeat(8);
};

const createSnapshot = (): RoomAuthoritySnapshot => ({
  schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  authorityVersion: 0,
  state: createEmptyMatch(asMatchId('admission-match'), [
    { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
  ]),
  identities: emptyProjectionIdentityState(),
  sessions: {},
  admission: createRoomAdmissionState({
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: digest(seatOneToken),
      [p2]: digest(seatTwoToken),
    },
    spectatorCapabilityDigest: digest(spectatorToken),
  }),
});

const createCrypto = (): AdmissionCrypto => {
  let session = 0;
  let resume = 0;
  return {
    digestCapability: vi.fn(async (capability) => digest(capability)),
    equalDigest: (left, right) => left === right,
    nextSessionId: () => `session-${String(++session).padStart(24, '0')}`,
    nextResumeCapability: () =>
      `resume-capability-${String(++resume).padStart(24, '0')}`,
  };
};

const persistence = () => {
  const transactions: PersistedAdmissionTransaction[] = [];
  return {
    transactions,
    commitAdmission: async (transaction: PersistedAdmissionTransaction) => {
      transactions.push(transaction);
    },
  };
};

const dependencies = (
  crypto: AdmissionCrypto,
  storage: ReturnType<typeof persistence>
) => {
  let opaque = 0;
  return {
    crypto,
    persistence: storage,
    opaqueIds: {
      nextOpaqueId: (kind: 'card' | 'definition') =>
        `opaque-${kind}-${String(++opaque).padStart(12, '0')}`,
    },
  };
};

describe('room capability admission', () => {
  it('claims a seat once and persists only the resume digest', async () => {
    const storage = persistence();
    const result = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: '  Blue Player  ',
      },
      dependencies(createCrypto(), storage)
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.committed).toBe(true);
    expect(result.snapshot.authorityVersion).toBe(1);
    expect(result.snapshot.state.revision).toBe(0);
    expect(result.snapshot.state.players[p1]?.displayName).toBe('Blue Player');
    expect(result.session.viewer).toEqual({ kind: 'player', playerId: p1 });
    expect(result.session.resumeCapabilityDigest).toBe(
      digest(result.resumeCapability)
    );
    expect(JSON.stringify(result.snapshot)).not.toContain(
      result.resumeCapability
    );
    expect(storage.transactions[0]).toMatchObject({
      expectedAuthorityVersion: 0,
      kind: 'seat_claimed',
    });

    const reused = await admitRoomSession(
      result.snapshot,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Attacker',
      },
      dependencies(createCrypto(), storage)
    );
    expect(reused).toMatchObject({
      accepted: true,
      committed: true,
      session: { id: result.session.id },
      resumeCapability: seatOneToken,
    });
    expect(storage.transactions).toHaveLength(2);
    expect(storage.transactions[1]?.kind).toBe('session_resumed');
  });

  it('resumes the same command session without a durable mutation', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const claimed = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Blue',
      },
      dependencies(crypto, storage)
    );
    if (!claimed.accepted) throw new Error(claimed.code);

    const resumed = await admitRoomSession(
      claimed.snapshot,
      { type: 'Resume', resumeCapability: claimed.resumeCapability },
      dependencies(crypto, storage)
    );
    expect(resumed).toMatchObject({
      accepted: true,
      committed: true,
      session: { id: claimed.session.id, nextClientSequence: 1 },
    });
    expect(storage.transactions).toHaveLength(2);
    expect(storage.transactions[1]?.kind).toBe('session_resumed');
  });

  it('recovers a seat claim committed before its welcome reply was lost', async () => {
    const crypto = createCrypto();
    let durable = createSnapshot();
    await expect(
      admitRoomSession(
        durable,
        {
          type: 'ClaimSeat',
          seatCapability: seatOneToken,
          displayName: 'Blue',
        },
        {
          ...dependencies(crypto, persistence()),
          persistence: {
            commitAdmission: async (transaction) => {
              durable = transaction.snapshot;
              throw new Error('reply path crashed after commit');
            },
          },
        }
      )
    ).rejects.toThrow('reply path crashed after commit');
    expect(durable.authorityVersion).toBe(1);
    const committedSessionId = durable.admission?.seats[p1]?.claimedSessionId;

    const retryStorage = persistence();
    const retried = await admitRoomSession(
      durable,
      {
        type: 'ClaimSeat',
        seatCapability: seatOneToken,
        displayName: 'Ignored Retry Name',
      },
      dependencies(crypto, retryStorage)
    );

    expect(retried).toMatchObject({
      accepted: true,
      session: { id: committedSessionId },
      resumeCapability: seatOneToken,
    });
    expect(retryStorage.transactions[0]?.kind).toBe('session_resumed');
    expect(retried.snapshot.state.players[p1]?.displayName).toBe('Blue');
  });

  it('creates independent spectator sessions from the spectator capability', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const first = await admitRoomSession(
      createSnapshot(),
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    if (!first.accepted) throw new Error(first.code);
    const second = await admitRoomSession(
      first.snapshot,
      { type: 'JoinSpectator', spectatorCapability: spectatorToken },
      dependencies(crypto, storage)
    );
    if (!second.accepted) throw new Error(second.code);

    expect(first.session.viewer).toEqual({ kind: 'spectator' });
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.snapshot.authorityVersion).toBe(2);
    expect(storage.transactions).toHaveLength(2);
  });

  it('rejects invalid capabilities without echoing them or writing', async () => {
    const storage = persistence();
    const secret = 'wrong-capability-000000000000000000';
    const result = await admitRoomSession(
      createSnapshot(),
      {
        type: 'ClaimSeat',
        seatCapability: secret,
        displayName: 'Blue',
      },
      dependencies(createCrypto(), storage)
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(storage.transactions).toHaveLength(0);
  });

  it('rejects undersized tokens before hashing', async () => {
    const storage = persistence();
    const crypto = createCrypto();
    const result = await admitRoomSession(
      createSnapshot(),
      { type: 'Resume', resumeCapability: 'short' },
      dependencies(crypto, storage)
    );

    expect(result).toMatchObject({ accepted: false, code: 'invalid_request' });
    expect(crypto.digestCapability).not.toHaveBeenCalled();
  });
});
