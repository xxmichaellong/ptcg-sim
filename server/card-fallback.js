import { buildPokemonTcgQuery } from '../client/src/setup/deck-builder/core/pokemon-tcg-query.mjs';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_DAILY_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 6000;
const DEFAULT_MAX_RATE_LIMIT_BUCKETS = 10_000;
const MAX_TERM_LENGTH = 120;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function consumeFixedWindowLimit(buckets, key, maximum, windowMs, now) {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maximum) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000)
      ),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function ensureRateLimitBucketCapacity(buckets, key, maxEntries) {
  if (!buckets.has(key) && buckets.size >= maxEntries) {
    buckets.delete(buckets.keys().next().value);
  }
}

function setHeader(res, name, value) {
  if (typeof res.set === 'function') res.set(name, value);
  else res.setHeader(name, value);
}

function sendRateLimitResponse(res, retryAfterSeconds) {
  setHeader(res, 'Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ error: 'Card fallback rate limit exceeded' });
}

export function createCardFallbackHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = options.apiKey || '';
  const now = options.now || Date.now;
  const cacheTtlMs = positiveNumber(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
  const cacheMaxEntries = positiveNumber(
    options.cacheMaxEntries,
    DEFAULT_CACHE_MAX_ENTRIES
  );
  const rateLimitWindowMs = positiveNumber(
    options.rateLimitWindowMs,
    DEFAULT_RATE_LIMIT_WINDOW_MS
  );
  const perIpRateLimitMax = positiveNumber(options.perIpRateLimitMax, 20);
  const globalRateLimitMax = positiveNumber(
    options.globalRateLimitMax,
    apiKey ? 120 : 25
  );
  const globalDailyRateLimitMax = positiveNumber(
    options.globalDailyRateLimitMax,
    apiKey ? 18_000 : 900
  );
  const maxRateLimitBuckets = positiveNumber(
    options.maxRateLimitBuckets,
    DEFAULT_MAX_RATE_LIMIT_BUCKETS
  );
  const upstreamTimeoutMs = positiveNumber(
    options.upstreamTimeoutMs,
    DEFAULT_UPSTREAM_TIMEOUT_MS
  );

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for card fallback');
  }

  const cache = new Map();
  const perIpBuckets = new Map();
  const globalMinuteBuckets = new Map();
  const globalDailyBuckets = new Map();

  return async function cardFallbackHandler(req, res) {
    if (typeof req.query.term !== 'string') {
      return res
        .status(400)
        .json({ error: 'Query parameter "term" is required' });
    }

    const term = req.query.term.trim().replace(/\s+/g, ' ');
    if (!term || term.length > MAX_TERM_LENGTH) {
      return res.status(400).json({ error: 'Invalid card search term' });
    }

    const currentTime = now();
    const requestIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    ensureRateLimitBucketCapacity(perIpBuckets, requestIp, maxRateLimitBuckets);
    const perIpLimit = consumeFixedWindowLimit(
      perIpBuckets,
      requestIp,
      perIpRateLimitMax,
      rateLimitWindowMs,
      currentTime
    );
    if (!perIpLimit.allowed) {
      return sendRateLimitResponse(res, perIpLimit.retryAfterSeconds);
    }

    const cacheKey = term.toLocaleLowerCase('en');
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > currentTime) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      setHeader(
        res,
        'Cache-Control',
        `public, max-age=${Math.floor(cacheTtlMs / 1000)}`
      );
      setHeader(res, 'X-Card-Fallback-Cache', 'HIT');
      return res.json(cached.payload);
    }
    if (cached) cache.delete(cacheKey);

    const globalLimit = consumeFixedWindowLimit(
      globalMinuteBuckets,
      'global',
      globalRateLimitMax,
      rateLimitWindowMs,
      currentTime
    );
    if (!globalLimit.allowed) {
      return sendRateLimitResponse(res, globalLimit.retryAfterSeconds);
    }

    const globalDailyLimit = consumeFixedWindowLimit(
      globalDailyBuckets,
      'global',
      globalDailyRateLimitMax,
      DEFAULT_DAILY_RATE_LIMIT_WINDOW_MS,
      currentTime
    );
    if (!globalDailyLimit.allowed) {
      return sendRateLimitResponse(res, globalDailyLimit.retryAfterSeconds);
    }

    const upstreamUrl = new URL('https://api.pokemontcg.io/v2/cards');
    upstreamUrl.searchParams.set('q', buildPokemonTcgQuery(term));
    upstreamUrl.searchParams.set('pageSize', '150');
    upstreamUrl.searchParams.set('orderBy', '-set.releaseDate');
    upstreamUrl.searchParams.set(
      'select',
      'id,name,supertype,subtypes,number,rarity,set,images'
    );

    const headers = { Accept: 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const controller = new AbortController();
    let timedOut = false;
    let clientDisconnected = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Fallback provider timed out'));
    }, upstreamTimeoutMs);
    const abortOnClose = () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        controller.abort(new Error('Fallback client disconnected'));
      }
    };
    res.once('close', abortOnClose);

    try {
      let upstream;
      try {
        upstream = await fetchImpl(upstreamUrl.toString(), {
          headers,
          signal: controller.signal,
        });
      } catch {
        if (clientDisconnected || res.destroyed || res.writableEnded) return;
        return res
          .status(timedOut ? 504 : 502)
          .json({ error: 'Fallback provider unavailable' });
      }

      if (clientDisconnected) return;

      if (!upstream.ok) {
        return res
          .status(502)
          .json({ error: `Fallback provider error (${upstream.status})` });
      }

      let payload;
      try {
        payload = await upstream.json();
      } catch {
        if (clientDisconnected || res.destroyed || res.writableEnded) return;
        return res.status(timedOut ? 504 : 502).json({
          error: timedOut
            ? 'Fallback provider unavailable'
            : 'Fallback provider returned invalid JSON',
        });
      }

      if (clientDisconnected) return;

      if (!Array.isArray(payload?.data)) {
        return res
          .status(502)
          .json({ error: 'Fallback provider returned invalid data' });
      }

      cache.set(cacheKey, { payload, expiresAt: currentTime + cacheTtlMs });
      while (cache.size > cacheMaxEntries) {
        cache.delete(cache.keys().next().value);
      }

      setHeader(
        res,
        'Cache-Control',
        `public, max-age=${Math.floor(cacheTtlMs / 1000)}`
      );
      setHeader(res, 'X-Card-Fallback-Cache', 'MISS');
      return res.json(payload);
    } finally {
      clearTimeout(timer);
      res.off('close', abortOnClose);
    }
  };
}
