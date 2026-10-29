import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from '../browser-json-http.js';
import {
  readRequestRateLimitDecision,
  type RequestRateLimitDecision,
} from '../request-rate-limit.js';
import type { ImageBytes, StoredImageType } from './image-bytes.js';
import {
  importRemoteImage,
  MAX_IMPORT_URL_CODE_UNITS,
  type ImageImportFailure,
} from './image-import.js';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  type ImagePutResult,
  type StoredImage,
} from './image-store.js';

/**
 * The image store over HTTP (ADR-041):
 *
 *   POST /v2/images          a JPEG or WebP's bytes, ≤ 200 KB and
 *                            1000×1400 px → 201 { ref: "img:<sha256>" }
 *   GET  /v2/images/<sha256> the bytes, from our own origin, which browsers
 *                            keep a year (never the edge: a ban is at once)
 *   POST /v2/images/import   { url } → an outside picture's bytes, for the
 *                            asking browser to re-encode and upload
 */
export const IMAGE_PATH = '/v2/images';
export const IMAGE_IMPORT_PATH = '/v2/images/import';
const SERVE_PATH = /^\/v2\/images\/([0-9a-f]{64})$/u;

/** The hash a serving URL asks for, or undefined if it isn't one. */
export const servedImageHash = (pathname: string): string | undefined =>
  SERVE_PATH.exec(pathname)?.[1];

const IMMUTABLE = 'public, max-age=31536000, immutable';
const IMAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;
const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_URL_CODE_UNITS + 64;

export type ImageRateLimit = () => Promise<RequestRateLimitDecision>;

const rateLimited = async (
  rateLimit: ImageRateLimit | undefined,
  error: string
): Promise<Response | undefined> => {
  if (!rateLimit) return undefined;
  const decision = readRequestRateLimitDecision(await rateLimit());
  if (!decision) throw new Error('invalid_rate_limit_decision');
  return decision.allowed
    ? undefined
    : json({ error }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
};

const readBoundedBytes = async (
  request: Request,
  limit: number
): Promise<ImageBytes | null> => {
  const declared = Number(request.headers.get('Content-Length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
};

/** Takes a picture from this app's own pages, checks it, and keeps it. */
export const handleImageUploadRequest = async (
  request: Request,
  store: (bytes: ImageBytes) => Promise<ImagePutResult>,
  rateLimit?: ImageRateLimit
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
  if ((request.headers.get('Content-Encoding') ?? 'identity') !== 'identity') {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  const limited = await rateLimited(rateLimit, 'image_upload_rate_limited');
  if (limited) return limited;
  const bytes = await readBoundedBytes(request, MAX_IMAGE_UPLOAD_BYTES);
  if (!bytes) return json({ error: 'image_too_large' }, 413);
  const result = await store(bytes);
  switch (result.kind) {
    case 'stored':
      return json({ ref: `img:${result.sha256}` }, 201);
    case 'blocked':
      return json({ error: 'image_blocked' }, 403);
    case 'invalid':
      return result.reason === 'too_large'
        ? json({ error: 'image_too_large' }, 413)
        : result.reason === 'unsupported_type'
          ? json({ error: 'unsupported_image_type' }, 415)
          : json({ error: 'image_dimensions_too_large' }, 422);
  }
};

/**
 * Serves a stored picture from its store, every time: no copy is kept at the
 * edge, so a banned picture stops at once for every browser that hasn't it
 * yet (browsers keep what they have, a year, as its name never changes).
 * The cost is one store request per browser per picture.
 */
export const handleImageServeRequest = async (
  request: Request,
  sha256: string,
  read: (sha256: string) => Promise<StoredImage | null>
): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }
  if (new URL(request.url).search) {
    return json({ error: 'invalid_request' }, 400);
  }
  const image = await read(sha256);
  if (!image) return json({ error: 'not_found' }, 404);
  const response = imageResponse(image.type, image.bytes);
  return request.method === 'HEAD' ? withoutBody(response) : response;
};

const imageResponse = (type: StoredImageType, bytes: ImageBytes): Response =>
  new Response(bytes, {
    status: 200,
    headers: {
      ...IMAGE_HEADERS,
      'Cache-Control': IMMUTABLE,
      'Content-Type': type,
      'Content-Length': String(bytes.byteLength),
    },
  });

const withoutBody = (response: Response): Response =>
  new Response(null, { status: response.status, headers: response.headers });

const IMPORT_FAILURE_STATUS: Readonly<Record<ImageImportFailure, number>> = {
  invalid_url: 400,
  forbidden_host: 400,
  too_many_redirects: 502,
  not_found: 404,
  not_image: 415,
  too_large: 413,
  fetch_failed: 502,
};

/** Fetches an outside picture once for this app's own page that asks. */
export const handleImageImportRequest = async (
  request: Request,
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  rateLimit?: ImageRateLimit
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
    body = await readBoundedJsonRequest(request, MAX_IMPORT_REQUEST_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RangeError ? 'request_too_large' : 'invalid_json',
      },
      error instanceof RangeError ? 413 : 400
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const url: unknown = Reflect.get(body, 'url');
  if (typeof url !== 'string' || Object.keys(body).length !== 1) {
    return json({ error: 'invalid_request' }, 400);
  }
  const limited = await rateLimited(rateLimit, 'image_import_rate_limited');
  if (limited) return limited;
  const imported = await importRemoteImage(url, fetcher);
  if (!imported.ok) {
    return json(
      { error: imported.failure },
      IMPORT_FAILURE_STATUS[imported.failure]
    );
  }
  return new Response(imported.bytes, {
    status: 200,
    headers: {
      ...IMAGE_HEADERS,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': imported.type,
      'Content-Length': String(imported.bytes.byteLength),
    },
  });
};
