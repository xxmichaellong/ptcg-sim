import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { initializeNewRoom } from './create-room.js';

describe('new durable room initialization', () => {
  it('persists only capability digests before returning distinct invitations', async () => {
    let persisted: unknown;
    const initialize = vi.fn(async (snapshot, lifecycle) => {
      persisted = structuredClone(snapshot);
      expect(lifecycle).toEqual({
        createdAt: 10_000,
        unclaimedExpiresAt: 310_000,
      });
    });
    const source = new WebCryptoAuthoritySource();
    const result = await initializeNewRoom(
      {
        matchId: 'ROOM_ABC123',
        playerOneCardBackUrl: '/cardback.png',
        playerTwoCardBackUrl: '/cardback.png',
        spectatorsAllowed: true,
      },
      { initialize },
      source,
      10_000
    );

    expect(initialize).toHaveBeenCalledOnce();
    const credentials = Object.values(result.credentials);
    expect(new Set(credentials).size).toBe(3);
    const serialized = JSON.stringify(persisted);
    for (const capability of credentials) {
      expect(serialized).not.toContain(capability);
    }
    expect(result.snapshot.state.playerOrder).toHaveLength(2);
    expect(result.snapshot.admission?.spectatorCapabilityDigest).toHaveLength(
      43
    );
  });

  it('does not return credentials when durable initialization fails', async () => {
    const source = new WebCryptoAuthoritySource();
    await expect(
      initializeNewRoom(
        {
          matchId: 'ROOM_FAILURE',
          playerOneCardBackUrl: '/cardback.png',
          playerTwoCardBackUrl: '/cardback.png',
          spectatorsAllowed: false,
        },
        {
          initialize: async () => {
            throw new Error('durable initialization failed');
          },
        },
        source,
        10_000
      )
    ).rejects.toThrow('durable initialization failed');
  });

  it('fails before persistence for invalid match identifiers', async () => {
    const initialize = vi.fn();
    await expect(
      initializeNewRoom(
        {
          matchId: '',
          playerOneCardBackUrl: '/cardback.png',
          playerTwoCardBackUrl: '/cardback.png',
          spectatorsAllowed: false,
        },
        { initialize },
        new WebCryptoAuthoritySource(),
        10_000
      )
    ).rejects.toThrow('Match ID');
    expect(initialize).not.toHaveBeenCalled();
  });

  it('fails before entropy or persistence for an invalid lifecycle policy', async () => {
    const initialize = vi.fn();
    const source = new WebCryptoAuthoritySource();
    const nextPlayerId = vi.spyOn(source, 'nextPlayerId');

    await expect(
      initializeNewRoom(
        {
          matchId: 'ROOM_INVALID_LIFECYCLE',
          playerOneCardBackUrl: '/cardback.png',
          playerTwoCardBackUrl: '/cardback.png',
          spectatorsAllowed: false,
        },
        { initialize },
        source,
        -1
      )
    ).rejects.toThrow('lifecycle policy');
    expect(nextPlayerId).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('retries colliding capabilities and fails closed before persistence when entropy stays invalid', async () => {
    class ControlledSource extends WebCryptoAuthoritySource {
      readonly seatCapabilities: string[] = [];
      spectatorCapability = 'spectator-capability-000000000000000003';

      override nextSeatCapability(): string {
        return this.seatCapabilities.shift() ?? 'short';
      }

      override nextSpectatorCapability(): string {
        return this.spectatorCapability;
      }
    }

    const recovered = new ControlledSource();
    recovered.seatCapabilities.push(
      'colliding-capability-00000000000000001',
      'colliding-capability-00000000000000001',
      'player-one-capability-00000000000000001',
      'player-two-capability-00000000000000002'
    );
    const initialize = vi.fn(async () => undefined);
    const result = await initializeNewRoom(
      {
        matchId: 'ROOM_RECOVERED',
        playerOneCardBackUrl: '/cardback.png',
        playerTwoCardBackUrl: '/cardback.png',
        spectatorsAllowed: true,
      },
      { initialize },
      recovered,
      10_000
    );
    expect(new Set(Object.values(result.credentials)).size).toBe(3);
    expect(initialize).toHaveBeenCalledOnce();

    const invalid = new ControlledSource();
    invalid.spectatorCapability = 'short';
    const rejectedInitialize = vi.fn();
    await expect(
      initializeNewRoom(
        {
          matchId: 'ROOM_REJECTED',
          playerOneCardBackUrl: '/cardback.png',
          playerTwoCardBackUrl: '/cardback.png',
          spectatorsAllowed: true,
        },
        { initialize: rejectedInitialize },
        invalid,
        10_000
      )
    ).rejects.toThrow('distinct bounded credentials');
    expect(rejectedInitialize).not.toHaveBeenCalled();

    const duplicateDigest = new WebCryptoAuthoritySource();
    duplicateDigest.digestCapability = vi.fn(async () => 'd'.repeat(43));
    const digestInitialize = vi.fn();
    await expect(
      initializeNewRoom(
        {
          matchId: 'ROOM_DIGEST_REJECTED',
          playerOneCardBackUrl: '/cardback.png',
          playerTwoCardBackUrl: '/cardback.png',
          spectatorsAllowed: true,
        },
        { initialize: digestInitialize },
        duplicateDigest,
        10_000
      )
    ).rejects.toThrow('duplicate credentials');
    expect(digestInitialize).not.toHaveBeenCalled();
  });
});
