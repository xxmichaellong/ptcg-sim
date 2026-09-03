import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteRoom,
  RemoteRoomCreationError,
  RemoteRoomInvitationCustody,
} from './RemoteRoomCreation.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const credentials = {
  playerOneSeatCapability: 'player-one-capability-kept-in-memory-0000000001',
  playerTwoSeatCapability: 'player-two-capability-kept-in-memory-0000000002',
  spectatorCapability: 'spectator-capability-kept-in-memory-000000003',
};
const admissionTicket = 'socket-ticket-kept-in-session-memory-00000001';
const input = {
  buildId: 'client-build',
  displayName: '  Blue  ',
  rendererKind: 'pixi' as const,
};

describe('remote room creation bootstrap', () => {
  it('creates and bootstraps the owner without putting capabilities in URLs or the result graph', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { roomCode: 'ABCDEFGH2345', credentials },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ admissionTicket, expiresAt: 40_000 }, { status: 201 })
      );
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const createRuntime = vi.fn(() => runtime);

    const result = await createRemoteRoom(input, {
      fetch: fetchImplementation,
      origin: 'https://play.example',
      bootstrapDependencies: { now: () => 10_000, createRuntime },
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const [creationUrl, creationInit] = fetchImplementation.mock.calls[0]!;
    expect(String(creationUrl)).toBe('https://play.example/v2/rooms');
    expect(creationInit).toMatchObject({
      method: 'POST',
      body: '{}',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const [ticketUrl, ticketInit] = fetchImplementation.mock.calls[1]!;
    expect(String(ticketUrl)).toBe(
      'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets'
    );
    expect(String(ticketUrl)).not.toContain(
      credentials.playerOneSeatCapability
    );
    expect(JSON.parse(String(ticketInit?.body))).toMatchObject({
      capability: credentials.playerOneSeatCapability,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    expect(result.route).toEqual({
      kind: 'remote-room',
      runtime,
      rendererKind: 'pixi',
    });
    expect(JSON.stringify(result)).not.toContain('capability-kept-in-memory');

    expect(result.invitations.takePlayerInvitation()).toEqual({
      roomCode: 'ABCDEFGH2345',
      requestedRole: 'player',
      capability: credentials.playerTwoSeatCapability,
    });
    expect(result.invitations.takePlayerInvitation()).toBeUndefined();
    expect(result.invitations.takeSpectatorInvitation()).toEqual({
      roomCode: 'ABCDEFGH2345',
      requestedRole: 'spectator',
      capability: credentials.spectatorCapability,
    });
    expect(result.invitations.takeSpectatorInvitation()).toBeUndefined();
    result.dispose();
    result.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('validates lobby input before creating an orphaned room', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    for (const invalid of [
      { ...input, buildId: '' },
      { ...input, displayName: '   ' },
      { ...input, displayName: 'x'.repeat(65) },
      { ...input, rendererKind: 'unknown' as 'pixi' },
    ]) {
      await expect(
        createRemoteRoom(invalid, {
          fetch: fetchImplementation,
          origin: 'https://play.example',
        })
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails closed on request failures and malformed or duplicated credentials', async () => {
    const cases = [
      {
        fetch: async () => {
          throw new Error(credentials.playerOneSeatCapability);
        },
        expected: 'creation_failed',
      },
      {
        fetch: async () => Response.json({ error: 'busy' }, { status: 503 }),
        expected: 'creation_failed',
      },
      {
        fetch: async () =>
          Response.json(
            {
              roomCode: 'ABCDEFGH2345',
              credentials: {
                ...credentials,
                playerTwoSeatCapability: credentials.playerOneSeatCapability,
              },
            },
            { status: 201 }
          ),
        expected: 'invalid_response',
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ padding: 'x'.repeat(4_096) }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        expected: 'invalid_response',
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ roomCode: 'ABCDEFGH2345' }), {
            status: 201,
            headers: { 'Content-Type': 'text/html' },
          }),
        expected: 'invalid_response',
      },
    ];

    for (const entry of cases) {
      const bootstrap = vi.fn();
      await expect(
        createRemoteRoom(input, {
          fetch: entry.fetch as typeof fetch,
          origin: 'https://play.example',
          bootstrap,
        })
      ).rejects.toMatchObject({ code: entry.expected });
      expect(bootstrap).not.toHaveBeenCalled();
    }
  });

  it('clears untaken invitations and redacts a failed owner bootstrap', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ roomCode: 'ABCDEFGH2345', credentials }, { status: 201 })
    );
    let error: unknown;
    try {
      await createRemoteRoom(input, {
        fetch: fetchImplementation,
        origin: 'https://play.example',
        bootstrap: async () => {
          throw new Error(credentials.playerOneSeatCapability);
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RemoteRoomCreationError);
    expect(error).toMatchObject({ code: 'bootstrap_failed' });
    expect(String(error)).not.toContain(credentials.playerOneSeatCapability);
  });
});

describe('remote room invitation custody', () => {
  it('does not serialize secrets and clears every untaken credential on dispose', () => {
    const custody = new RemoteRoomInvitationCustody(
      'ABCDEFGH2345',
      credentials.playerTwoSeatCapability,
      credentials.spectatorCapability
    );
    expect(custody.roomCode).toBe('ABCDEFGH2345');
    expect(JSON.stringify(custody)).toBe('{}');
    custody.dispose();
    expect(custody.takePlayerInvitation()).toBeUndefined();
    expect(custody.takeSpectatorInvitation()).toBeUndefined();
    custody.dispose();
  });
});
