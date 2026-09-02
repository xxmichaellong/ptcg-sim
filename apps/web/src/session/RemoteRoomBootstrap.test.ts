import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapRemoteRoom,
  RemoteRoomBootstrapError,
} from './RemoteRoomBootstrap.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const seatCapability = 'seat-capability-kept-in-post-body-0000000001';
const admissionTicket = 'socket-ticket-kept-in-session-memory-00000001';

const input = {
  buildId: 'client-build',
  roomCode: 'abcdefgh2345',
  displayName: '  Blue  ',
  requestedRole: 'player' as const,
  capability: seatCapability,
  rendererKind: 'pixi' as const,
};

describe('remote room admission bootstrap', () => {
  it('exchanges the long-lived capability only in a same-origin POST body', async () => {
    const fetchImplementation = vi.fn(
      async (_request: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ admissionTicket, expiresAt: 40_000 }, { status: 201 })
    );
    const runtime = { dispose: vi.fn() } as unknown as RemoteRoomRuntime;
    const createRuntime = vi.fn(() => runtime);

    const result = await bootstrapRemoteRoom(input, {
      fetch: fetchImplementation,
      origin: 'https://play.example',
      now: () => 10_000,
      createRuntime,
    });

    const [requestUrl, requestInit] = fetchImplementation.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      'https://play.example/v2/rooms/ABCDEFGH2345/admission-tickets'
    );
    expect(String(requestUrl)).not.toContain(seatCapability);
    expect(requestInit).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      capability: seatCapability,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    expect(createRuntime).toHaveBeenCalledWith({
      connection: {
        url: 'wss://play.example/v2/rooms/ABCDEFGH2345/connect',
        buildId: 'client-build',
        roomCode: 'ABCDEFGH2345',
        displayName: 'Blue',
        requestedRole: 'player',
        admissionTicket,
      },
    });
    expect(JSON.stringify(createRuntime.mock.calls)).not.toContain(
      seatCapability
    );
    expect(result).toEqual({
      runtime,
      route: { kind: 'remote-room', runtime, rendererKind: 'pixi' },
    });
  });

  it('fails closed on errors, malformed payloads, and expired tickets', async () => {
    const cases = [
      {
        fetch: async () =>
          Response.json({ error: seatCapability }, { status: 403 }),
        expected: 'exchange_failed',
      },
      {
        fetch: async () =>
          Response.json(
            { admissionTicket: 'short', expiresAt: 40_000 },
            { status: 201 }
          ),
        expected: 'invalid_response',
      },
      {
        fetch: async () =>
          Response.json(
            { admissionTicket, expiresAt: 10_000 },
            { status: 201 }
          ),
        expected: 'expired_ticket',
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ padding: 'x'.repeat(2_048) }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        expected: 'invalid_response',
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ admissionTicket, expiresAt: 40_000 }), {
            status: 201,
            headers: { 'Content-Type': 'text/html' },
          }),
        expected: 'invalid_response',
      },
    ];

    for (const entry of cases) {
      const createRuntime = vi.fn();
      let error: unknown;
      try {
        await bootstrapRemoteRoom(input, {
          fetch: entry.fetch as typeof fetch,
          origin: 'https://play.example',
          now: () => 10_000,
          createRuntime,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RemoteRoomBootstrapError);
      expect(error).toMatchObject({ code: entry.expected });
      expect(String(error)).not.toContain(seatCapability);
      expect(createRuntime).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid room/origin/input before performing a request', async () => {
    const fetchImplementation = vi.fn();
    for (const overrides of [
      { roomCode: 'bad-room' },
      { capability: 'short' },
    ]) {
      await expect(
        bootstrapRemoteRoom(
          { ...input, ...overrides },
          { fetch: fetchImplementation, origin: 'https://play.example' }
        )
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await expect(
      bootstrapRemoteRoom(input, {
        fetch: fetchImplementation,
        origin: 'https://user:secret@play.example',
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
