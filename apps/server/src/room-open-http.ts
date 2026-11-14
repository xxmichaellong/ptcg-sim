import {
  parseRoomOpenRequest,
  type RoomOpenRequest,
} from '@ptcgsim/protocol';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import type { BoundedRoomOpeningResult } from './room-rate-limit.js';

export const MAX_ROOM_OPEN_REQUEST_BYTES = 2_048;

export type RoomOpener = (
  request: RoomOpenRequest
) => Promise<BoundedRoomOpeningResult>;

/**
 * A Solo room opened to an opponent in place (ADR-044): the same strict
 * browser-only exchange as an admission ticket. The Solo player's own seat
 * claim asks; the answer carries the new second-seat and spectator claims,
 * for the asking page's invitation custody alone.
 */
export const handleRoomOpenRequest = async (
  request: Request,
  open: RoomOpener
): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }
  if (new URL(request.url).search) {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!isSameOriginBrowserRequest(request)) {
    return json({ error: 'forbidden_origin' }, 403);
  }
  if (!isIdentityJsonRequest(request)) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  let body: unknown;
  try {
    body = await readBoundedJsonRequest(request, MAX_ROOM_OPEN_REQUEST_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RangeError ? 'request_too_large' : 'invalid_json',
      },
      error instanceof RangeError ? 413 : 400
    );
  }
  const parsed = parseRoomOpenRequest(body);
  if (!parsed.ok) return json({ error: 'invalid_request' }, 400);

  try {
    const result = await open(parsed.value);
    if (result.accepted) {
      return json(
        {
          mode: 'multiplayer',
          credentials: {
            playerTwoSeatCapability: result.playerTwoSeatCapability,
            spectatorCapability: result.spectatorCapability,
          },
        },
        201
      );
    }
    switch (result.code) {
      case 'invalid_request':
        return json({ error: 'invalid_request' }, 400);
      case 'invalid_capability':
        return json({ error: 'admission_rejected' }, 403);
      case 'not_solo':
        return json({ error: 'not_solo' }, 409);
      case 'room_not_ready':
        return json({ error: 'room_not_ready' }, 409);
      case 'rate_limited':
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(result.retryAfterSeconds),
        });
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
