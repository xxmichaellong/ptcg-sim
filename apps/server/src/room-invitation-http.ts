import {
  parseRoomInvitationIssueRequest,
  type RoomInvitationIssueRequest,
} from '@ptcgsim/protocol';
import type { BoundedRoomInvitationIssueResult } from './room-rate-limit.js';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';

export const MAX_ROOM_INVITATION_REQUEST_BYTES = 1_024;

export type RoomInvitationIssuer = (
  request: RoomInvitationIssueRequest
) => Promise<BoundedRoomInvitationIssueResult>;

/** Mints an expiring one-use guest claim without returning the master token. */
export const handleRoomInvitationRequest = async (
  request: Request,
  issue: RoomInvitationIssuer
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
      MAX_ROOM_INVITATION_REQUEST_BYTES
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
  const parsed = parseRoomInvitationIssueRequest(body);
  if (!parsed.ok) return json({ error: 'invalid_request' }, 400);

  try {
    const result = await issue(parsed.value);
    if (result.accepted) {
      if (result.requestedRole !== parsed.value.requestedRole) {
        throw new Error('invitation_role_mismatch');
      }
      return json(
        {
          invitation: result.invitation,
          requestedRole: result.requestedRole,
          expiresAt: result.expiresAt,
        },
        201
      );
    }
    switch (result.code) {
      case 'invalid_request':
        return json({ error: 'invalid_request' }, 400);
      case 'invalid_capability':
        return json({ error: 'invitation_rejected' }, 403);
      case 'seat_unavailable':
        return json({ error: 'seat_unavailable' }, 409);
      case 'room_not_ready':
        return json({ error: 'room_not_ready' }, 409);
      case 'invitation_capacity':
        return json({ error: 'invitation_capacity' }, 429, {
          'Retry-After': '1',
        });
      case 'rate_limited':
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(result.retryAfterSeconds),
        });
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
