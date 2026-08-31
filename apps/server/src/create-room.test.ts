import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { initializeNewRoom } from './create-room.js';

describe('new durable room initialization', () => {
  it('persists only capability digests before returning distinct invitations', async () => {
    let persisted: unknown;
    const initialize = vi.fn(async (snapshot) => {
      persisted = structuredClone(snapshot);
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
      source
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
        source
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
        new WebCryptoAuthoritySource()
      )
    ).rejects.toThrow('Match ID');
    expect(initialize).not.toHaveBeenCalled();
  });
});
