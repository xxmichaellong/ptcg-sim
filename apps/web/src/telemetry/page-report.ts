import type { ClientSessionObserver } from '@ptcgsim/client-session';
import {
  MAX_PAGE_ERROR_CODE_UNITS,
  MAX_PAGE_REPORTS,
  PAGE_REPORT_PATH,
  PAGE_REPORT_VERSION,
  type PageLanding,
  type PageReport,
  type PageTable,
} from '@ptcgsim/protocol';

/**
 * The page's report of its own visit (ADR-054): how fast it loaded and
 * answered, how its game went and what went wrong. It is sent to the Worker
 * each time the page is put away (hidden, or closed), at most
 * `MAX_PAGE_REPORTS` times, and costs nothing until then: the measures are
 * the browser's own (navigation and paint timing, layout shifts, event
 * timing) and a few counters the session bumps.
 *
 * It names no one. A player is counted by a date this module keeps for
 * itself in local storage, the UTC day of the last visit; the report only
 * says whether this is the first visit today, this week or this month.
 */

/** Where the visit dates live; nothing else reads them. */
export const VISIT_STORAGE_KEY = 'ptcgsim.visits.v1';

export interface StoredVisits {
  /** The UTC day (YYYY-MM-DD) of the first and the latest visit. */
  readonly first: string;
  readonly last: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

export const utcDay = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

/** The ISO week (Monday first) a UTC day falls in, as `YYYY-Www`. */
export const isoWeek = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  // The week's Thursday decides its year.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${String(date.getUTCFullYear())}-W${String(week).padStart(2, '0')}`;
};

export const readStoredVisits = (
  text: string | null
): StoredVisits | undefined => {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === 'object' &&
      value !== null &&
      'first' in value &&
      'last' in value &&
      typeof value.first === 'string' &&
      typeof value.last === 'string' &&
      DAY_PATTERN.test(value.first) &&
      DAY_PATTERN.test(value.last) &&
      value.first <= value.last
    ) {
      return { first: value.first, last: value.last };
    }
  } catch {
    // Read as no visit before.
  }
  return undefined;
};

/** This visit as the report tells it, and what to store for the next. */
export const visitOf = (
  stored: StoredVisits | undefined,
  now: number
): {
  readonly visit: NonNullable<PageReport['visit']>;
  readonly next: StoredVisits;
} => {
  const today = utcDay(now);
  // A clock set back leaves the stored days alone and counts no new day.
  if (stored && stored.last > today) {
    return {
      visit: { first: false, today: false, week: false, month: false },
      next: stored,
    };
  }
  if (!stored) {
    return {
      visit: { first: true, today: true, week: true, month: true },
      next: { first: today, last: today },
    };
  }
  const daysSince = Math.round(
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(`${stored.last}T00:00:00Z`)) /
      DAY_MS
  );
  return {
    visit: {
      first: false,
      today: stored.last !== today,
      week: isoWeek(stored.last) !== isoWeek(today),
      month: stored.last.slice(0, 7) !== today.slice(0, 7),
      daysSince: Math.min(daysSince, 3650),
    },
    next: { first: stored.first, last: today },
  };
};

/** The median and slowest of some durations, whole milliseconds. */
export const summarizeLatency = (
  samples: readonly number[]
): PageReport['moves'] => {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return {
    median: Math.min(Math.round(median), 600_000),
    max: Math.min(Math.round(sorted.at(-1) ?? 0), 600_000),
    samples: sorted.length,
  };
};

/**
 * Interaction to next paint from each interaction's longest event: the
 * slowest, or past 50 interactions about the 98th percentile (one skipped
 * per 50), as the Core Web Vitals define it.
 */
export const interactionToNextPaint = (
  durations: Iterable<number>
): number | undefined => {
  const sorted = [...durations].sort((left, right) => right - left);
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(Math.floor(sorted.length / 50), sorted.length - 1)];
};

export interface LayoutShift {
  readonly startTime: number;
  readonly value: number;
  readonly hadRecentInput: boolean;
}

/**
 * Cumulative layout shift: the largest session window of shifts (each
 * under a second after the last, five seconds at most) not caused by input.
 */
export const cumulativeLayoutShift = (
  shifts: readonly LayoutShift[]
): number => {
  let largest = 0;
  let windowValue = 0;
  let windowStart = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    if (
      shift.startTime - previous < 1_000 &&
      shift.startTime - windowStart < 5_000
    ) {
      windowValue += shift.value;
    } else {
      windowValue = shift.value;
      windowStart = shift.startTime;
    }
    previous = shift.startTime;
    largest = Math.max(largest, windowValue);
  }
  return Math.round(largest * 10_000) / 10_000;
};

