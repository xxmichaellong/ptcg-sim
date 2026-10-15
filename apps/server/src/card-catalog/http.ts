import { browserJsonResponse as json } from '../browser-json-http.js';
import type { CatalogManifest } from './builder.js';

/**
 * The card catalog over HTTP (ADR-032):
 *
 *   GET /v2/cards/catalog              what is published: its version, the
 *                                      body's URL, when it was built, how
 *                                      big it is; 503 while a first build
 *                                      has nothing yet
 *   GET /v2/cards/catalog/<v>.json     the body for a version; it never
 *                                      changes, so it is cached for a year
 */
export const CARD_CATALOG_PATH = '/v2/cards/catalog';

const BODY_PATH = /^\/v2\/cards\/catalog\/([a-f0-9]{20})\.json$/u;

/** The version a body URL asks for, or undefined if it isn't one. */
export const cardCatalogBodyVersion = (pathname: string): string | undefined =>
  BODY_PATH.exec(pathname)?.[1];

export const cardCatalogBodyPath = (version: string): string =>
  `${CARD_CATALOG_PATH}/${version}.json`;

/** A new set shows within minutes of being published. */
const MANIFEST_CACHE_SECONDS = 300;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

const checkMethod = (request: Request): Response | undefined => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (new URL(request.url).search)
    return json({ error: 'invalid_request' }, 400);
  return undefined;
};

export const handleCardCatalogManifestRequest = async (
  request: Request,
  readManifest: () => Promise<CatalogManifest | null>
): Promise<Response> => {
  const refused = checkMethod(request);
  if (refused) return refused;
  const manifest = await readManifest();
  if (!manifest) {
    return json({ error: 'unavailable', building: true }, 503, {
      'Retry-After': '5',
    });
  }
  return Response.json(
    {
      version: manifest.version,
      url: cardCatalogBodyPath(manifest.version),
      builtAt: manifest.builtAt,
      sets: manifest.sets.length,
      cards: manifest.cards,
      complete: manifest.complete,
    },
    {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Cache-Control': `public, max-age=${String(MANIFEST_CACHE_SECONDS)}`,
      },
    }
  );
};

export interface CardCatalogBodyCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * Serves one version's body. It is assembled from storage once per
 * Cloudflare location (`cache`), then served from there; an unknown or
 * superseded version is 404.
 */
export const handleCardCatalogBodyRequest = async (
  request: Request,
  version: string,
  readBody: (version: string) => Promise<ReadableStream<Uint8Array> | null>,
  options: {
    readonly cache?: CardCatalogBodyCache | undefined;
    readonly waitUntil?: (promise: Promise<unknown>) => void;
  } = {}
): Promise<Response> => {
  const refused = checkMethod(request);
  if (refused) return refused;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const cached = await options.cache?.match(key).catch(() => undefined);
  if (cached) return cached;
  const body = await readBody(version);
  if (!body) return json({ error: 'not_found' }, 404);
  const response = new Response(body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Cache-Control': IMMUTABLE,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  if (!options.cache) return response;
  const [served, stored] = [response, response.clone()];
  const caching = options.cache.put(key, stored).catch(() => undefined);
  if (options.waitUntil) options.waitUntil(caching);
  else await caching;
  return served;
};
