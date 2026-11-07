import type {
  RoomAuthoritySnapshot,
  RoomOpeningResult,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import {
  handleRoomOpenRequest,
  MAX_ROOM_OPEN_REQUEST_BYTES,
  type RoomOpener,
} from './room-open-http.js';

const capability = 'solo-seat-capability-never-reflected-00001';
const playerTwoSeatCapability = 'player-two-seat-returned-once-000000001';
const spectatorCapability = 'spectator-claim-returned-once-000000001';
const snapshot = {} as RoomAuthoritySnapshot;

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = 'https://play.example/v2/rooms/ABCDEFGH2345/open'
): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      Origin: 'https://play.example',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

const body = JSON.stringify({ capability, displayName: 'Ash' });

const opener = (result: RoomOpeningResult | { accepted: false; code: 'rate_limited'; retryAfterSeconds: number; snapshot: RoomAuthoritySnapshot }): RoomOpener =>
  vi.fn(async () => result);

describe('opening a Solo room over HTTP', () => {
  it('hands the new claims to the same-origin page that asked with its own', async () => {
    const open = opener({
      accepted: true,
      committed: true,
      snapshot,
      playerTwoSeatCapability,
      spectatorCapability,
      refreshes: [],
    });
    const response = await handleRoomOpenRequest(request(body), open);
    expect(response.status).toBe(201);
    expect(open).toHaveBeenCalledWith({ capability, displayName: 'Ash' });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const answer = await response.json();
    expect(answer).toEqual({
      mode: 'multiplayer',
      credentials: { playerTwoSeatCapability, spectatorCapability },
    });
    // The asking claim is never sent back.
    expect(JSON.stringify(answer)).not.toContain(capability);
  });

  it('says why it would not, in the words the other room endpoints use', async () => {
    for (const [code, status, error] of [
      ['invalid_request', 400, 'invalid_request'],
      ['invalid_capability', 403, 'admission_rejected'],
      ['not_solo', 409, 'not_solo'],
      ['room_not_ready', 409, 'room_not_ready'],
    ] as const) {
      const response = await handleRoomOpenRequest(
        request(body),
        opener({ accepted: false, code, snapshot })
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const limited = await handleRoomOpenRequest(
      request(body),
      opener({ accepted: false, code: 'rate_limited', retryAfterSeconds: 7, snapshot })
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('7');
    const failing = await handleRoomOpenRequest(request(body), async () => {
      throw new Error('storage unavailable');
    });
    expect(failing.status).toBe(503);
  });

  it('refuses another origin, a query, a wrong method, a wrong type and an oversized or malformed body', async () => {
    const open = vi.fn();
    const cases: [Request, number][] = [
      [request(body, { Origin: 'https://elsewhere.example' }), 403],
      [request(body, {}, 'https://play.example/v2/rooms/ABCDEFGH2345/open?x=1'), 400],
      [new Request('https://play.example/v2/rooms/ABCDEFGH2345/open', { method: 'GET', headers: { Origin: 'https://play.example' } }), 405],
      [request(body, { 'Content-Type': 'text/plain' }), 415],
      [request('x'.repeat(MAX_ROOM_OPEN_REQUEST_BYTES + 1)), 413],
      [request('{not json'), 400],
      [request(JSON.stringify({ capability })), 400],
      [request(JSON.stringify({ capability, displayName: 'Ash', extra: 1 })), 400],
    ];
    for (const [incoming, status] of cases) {
      expect((await handleRoomOpenRequest(incoming, open)).status).toBe(status);
    }
    expect(open).not.toHaveBeenCalled();
  });
});
