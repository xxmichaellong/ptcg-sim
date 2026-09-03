import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapRemoteRoomInvitation,
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
const playerInvitation = 'player-invitation-share-token-000000000000001';
const spectatorInvitation = 'spectator-invitation-share-token-0000000001';
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
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            invitation: playerInvitation,
            requestedRole: 'player',
            expiresAt: 910_000,
          },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            invitation: spectatorInvitation,
            requestedRole: 'spectator',
            expiresAt: 910_000,
          },
          { status: 201 }
        )
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

    const player = await result.invitations.issuePlayerInvitation();
    expect(player).toEqual({
      roomCode: 'ABCDEFGH2345',
      requestedRole: 'player',
      invitation: playerInvitation,
      expiresAt: 910_000,
    });
    const [playerUrl, playerInit] = fetchImplementation.mock.calls[2]!;
    expect(String(playerUrl)).toBe(
      'https://play.example/v2/rooms/ABCDEFGH2345/invitations'
    );
    expect(String(playerUrl)).not.toContain(
      credentials.playerTwoSeatCapability
    );
    expect(JSON.parse(String(playerInit?.body))).toEqual({
      capability: credentials.playerTwoSeatCapability,
      requestedRole: 'player',
    });

    const spectator = await result.invitations.issueSpectatorInvitation();
    expect(spectator).toEqual({
      roomCode: 'ABCDEFGH2345',
      requestedRole: 'spectator',
      invitation: spectatorInvitation,
      expiresAt: 910_000,
    });
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[3]?.[1]?.body))
    ).toEqual({
      capability: credentials.spectatorCapability,
      requestedRole: 'spectator',
    });
    result.dispose();
    result.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    await expect(
      result.invitations.issuePlayerInvitation()
    ).rejects.toMatchObject({ code: 'disposed' });
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
  it('does not serialize secrets and clears every master credential on dispose', async () => {
    const custody = new RemoteRoomInvitationCustody({
      roomCode: 'ABCDEFGH2345',
      playerCapability: credentials.playerTwoSeatCapability,
      spectatorCapability: credentials.spectatorCapability,
      fetch: vi.fn<typeof fetch>(),
      origin: new URL('https://play.example'),
      now: () => 10_000,
    });
    expect(custody.roomCode).toBe('ABCDEFGH2345');
    expect(JSON.stringify(custody)).toBe('{}');
    custody.dispose();
    await expect(custody.issuePlayerInvitation()).rejects.toMatchObject({
      code: 'disposed',
    });
    await expect(custody.issueSpectatorInvitation()).rejects.toMatchObject({
      code: 'disposed',
    });
    custody.dispose();
  });

  it('fails closed on missing custody and invalid or expired issue responses', async () => {
    const withoutSpectator = new RemoteRoomInvitationCustody({
      roomCode: 'ABCDEFGH2345',
      playerCapability: credentials.playerTwoSeatCapability,
      fetch: vi.fn<typeof fetch>(),
      origin: new URL('https://play.example'),
      now: () => 10_000,
    });
    await expect(
      withoutSpectator.issueSpectatorInvitation()
    ).rejects.toMatchObject({ code: 'invalid_input' });

    for (const [response, code] of [
      [Response.json({ error: 'busy' }, { status: 503 }), 'issue_failed'],
      [
        Response.json(
          {
            invitation: 'short',
            requestedRole: 'player',
            expiresAt: 910_000,
          },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        Response.json(
          {
            invitation: playerInvitation,
            requestedRole: 'spectator',
            expiresAt: 910_000,
          },
          { status: 201 }
        ),
        'invalid_response',
      ],
      [
        Response.json(
          {
            invitation: playerInvitation,
            requestedRole: 'player',
            expiresAt: 10_000,
          },
          { status: 201 }
        ),
        'expired_invitation',
      ],
    ] as const) {
      const custody = new RemoteRoomInvitationCustody({
        roomCode: 'ABCDEFGH2345',
        playerCapability: credentials.playerTwoSeatCapability,
        fetch: vi.fn(async () => response.clone()),
        origin: new URL('https://play.example'),
        now: () => 10_000,
      });
      await expect(custody.issuePlayerInvitation()).rejects.toMatchObject({
        code,
      });
    }
  });

  it('aborts an in-flight invitation issue when its owner is disposed', async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          expect(init?.signal?.aborted).toBe(false);
          finish = resolve;
        })
    );
    const custody = new RemoteRoomInvitationCustody({
      roomCode: 'ABCDEFGH2345',
      playerCapability: credentials.playerTwoSeatCapability,
      fetch: fetchImplementation,
      origin: new URL('https://play.example'),
      now: () => 10_000,
    });
    const pending = custody.issuePlayerInvitation();
    custody.dispose();
    finish?.(
      Response.json(
        {
          invitation: playerInvitation,
          requestedRole: 'player',
          expiresAt: 910_000,
        },
        { status: 201 }
      )
    );

    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
  });
});

describe('invited remote room bootstrap', () => {
  it('validates a handoff then exchanges only its one-time invitation', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ admissionTicket, expiresAt: 40_000 }, { status: 201 })
    );
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const createRuntime = vi.fn(() => runtime);
    const result = await bootstrapRemoteRoomInvitation(
      {
        buildId: 'client-build',
        displayName: 'Red',
        rendererKind: 'pixi',
        invitation: {
          roomCode: 'ABCDEFGH2345',
          requestedRole: 'player',
          invitation: playerInvitation,
          expiresAt: 910_000,
        },
      },
      {
        fetch: fetchImplementation,
        origin: 'https://play.example',
        now: () => 10_000,
        createRuntime,
      }
    );

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets'
    );
    expect(String(url)).not.toContain(playerInvitation);
    expect(JSON.parse(String(init?.body))).toEqual({
      capability: playerInvitation,
      displayName: 'Red',
      requestedRole: 'player',
    });
    expect(result.runtime).toBe(runtime);
  });

  it('rejects malformed and expired handoffs before network access', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    for (const invitation of [
      { roomCode: 'bad', invitation: playerInvitation },
      {
        roomCode: 'ABCDEFGH2345',
        requestedRole: 'player',
        invitation: playerInvitation,
        expiresAt: 10_000,
      },
    ]) {
      await expect(
        bootstrapRemoteRoomInvitation(
          {
            buildId: 'client-build',
            displayName: 'Red',
            rendererKind: 'pixi',
            invitation,
          },
          {
            fetch: fetchImplementation,
            origin: 'https://play.example',
            now: () => 10_000,
          }
        )
      ).rejects.toBeInstanceOf(Error);
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
