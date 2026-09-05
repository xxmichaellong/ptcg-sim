import {
  parseRoomAdmissionTicketRequest,
  type RoomAdmissionTicketRequest,
} from '@ptcgsim/protocol';
import type { BoundedAdmissionTicketIssueResult } from './room-rate-limit.js';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';

export { isSameOriginBrowserRequest } from './browser-json-http.js';

export const MAX_ADMISSION_REQUEST_BYTES = 2_048;

export type AdmissionTicketIssuer = (
  request: RoomAdmissionTicketRequest
) => Promise<BoundedAdmissionTicketIssueResult>;

/** Strict browser-only exchange. Capability material is accepted only in JSON. */
export const handleAdmissionTicketRequest = async (
  request: Request,
  issue: AdmissionTicketIssuer
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
    body = await readBoundedJsonRequest(request, MAX_ADMISSION_REQUEST_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RangeError ? 'request_too_large' : 'invalid_json',
      },
      error instanceof RangeError ? 413 : 400
    );
  }
  const parsed = parseRoomAdmissionTicketRequest(body);
  if (!parsed.ok) return json({ error: 'invalid_request' }, 400);

  try {
    const result = await issue(parsed.value);
    if (result.accepted) {
      return json(
        {
          admissionTicket: result.admissionTicket,
          expiresAt: result.expiresAt,
        },
        201
      );
    }
    switch (result.code) {
      case 'invalid_request':
        return json({ error: 'invalid_request' }, 400);
      case 'invalid_capability':
        return json({ error: 'admission_rejected' }, 403);
      case 'room_not_ready':
        return json({ error: 'room_not_ready' }, 409);
      case 'ticket_capacity':
        return json({ error: 'ticket_capacity' }, 429, { 'Retry-After': '1' });
      case 'rate_limited':
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(result.retryAfterSeconds),
        });
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
