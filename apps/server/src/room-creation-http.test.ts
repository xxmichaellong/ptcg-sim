import type { RoomCreationResponse } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  handleRoomCreationRequest,
  MAX_ROOM_CREATION_REQUEST_BYTES,
  type RoomCreator,
} from './room-creation-http.js';

const playerOneSeatCapability =
  'player-one-capability-never-reflected-0000000001';
const playerTwoSeatCapability =
  'player-two-capability-never-reflected-0000000002';
const spectatorCapability = 'spectator-capability-never-reflected-00000000003';
const created: RoomCreationResponse = {
  roomCode: 'ABCDEFGH2345',
  credentials: {
    playerOneSeatCapability,
    playerTwoSeatCapability,
    spectatorCapability,
  },
};

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = 'https://play.example/v2/rooms'
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

const acceptedCreator = (): RoomCreator => vi.fn(async () => created);

describe('room creation HTTP boundary', () => {
  it('accepts only an empty same-origin JSON request and returns no-store credentials', async () => {
    const create = acceptedCreator();
    const response = await handleRoomCreationRequest(request('{}'), create);

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual(created);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects cross-origin, non-JSON, non-empty, malformed, encoded, queried, and oversized requests', async () => {
    const create = acceptedCreator();
    const responses = await Promise.all([
      handleRoomCreationRequest(
        request('{}', { Origin: 'https://attacker.example' }),
        create
      ),
      handleRoomCreationRequest(
        request('{}', { 'Content-Type': 'text/plain' }),
        create
      ),
      handleRoomCreationRequest(request('{"spectatorsAllowed":false}'), create),
      handleRoomCreationRequest(request('{'), create),
      handleRoomCreationRequest(
        request('{}', { 'Content-Encoding': 'gzip' }),
        create
      ),
      handleRoomCreationRequest(
        request('{}', {}, 'https://play.example/v2/rooms?option=forbidden'),
        create
      ),
      handleRoomCreationRequest(
        request(
          JSON.stringify({
            padding: 'x'.repeat(MAX_ROOM_CREATION_REQUEST_BYTES),
          })
        ),
        create
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      403, 415, 400, 400, 415, 400, 413,
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it('advertises POST for other methods without invoking creation', async () => {
    const create = acceptedCreator();
    const response = await handleRoomCreationRequest(
      new Request('https://play.example/v2/rooms', {
        headers: { Origin: 'https://play.example' },
      }),
      create
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(create).not.toHaveBeenCalled();
  });

  it('does not expose thrown errors or malformed credential bundles', async () => {
    const failed = await handleRoomCreationRequest(request('{}'), async () => {
      throw new Error(playerOneSeatCapability);
    });
    const malformed = await handleRoomCreationRequest(
      request('{}'),
      async () =>
        ({
          ...created,
          credentials: {
            ...created.credentials,
            playerTwoSeatCapability: 'short',
          },
        }) as RoomCreationResponse
    );

    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"error":"internal_retryable"}');
    expect(malformed.status).toBe(503);
    const malformedBody = await malformed.text();
    expect(malformedBody).not.toContain(playerOneSeatCapability);
    expect(malformedBody).not.toContain(playerTwoSeatCapability);
  });
});
