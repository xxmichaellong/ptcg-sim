import {
  parseRoomCreationRequest,
  parseRoomCreationResponse,
  type RoomCreationResponse,
} from '@ptcgsim/protocol';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import type { RequestRateLimitDecision } from './request-rate-limit.js';

export const MAX_ROOM_CREATION_REQUEST_BYTES = 64;

export type RoomCreator = () => Promise<RoomCreationResponse>;
export type RoomCreationRateLimit = () => Promise<RequestRateLimitDecision>;

/** Strict browser-only creation endpoint; no creation options are client-owned. */
export const handleRoomCreationRequest = async (
  request: Request,
  create: RoomCreator,
  rateLimit?: RoomCreationRateLimit
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
    body = await readBoundedJsonRequest(
      request,
      MAX_ROOM_CREATION_REQUEST_BYTES
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof RangeError ? 'request_too_large' : 'invalid_json',
      },
      error instanceof RangeError ? 413 : 400
    );
  }
  if (!parseRoomCreationRequest(body).ok) {
    return json({ error: 'invalid_request' }, 400);
  }

  try {
    if (rateLimit) {
      const decision = await rateLimit();
      if (!decision.allowed) {
        return json({ error: 'room_creation_rate_limited' }, 429, {
          'Retry-After': String(decision.retryAfterSeconds),
        });
      }
    }
    const created = parseRoomCreationResponse(await create());
    if (!created.ok) throw new Error('invalid_room_creation_result');
    return json(created.value, 201);
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