/**
 * An error's kind and first line, without the addresses and numbers that
 * would make each copy of the same fault look different.
 */
export const errorSignature = (error: unknown): string | undefined => {
  let text: string;
  if (error instanceof Error) {
    text = `${error.name}: ${error.message}`;
  } else if (typeof error === 'string') {
    text = error;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    text = error.message;
  } else {
    text = String(error);
  }
  const firstLine = (text.split('\n', 1)[0] ?? '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/giu, '<id>')
    .replace(/\d+/gu, 'N')
    .trim();
  return firstLine === ''
    ? undefined
    : firstLine.slice(0, MAX_PAGE_ERROR_CODE_UNITS);
};

/** Another site's host that linked here, without `www.`. */
export const referrerHost = (
  referrer: string,
  ownHost: string
): string | undefined => {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname
      .toLowerCase()
      .replace(/^www\./u, '');
    if (host === ownHost.toLowerCase().replace(/^www\./u, '')) return undefined;
    return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(host)
      ? host
      : undefined;
  } catch {
    return undefined;
  }
};

export const campaignOf = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get('utm_source');
  return value !== null && /^[\w.-]{1,40}$/u.test(value) ? value : undefined;
};

interface ObservedEntry {
  readonly startTime: number;
  readonly duration: number;
  readonly entryType: string;
  readonly name: string;
  readonly interactionId?: number;
  readonly value?: number;
  readonly hadRecentInput?: boolean;
}

/** What the reporter needs of a page, so a test can be one. */
export interface PageReportEnvironment {
  readonly now: () => number;
  /** Milliseconds since the page was asked for. */
  readonly sincePageStart: () => number;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  readonly send: (path: string, body: string) => void;
  /** Calls back with each entry of a type the browser times, past and future. */
  readonly observe: (
    type: string,
    callback: (entries: readonly ObservedEntry[]) => void
  ) => void;
  readonly navigationResponseStart: () => number | undefined;
  readonly isHidden: () => boolean;
  readonly onVisibilityChange: (listener: () => void) => void;
  readonly onPageHide: (listener: () => void) => void;
  readonly onError: (listener: (error: unknown) => void) => void;
  readonly onInput: (listener: () => void) => void;
  readonly coarsePointer: () => boolean;
  readonly viewport: () => { readonly width: number; readonly height: number };
  readonly language: () => string;
  readonly referrer: string;
  readonly host: string;
  readonly search: string;
}

const MAX_SAMPLES = 1_000;
const pushBounded = (samples: number[], value: number): void => {
  if (!Number.isFinite(value) || value < 0) return;
  if (samples.length >= MAX_SAMPLES) samples.shift();
  samples.push(value);
};

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u;

export class PageReporter {
  private readonly visit: PageReport['visit'];
  private sequence = 0;
  private visibleSince: number | undefined;
  private visibleMs = 0;
  /** Hidden when it loaded: it painted for no one, so no load timings. */
  private readonly wasHidden: boolean;
  /** Hidden at some point: a table seen after that waited on the player. */
  private everHidden: boolean;
  /** A report went while hidden: `pagehide` after it has nothing new. */
  private reportedWhileHidden = false;
  private table: PageTable = 'none';
  private tableMs: number | undefined;
  private ttfb: number | undefined;
  private fcp: number | undefined;
  private lcp: number | undefined;
  private lcpFinal = false;
  private readonly shifts: LayoutShift[] = [];
  private readonly interactions = new Map<number, number>();
  private readonly heartbeats: number[] = [];
  private readonly moves: number[] = [];
  private reconnects = 0;
  private errors = 0;
  private error: string | undefined;
  /** Timings once reported are not repeated. */
  private readonly sent = new Set<keyof PageReport['timings']>();

