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
    // While it is out, Room says the code is loading.
    expect(codes.getSnapshot()).toEqual({ canChange: false, asking: true });
    answer!();
    await Promise.all([first, second]);
    expect(codes.getSnapshot()).toEqual({ code: 'K7PQ', canChange: true });
    // Asked again later: a new request.
    const later = codes.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    answer!();
    await later;
  });

  it('keeps a code the host chose over an answer asked for before it', async () => {
    const asked: ((code: string) => void)[] = [];
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          const chosen = (JSON.parse(String(init.body)) as { code?: string })
            .code;
          const respond = (code: string) =>
            resolve(
              new Response(JSON.stringify({ code, canChange: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          // A choice is answered at once; a plain ask waits for the test.
          if (chosen) respond(chosen);
          else asked.push(respond);
        })
    );
    const codes = new RoomCodeCustody({
      roomCode: 'ABCDEFGH2345',
      resumeToken: 'resume-capability-0000000000000000001',
      fetch: fetch as unknown as typeof globalThis.fetch,
      origin: 'https://example.test',
    });
    // Room opens (an ask goes out), and the host chooses a code before
    // the room's answer to that ask comes back.
    const opening = codes.refresh();
    await expect(codes.change('PKMNCLUB')).resolves.toBe('changed');
    expect(codes.getSnapshot().code).toBe('PKMNCLUB');
    asked.shift()!('K7PQ');
    await opening;
    expect(codes.getSnapshot().code).toBe('PKMNCLUB');
    // Asked again now, the room is asked again.
    const again = codes.refresh();
    expect(fetch).toHaveBeenCalledTimes(3);
    asked.shift()!('PKMNCLUB');
    await again;
    expect(codes.getSnapshot().code).toBe('PKMNCLUB');
  });
});
