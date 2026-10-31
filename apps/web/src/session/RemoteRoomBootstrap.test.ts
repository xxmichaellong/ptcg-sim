import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapRemoteRoom,
  RemoteRoomBootstrapError,
} from './RemoteRoomBootstrap.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const seatCapability = 'seat-capability-kept-in-post-body-0000000001';
const admissionTicket = 'socket-ticket-kept-in-session-memory-00000001';
const resumeToken = 'resume-token-kept-in-session-memory-000000000001';

const input = {
  buildId: 'client-build',
  roomCode: 'abcdefgh2345',
  displayName: '  Blue  ',
  requestedRole: 'player' as const,
  capability: seatCapability,
};

/**
 * A fetch whose answer stalls -- before its headers, or partway through its
 * body -- until the request's signal gives it up, as a browser's does.
 */
const stalledFetch =
  (stall: 'headers' | 'body'): typeof fetch =>
  async (_request, init) => {
    const signal = init?.signal;
    if (!signal) return new Promise<never>(() => undefined);
    if (stall === 'headers') {
      return new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      );
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"admission'));
          signal.addEventListener(
            'abort',
            () => controller.error(signal.reason),
            { once: true }
          );
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  };

describe('remote room admission bootstrap', () => {
  it(
    'gives up a ticket exchange whose answer stalls',
    { timeout: 2_000 },
    async () => {
      for (const [stall, code] of [
        ['headers', 'exchange_failed'],
        ['body', 'invalid_response'],
      ] as const) {
        const createRuntime = vi.fn(() => ({}) as RemoteRoomRuntime);
        await expect(
          bootstrapRemoteRoom(input, {
            fetch: stalledFetch(stall),
            origin: 'https://play.example',
            requestTimeoutMs: 20,
            createRuntime,
          })
        ).rejects.toMatchObject({ code });
        expect(createRuntime).not.toHaveBeenCalled();
      }
    }
  );

  it('exchanges the long-lived capability only in a same-origin POST body', async () => {
    const fetchImplementation = vi.fn(
      async (_request: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          { admissionTicket, resumeToken, expiresAt: 40_000 },
          { status: 201 }
        )
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
        resumeToken,
      },
    });
    expect(JSON.stringify(createRuntime.mock.calls)).not.toContain(
      seatCapability
    );
    expect(result).toEqual({
      runtime,
      route: { kind: 'remote-room', runtime },
    });
  });

  it("leaves a ticket's expiry to the server, whatever this browser's clock says", async () => {
    for (const now of [10_000 + 31_000, 10_000 - 5 * 60_000 - 1]) {
      const createRuntime = vi.fn(() => ({}) as RemoteRoomRuntime);
      await bootstrapRemoteRoom(input, {
        fetch: (async () =>
          Response.json(
            { admissionTicket, resumeToken, expiresAt: 40_000 },
            { status: 201 }
          )) as typeof fetch,
        origin: 'https://play.example',
        now: () => now,
        createRuntime,
      });
      expect(createRuntime).toHaveBeenCalledOnce();
    }
  });

  it('fails closed on errors and malformed payloads', async () => {
    const cases = [
      {
        fetch: async () =>
          Response.json({ error: seatCapability }, { status: 403 }),
        expected: 'exchange_failed',
      },
      {
        fetch: async () =>
          Response.json(
            { admissionTicket: 'short', resumeToken, expiresAt: 40_000 },
            { status: 201 }
          ),
        expected: 'invalid_response',
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
          new Response(
            JSON.stringify({ admissionTicket, resumeToken, expiresAt: 40_000 }),
            {
              status: 201,
              headers: { 'Content-Type': 'text/html' },
            }
          ),
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
