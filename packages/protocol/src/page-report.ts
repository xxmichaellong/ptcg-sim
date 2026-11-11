import * as v from 'valibot';

/**
 * A page's report of its own visit (ADR-054): how fast it loaded, how its
 * game went and what went wrong, sent to the Worker when the page is put
 * away. The Worker adds the country and browser family and keeps it in the
 * site's analytics, where the internal dashboard (apps/ops) reads it.
 *
 * It names no one. There is no identifier, cookie or address in it: a
 * player is counted by a date the page keeps for itself (the day of its
 * last visit), sent only as "first visit today / this week / this month".
 */
export const PAGE_REPORT_PATH = '/v2/beacon';
export const PAGE_REPORT_VERSION = 1;
/** One report's JSON, at most. */
export const MAX_PAGE_REPORT_CODE_UNITS = 4 * 1024;
/** Reports one page sends at most: the first, then each return and hide. */
export const MAX_PAGE_REPORTS = 12;
/** An error's signature: its kind and first line, without addresses. */
export const MAX_PAGE_ERROR_CODE_UNITS = 160;

/**
 * How the visit began: on the Solo table (the site's front page), on Play
 * online (`?room-lobby=1`), from an invite link, or from a room code link.
 */
export const PAGE_LANDINGS = ['solo', 'lobby', 'invite', 'room_code'] as const;
export type PageLanding = (typeof PAGE_LANDINGS)[number];

/** The table a page shows when it reports. */
export const PAGE_TABLES = ['none', 'solo', 'multiplayer'] as const;
export type PageTable = (typeof PAGE_TABLES)[number];

const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_VISIBLE_MS = 24 * 60 * 60 * 1000;

const count = (maximum: number) =>
  v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(maximum));
const milliseconds = (maximum = MAX_DURATION_MS) =>
  v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(maximum));

const PageVisitSchema = v.strictObject({
  /** No visit before this one on this browser. */
  first: v.boolean(),
  /** The first visit on this UTC day, ISO week and month. */
  today: v.boolean(),
  week: v.boolean(),
  month: v.boolean(),
  /** Whole UTC days since the visit before; absent on a first visit. */
  daysSince: v.optional(count(3650)),
});

const PageTimingsSchema = v.strictObject({
  /** The document's first byte. */
  ttfb: v.optional(milliseconds()),
  /** First and largest contentful paint (the loading screen, usually). */
  fcp: v.optional(milliseconds()),
  lcp: v.optional(milliseconds()),
  /** The table seen: the loading screen lifted off it. */
  table: v.optional(milliseconds()),
  /** Interaction to next paint: the slowest answer to a tap or key. */
  inp: v.optional(milliseconds()),
  /** Cumulative layout shift (unitless). */
  cls: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))
  ),
});

const PageLatencySchema = v.strictObject({
  /** The median and slowest of the samples since the last report. */
  median: milliseconds(),
  max: milliseconds(),
  samples: count(100_000),
});

export const PageReportSchema = v.strictObject({
  type: v.literal('PageReport'),
  version: v.literal(PAGE_REPORT_VERSION),
  /** 0 for the page's first report, then 1, 2... */
  sequence: count(MAX_PAGE_REPORTS - 1),
  landing: v.picklist(PAGE_LANDINGS),
  /** Only on the first report. */
  visit: v.optional(PageVisitSchema),
  /** Each as soon as it is known; later reports repeat none. */
  timings: PageTimingsSchema,
  /** A quiet connection's heartbeat round trip. */
  heartbeat: v.optional(PageLatencySchema),
  /** A move sent until the room answered it. */
  moves: v.optional(PageLatencySchema),
  table: v.picklist(PAGE_TABLES),
  /** Since the last report: time on screen, reconnects and errors. */
  visibleMs: milliseconds(MAX_VISIBLE_MS),
  reconnects: count(1_000),
  errors: count(1_000),
  error: v.optional(
    v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_PAGE_ERROR_CODE_UNITS))
  ),
  pointer: v.picklist(['coarse', 'fine']),
  /** The window's CSS size. */
  width: count(100_000),
  height: count(100_000),
  /** The interface's language (a locale tag). */
  language: v.pipe(v.string(), v.regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u)),
  /** The site that linked here, by host name, if another. */
  referrer: v.optional(
    v.pipe(v.string(), v.regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u))
  ),
  /** `utm_source`, if the link carried one. */
  campaign: v.optional(v.pipe(v.string(), v.regex(/^[\w.-]{1,40}$/u))),
});
export type PageReport = v.InferOutput<typeof PageReportSchema>;

/** One report, from its parsed JSON; undefined unless it is exactly one. */
export const readPageReport = (value: unknown): PageReport | undefined => {
  const parsed = v.safeParse(PageReportSchema, value);
  return parsed.success ? parsed.output : undefined;
};

/** Reads one report's text; undefined unless it is exactly one. */
export const parsePageReport = (text: string): PageReport | undefined => {
  if (text.length > MAX_PAGE_REPORT_CODE_UNITS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return readPageReport(value);
};