  constructor(
    private readonly landing: PageLanding,
    private readonly environment: PageReportEnvironment
  ) {
    this.visit = this.readVisit();
    this.wasHidden = environment.isHidden();
    this.everHidden = this.wasHidden;
    if (!this.wasHidden) this.visibleSince = environment.now();
    this.ttfb = environment.navigationResponseStart();
    environment.observe('paint', (entries) => {
      for (const entry of entries)
        if (entry.name === 'first-contentful-paint')
          this.fcp ??= entry.startTime;
    });
    environment.observe('largest-contentful-paint', (entries) => {
      if (this.lcpFinal) return;
      const last = entries.at(-1);
      if (last) this.lcp = last.startTime;
    });
    environment.observe('layout-shift', (entries) => {
      for (const entry of entries) {
        this.shifts.push({
          startTime: entry.startTime,
          value: entry.value ?? 0,
          hadRecentInput: entry.hadRecentInput ?? false,
        });
      }
      if (this.shifts.length > 500)
        this.shifts.splice(0, this.shifts.length - 500);
    });
    const interaction = (entries: readonly ObservedEntry[]): void => {
      for (const entry of entries) {
        const id = entry.interactionId ?? 0;
        if (id <= 0) continue;
        this.interactions.set(
          id,
          Math.max(this.interactions.get(id) ?? 0, entry.duration)
        );
      }
      if (this.interactions.size > 2_000) {
        const oldest = this.interactions.keys().next().value;
        if (oldest !== undefined) this.interactions.delete(oldest);
      }
    };
    environment.observe('event', interaction);
    environment.observe('first-input', interaction);
    // The largest paint is the one before the player first acts.
    environment.onInput(() => {
      this.lcpFinal = true;
    });
    environment.onError((error) => {
      this.errors += 1;
      this.error ??= errorSignature(error);
    });
    environment.onVisibilityChange(() => {
      if (environment.isHidden()) {
        this.everHidden = true;
        this.report();
      } else {
        this.reportedWhileHidden = false;
        this.visibleSince ??= environment.now();
      }
    });
    // Closing a visible page (a reload, a link away) hides it first in
    // current browsers; this catches the ones that don't.
    environment.onPageHide(() => {
      if (!this.reportedWhileHidden) this.report();
    });
  }

  /** The table a room shows now; `none` once it is left. */
  tableIs(table: PageTable): void {
    this.table = table;
  }

  /** The loading screen lifted off the table, the first time. */
  tableShown(): void {
    if (this.tableMs !== undefined || this.everHidden) return;
    this.tableMs = this.environment.sincePageStart();
  }

  heartbeat(ms: number): void {
    pushBounded(this.heartbeats, ms);
  }

  moveAnswered(ms: number): void {
    pushBounded(this.moves, ms);
  }

  reconnecting(): void {
    this.reconnects += 1;
  }

  /** This report's body; counters it carries start again. */
  takeReport(): PageReport | undefined {
    if (this.sequence >= MAX_PAGE_REPORTS) return undefined;
    const now = this.environment.now();
    if (this.visibleSince !== undefined) {
      this.visibleMs += now - this.visibleSince;
      this.visibleSince = this.environment.isHidden() ? undefined : now;
    }
    this.lcpFinal = true;
    const timings: PageReport['timings'] = {};
    const timing = <Key extends keyof PageReport['timings']>(
      key: Key,
      value: number | undefined
    ): void => {
      if (value === undefined || this.sent.has(key) || !Number.isFinite(value))
        return;
      if (value < 0 || value > 600_000) return;
      timings[key] = Math.round(value * 10) / 10;
      this.sent.add(key);
    };
    // A page that started hidden never painted for anyone: no load timings.
    if (!this.wasHidden) {
      timing('ttfb', this.ttfb);
      timing('fcp', this.fcp);
      timing('lcp', this.lcp);
    }
    timing('table', this.tableMs);
    // Responsiveness and stability are the whole visit's, so they wait for
    // the last report the page might send: each report carries them so far.
    const inp = interactionToNextPaint(this.interactions.values());
    if (inp !== undefined) timings.inp = Math.min(Math.round(inp), 600_000);
    if (!this.wasHidden || this.shifts.length > 0)
      timings.cls = Math.min(cumulativeLayoutShift(this.shifts), 100);
    const { width, height } = this.environment.viewport();
    const language = this.environment.language();
    const referrer = referrerHost(
      this.environment.referrer,
      this.environment.host
    );
    const campaign = campaignOf(this.environment.search);
    const heartbeat = summarizeLatency(this.heartbeats);
    const moves = summarizeLatency(this.moves);
    const report: PageReport = {
      type: 'PageReport',
      version: PAGE_REPORT_VERSION,
      sequence: this.sequence,
      landing: this.landing,
      ...(this.sequence === 0 && this.visit ? { visit: this.visit } : {}),
      timings,
      ...(heartbeat ? { heartbeat } : {}),
      ...(moves ? { moves } : {}),
      table: this.table,
      visibleMs: Math.min(Math.max(Math.round(this.visibleMs), 0), 86_400_000),
      reconnects: Math.min(this.reconnects, 1_000),
      errors: Math.min(this.errors, 1_000),
      ...(this.error ? { error: this.error } : {}),
      pointer: this.environment.coarsePointer() ? 'coarse' : 'fine',
      width: Math.min(Math.max(Math.round(width), 0), 100_000),
      height: Math.min(Math.max(Math.round(height), 0), 100_000),
      language: LANGUAGE_PATTERN.test(language) ? language : 'und',
      ...(this.sequence === 0 && referrer ? { referrer } : {}),
      ...(this.sequence === 0 && campaign ? { campaign } : {}),
    };
    this.sequence += 1;
    this.visibleMs = 0;
    this.heartbeats.length = 0;
    this.moves.length = 0;
    this.reconnects = 0;
    this.errors = 0;
    this.error = undefined;
    return report;
  }

