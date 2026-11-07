/**
 * Reading Limitless TCG's public API (https://docs.limitlesstcg.com), shared
 * by the deck picker's current lists (current-decks.ts) and the tournament
 * deck index (deck-index/). Everything read from Limitless is untrusted:
 * responses are size- and time-bounded, and decklists are kept only when
 * every card line is well formed.
 */

export const LIMITLESS_API_ORIGIN = 'https://play.limitlesstcg.com';

/** Names this project to Limitless, as their API docs ask of callers. */
export const LIMITLESS_USER_AGENT =
  'ptcg-sim (+https://github.com/xxmichaellong/ptcg-sim)';

/** A Limitless tournament id: 24 lowercase hex digits. */
export const LIMITLESS_TOURNAMENT_ID = /^[a-f0-9]{24}$/u;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A line break or other control character, which no name holds. */
export const hasControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
};

/** A bounded, single-line name with something in it, trimmed; else null. */
export const boundedName = (value: unknown, maximum: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum && !hasControl(trimmed)
    ? trimmed
    : null;
};

export type LimitlessErrorCode =
  'request_failed' | 'invalid_response' | 'rate_limited' | 'not_found';

export class LimitlessRequestError extends Error {
  /** For `rate_limited`: how long Limitless asked us to wait, when it said. */
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly code: LimitlessErrorCode,
    options: { readonly cause?: unknown; readonly retryAfterMs?: number } = {}
  ) {
    super(`Limitless request failed: ${code}`, options);
    this.name = 'LimitlessRequestError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Limitless's `ratelimit` header: `"50-in-5min"; r=49; t=300`. */
export interface LimitlessRateLimit {
  /** Requests left in the current window. */
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export const parseLimitlessRateLimit = (
  value: string | null
): LimitlessRateLimit | undefined => {
  if (!value) return undefined;
  const remaining = /(?:^|;)\s*r=(\d{1,6})\s*(?:;|$)/u.exec(value)?.[1];
  const reset = /(?:^|;)\s*t=(\d{1,6})\s*(?:;|$)/u.exec(value)?.[1];
  if (remaining === undefined || reset === undefined) return undefined;
  return { remaining: Number(remaining), resetSeconds: Number(reset) };
};

/** `Retry-After` in seconds (the HTTP-date form is not worth parsing here). */
const retryAfterSeconds = (value: string | null): number | undefined => {
  if (!value || !/^\d{1,6}$/u.test(value.trim())) return undefined;
  return Number(value.trim());
};

export const readBoundedJson = async (
  response: Response,
  maximumBytes: number
): Promise<unknown> => {
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse(await response.text()) as unknown;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LimitlessRequestError('invalid_response');
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(joined)) as unknown;
};

export interface LimitlessFetchOptions {
  readonly fetch: typeof globalThis.fetch;
  /** Raises Limitless's rate limit; optional (a secret binding). */
  readonly apiKey?: string;
  readonly maximumBytes: number;
  readonly timeoutMs: number;
}

export type LimitlessResponse =
  | {
      readonly status: 200;
      readonly body: unknown;
      readonly etag?: string;
      readonly rateLimit?: LimitlessRateLimit;
    }
  | { readonly status: 304; readonly rateLimit?: LimitlessRateLimit };

/**
 * One GET against the API. The deadline covers the body too, and is cleared
 * once the response is read, so no timer outlives the request. A 429 is
 * `rate_limited` (with how long to wait, when Limitless says), a 400 or 404
 * `not_found` (Limitless answers an unknown tournament id with 400), any
 * other failure `request_failed`, and a body that is too big or not JSON
 * `invalid_response`.
 */
export const limitlessGet = async (
  options: LimitlessFetchOptions,
  path: string,
  conditional: { readonly etag?: string } = {}
): Promise<LimitlessResponse> => {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetch(`${LIMITLESS_API_ORIGIN}${path}`, {
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'user-agent': LIMITLESS_USER_AGENT,
          ...(options.apiKey ? { 'X-Access-Key': options.apiKey } : {}),
          ...(conditional.etag ? { 'If-None-Match': conditional.etag } : {}),
        },
        signal: deadline.signal,
      });
    } catch (error) {
      throw new LimitlessRequestError('request_failed', { cause: error });
    }
    const rateLimit = parseLimitlessRateLimit(
      response.headers.get('ratelimit')
    );
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 304, ...(rateLimit ? { rateLimit } : {}) };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) {
        const wait =
          retryAfterSeconds(response.headers.get('retry-after')) ??
          rateLimit?.resetSeconds;
        throw new LimitlessRequestError(
          'rate_limited',
          wait === undefined ? {} : { retryAfterMs: wait * 1000 }
        );
      }
      throw new LimitlessRequestError(
        response.status === 400 || response.status === 404
          ? 'not_found'
          : 'request_failed'
      );
    }
    let body: unknown;
    try {
      body = await readBoundedJson(response, options.maximumBytes);
    } catch (error) {
      if (error instanceof LimitlessRequestError) throw error;
      throw new LimitlessRequestError(
        deadline.signal.aborted ? 'request_failed' : 'invalid_response',
        { cause: error }
      );
    }
    const etag = response.headers.get('etag') ?? undefined;
    return {
      status: 200,
      body,
      ...(etag && etag.length <= 200 ? { etag } : {}),
      ...(rateLimit ? { rateLimit } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
};

const LIST_LIMITS = Object.freeze({
  linesPerSection: 60,
  cardNameCodeUnits: 80,
});

/** A set code or collector number: letters, digits and dashes. */
const CARD_CODE = /^[A-Za-z0-9-]{1,12}$/u;

const cardLine = (value: unknown): { count: number; line: string } | null => {
  if (!isRecord(value)) return null;
  const { count, set, number } = value;
  const name = boundedName(value.name, LIST_LIMITS.cardNameCodeUnits);
  if (
    !Number.isSafeInteger(count) ||
    (count as number) < 1 ||
    (count as number) > 60 ||
    name === null
  ) {
    return null;
  }
  const printing =
    typeof set === 'string' &&
    typeof number === 'string' &&
    CARD_CODE.test(set) &&
    CARD_CODE.test(number)
      ? ` ${set} ${number}`
      : '';
  return {
    count: count as number,
    line: `${String(count)} ${name}${printing}`,
  };
};

const SECTIONS = [
  ['pokemon', 'Pokémon'],
  ['trainer', 'Trainer'],
  ['energy', 'Energy'],
] as const;

/**
 * A Limitless decklist (`{ pokemon, trainer, energy }` of count, name, set,
 * number) as text the deck import reads, or null if it is not a whole
 * 60-card deck with every line well formed.
 */
export const decklistText = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  let total = 0;
  const blocks: string[] = [];
  for (const [key, title] of SECTIONS) {
    const entries = value[key] ?? [];
    if (
      !Array.isArray(entries) ||
      entries.length > LIST_LIMITS.linesPerSection
    ) {
      return null;
    }
    const lines: string[] = [];
    let count = 0;
    for (const entry of entries) {
      const card = cardLine(entry);
      if (!card) return null;
      count += card.count;
      lines.push(card.line);
    }
    total += count;
    if (lines.length > 0)
      blocks.push([`${title} (${count})`, ...lines].join('\n'));
  }
  return total === 60 ? blocks.join('\n\n') : null;
};
