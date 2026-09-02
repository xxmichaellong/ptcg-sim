import {
  parseRoomAdmissionTicketRequest,
  type RoomAdmissionTicketRequest,
} from '@ptcgsim/protocol';
import type { AdmissionTicketIssueResult } from '@ptcgsim/room-authority';

export const MAX_ADMISSION_REQUEST_BYTES = 2_048;

export type AdmissionTicketIssuer = (
  request: RoomAdmissionTicketRequest
) => Promise<AdmissionTicketIssueResult>;

const responseHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

const json = (
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
): Response =>
  Response.json(body, {
    status,
    headers: { ...responseHeaders, ...headers },
  });

export const isSameOriginBrowserRequest = (request: Request): boolean => {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

const readBoundedText = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_ADMISSION_REQUEST_BYTES) {
        await reader.cancel();
        throw new RangeError('request_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
};

const readBoundedJson = async (request: Request): Promise<unknown> => {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_ADMISSION_REQUEST_BYTES
    ) {
      throw new RangeError('request_too_large');
    }
  }
  const body = await readBoundedText(request.body);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SyntaxError('invalid_json');
  }
};

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
  if (
    (request.headers.get('Content-Encoding') ?? 'identity') !== 'identity' ||
    request.headers
      .get('Content-Type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() !== 'application/json'
  ) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
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
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
