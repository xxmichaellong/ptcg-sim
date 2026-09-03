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

export const MAX_ROOM_CREATION_REQUEST_BYTES = 64;

export type RoomCreator = () => Promise<RoomCreationResponse>;

/** Strict browser-only creation endpoint; no creation options are client-owned. */
export const handleRoomCreationRequest = async (
  request: Request,
  create: RoomCreator
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
    const created = parseRoomCreationResponse(await create());
    if (!created.ok) throw new Error('invalid_room_creation_result');
    return json(created.value, 201);
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