  private report(): void {
    const report = this.takeReport();
    if (!report) return;
    if (this.environment.isHidden()) this.reportedWhileHidden = true;
    try {
      this.environment.send(PAGE_REPORT_PATH, JSON.stringify(report));
    } catch {
      // A report that can't be sent is lost, never a fault of the page.
    }
  }

  private readVisit(): PageReport['visit'] {
    const storage = this.environment.storage;
    if (!storage) return undefined;
    try {
      const { visit, next } = visitOf(
        readStoredVisits(storage.getItem(VISIT_STORAGE_KEY)),
        this.environment.now()
      );
      storage.setItem(VISIT_STORAGE_KEY, JSON.stringify(next));
      return visit;
    } catch {
      // Storage refused: the visit can't be placed, so it isn't counted.
      return undefined;
    }
  }
}

let installed: PageReporter | undefined;

/** The page's reporter, if `installPageReport` ran. */
export const pageReporter = (): PageReporter | undefined => installed;

/** What a room's session tells the page's report, if there is one. */
export const pageReportSessionObserver: ClientSessionObserver = Object.freeze({
  heartbeat: (ms: number) => installed?.heartbeat(ms),
  moveAnswered: (ms: number) => installed?.moveAnswered(ms),
  reconnecting: () => installed?.reconnecting(),
});

const browserEnvironment = (): PageReportEnvironment => {
  const { document, navigator, location } = globalThis;
  let storage: PageReportEnvironment['storage'];
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    now: () => Date.now(),
    sincePageStart: () => performance.now(),
    storage,
    send: (path, body) => {
      if (typeof navigator.sendBeacon === 'function') {
        if (navigator.sendBeacon(path, body)) return;
      }
      void fetch(path, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
      }).catch(() => undefined);
    },
    observe: (type, callback) => {
      if (
        typeof PerformanceObserver === 'undefined' ||
        !PerformanceObserver.supportedEntryTypes.includes(type)
      )
        return;
      try {
        new PerformanceObserver((list) => {
          callback(list.getEntries() as unknown as readonly ObservedEntry[]);
        }).observe({
          type,
          buffered: true,
          ...(type === 'event' ? { durationThreshold: 16 } : {}),
        } as PerformanceObserverInit);
      } catch {
        // An entry type this browser lists but won't observe: not timed.
      }
    },
    navigationResponseStart: () => {
      const [navigation] = performance.getEntriesByType(
        'navigation'
      ) as PerformanceNavigationTiming[];
      return navigation && navigation.responseStart > 0
        ? navigation.responseStart
        : undefined;
    },
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange: (listener) =>
      document.addEventListener('visibilitychange', listener),
    onPageHide: (listener) => globalThis.addEventListener('pagehide', listener),
    onError: (listener) => {
      globalThis.addEventListener('error', (event) =>
        listener(event.error ?? event.message)
      );
      globalThis.addEventListener('unhandledrejection', (event) =>
        listener(event.reason)
      );
    },
    onInput: (listener) => {
      for (const type of ['keydown', 'pointerdown'] as const)
        globalThis.addEventListener(type, listener, {
          once: true,
          capture: true,
          passive: true,
        });
    },
    coarsePointer: () => globalThis.matchMedia('(pointer: coarse)').matches,
    viewport: () => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    }),
    language: () => document.documentElement.lang || 'und',
    referrer: document.referrer,
    host: location.host,
    search: location.search,
  };
};

/** Starts this page's report; a second call keeps the first. */
export const installPageReport = (
  landing: PageLanding,
  environment: PageReportEnvironment = browserEnvironment()
): PageReporter => {
  installed ??= new PageReporter(landing, environment);
  return installed;
};
