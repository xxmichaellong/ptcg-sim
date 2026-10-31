import { browserJsonResponse as json } from './browser-json-http.js';
import type { CurrentDeckFeed } from './current-decks.js';

export const CURRENT_DECKS_PATH = '/v2/decks/current';

/** The lists change once a day; a quarter of an hour of staleness is fine. */
const CACHE_SECONDS = 900;

const CACHEABLE_HEADERS = {
  'Cache-Control': `public, max-age=${String(CACHE_SECONDS)}`,
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * `GET /v2/decks/current`: the deck picker's current lists, credited to
 * their source. `{ available: false }` while none have been fetched yet,
 * so the picker keeps its built-in lists. The browser may keep a copy for a
 * quarter of an hour.
 */
export const handleCurrentDecksRequest = async (
  request: Request,
  readFeed: () => Promise<CurrentDeckFeed | null>
): Promise<Response> => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  if (new URL(request.url).search) {
    return json({ error: 'invalid_request' }, 400);
  }
  const feed = await readFeed();
  // No lists yet is the feed's state, not a server failure: a 200 the
  // picker reads, which browsers don't log as an error.
  if (!feed) {
    return json({ available: false }, 200);
  }
  return Response.json(
    {
      source: 'Limitless TCG',
      sourceUrl: 'https://play.limitlesstcg.com',
      fetchedAt: feed.fetchedAt,
      groups: feed.groups,
    },
    { status: 200, headers: CACHEABLE_HEADERS }
  );
};
