import type { ImageBytes } from './image-bytes.js';

/**
 * An outside image fetched once for the browser that asks, which re-encodes
 * it at card size and uploads it to the store (ADR-041): the import of a
 * pasted URL, and of a card back saved as a URL before references. The
 * Worker never serves an outside image to anyone else.
 */

/** The largest outside image read. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_REDIRECTS = 3;
export const IMPORT_TIMEOUT_MS = 8_000;
export const MAX_IMPORT_URL_CODE_UNITS = 4_096;

/** Raster pictures a canvas can re-encode; no SVG. */
const IMPORTABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

export type ImageImportFailure =
  | 'invalid_url'
  | 'forbidden_host'
  | 'too_many_redirects'
  | 'not_found'
  | 'not_image'
  | 'too_large'
  | 'fetch_failed';

export type ImageImportResult =
  | {
      readonly ok: true;
      readonly type: string;
      readonly bytes: ImageBytes;
    }
  | { readonly ok: false; readonly failure: ImageImportFailure };

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const BLOCKED_NAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.arpa',
];

/**
 * Whether a URL may be fetched: https on its default port, no credentials,
 * and a host name rather than an address (the WHATWG parser already turns
 * `2130706433` or `0x7f.1` into `127.0.0.1`), never a local or metadata
 * name. A Worker cannot reach private addresses through `fetch`, so refusing
 * every address literal and the local names is the check that can be made.
 */
export const importableUrl = (
  value: string
): URL | { readonly failure: 'invalid_url' | 'forbidden_host' } => {
  if (value.length < 1 || value.length > MAX_IMPORT_URL_CODE_UNITS)
    return { failure: 'invalid_url' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { failure: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { failure: 'invalid_url' };
  if (url.username || url.password) return { failure: 'invalid_url' };
  if (url.port !== '' && url.port !== '443')
    return { failure: 'forbidden_host' };
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    host === '' ||
    host.startsWith('[') ||
    IPV4.test(host) ||
    !host.includes('.') ||
    BLOCKED_NAMES.has(host) ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return { failure: 'forbidden_host' };
  return url;
};

const readCapped = async (
  response: Response,
  limit: number
): Promise<ImageBytes | null> => {
  const declared = Number(response.headers.get('Content-Length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
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

/** Fetches one outside picture within the caps, each redirect checked anew. */
export const importRemoteImage = async (
  value: string,
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  timeoutMs = IMPORT_TIMEOUT_MS
): Promise<ImageImportResult> => {
  let target = importableUrl(value);
  for (let hop = 0; hop <= MAX_IMPORT_REDIRECTS; hop += 1) {
    if (!(target instanceof URL)) return { ok: false, failure: target.failure };
    let response: Response;
    try {
      response = await fetcher(target.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'image/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, failure: 'fetch_failed' };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, failure: 'fetch_failed' };
      let next: string;
      try {
        next = new URL(location, target).toString();
      } catch {
        return { ok: false, failure: 'invalid_url' };
      }
      target = importableUrl(next);
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, failure: 'not_found' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, failure: 'fetch_failed' };
    }
    const type = (response.headers.get('Content-Type') ?? '')
      .split(';', 1)[0]!
      .trim()
      .toLowerCase();
    if (!IMPORTABLE_TYPES.has(type)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, failure: 'not_image' };
    }
    let bytes: ImageBytes | null;
    try {
      bytes = await readCapped(response, MAX_IMPORT_BYTES);
    } catch {
      return { ok: false, failure: 'fetch_failed' };
    }
    if (!bytes) return { ok: false, failure: 'too_large' };
    if (bytes.byteLength === 0) return { ok: false, failure: 'not_image' };
    return { ok: true, type, bytes };
  }
  return { ok: false, failure: 'too_many_redirects' };
};
