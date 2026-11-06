import { describe, expect, it, vi } from 'vitest';

import { RoomCodeCustody } from './room-code.js';

describe('a room’s code, as the page asks for it (ADR-047)', () => {
  it('asks once while an ask is out, and again once it is answered', async () => {
    let answer: (() => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = () =>
            resolve(
              new Response(JSON.stringify({ code: 'K7PQ', canChange: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
        })
    );
    const codes = new RoomCodeCustody({
      roomCode: 'ABCDEFGH2345',
      resumeToken: 'resume-capability-0000000000000000001',
      fetch: fetch as unknown as typeof globalThis.fetch,
      origin: 'https://example.test',
    });
    // A connection and Room opening together (or React mounting twice in
    // development): one request, one answer for both.
    const first = codes.refresh();
    const second = codes.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    answer!();
    await Promise.all([first, second]);
    expect(codes.getSnapshot()).toEqual({ code: 'K7PQ', canChange: true });
    // Asked again later: a new request.
    const later = codes.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    answer!();
    await later;
  });
});
