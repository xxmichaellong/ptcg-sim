import { parsePageReport, type PageReport } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  campaignOf,
  cumulativeLayoutShift,
  errorSignature,
  interactionToNextPaint,
  isoWeek,
  PageReporter,
  readStoredVisits,
  referrerHost,
  summarizeLatency,
  VISIT_STORAGE_KEY,
  visitOf,
  type PageReportEnvironment,
} from './page-report.js';

const DAY = 86_400_000;
const at = (iso: string): number => Date.parse(iso);

describe('visits', () => {
  it('counts a first visit, a second the same day, and returns later', () => {
    const first = visitOf(undefined, at('2026-11-11T10:00:00Z'));
    expect(first.visit).toEqual({
      first: true,
      today: true,
      week: true,
      month: true,
    });
    expect(first.next).toEqual({ first: '2026-11-11', last: '2026-11-11' });

    const again = visitOf(first.next, at('2026-11-11T23:00:00Z'));
    expect(again.visit).toEqual({
      first: false,
      today: false,
      week: false,
      month: false,
      daysSince: 0,
    });

    // Wednesday to the next Monday: a new day and ISO week, the same month.
    const nextWeek = visitOf(first.next, at('2026-11-16T01:00:00Z'));
    expect(nextWeek.visit).toEqual({
      first: false,
      today: true,
      week: true,
      month: false,
      daysSince: 5,
    });
    expect(nextWeek.next).toEqual({ first: '2026-11-11', last: '2026-11-16' });

    // Saturday the 31st to Sunday the 1st: a new month in the same week.
    const newMonth = visitOf(
      { first: '2026-10-01', last: '2026-10-31' },
      at('2026-11-01T12:00:00Z')
    );
    expect(newMonth.visit).toMatchObject({
      today: true,
      week: false,
      month: true,
    });
  });

  it('counts nothing new for a clock set back', () => {
    const stored = { first: '2026-11-01', last: '2026-11-20' };
    expect(visitOf(stored, at('2026-11-11T00:00:00Z'))).toEqual({
      visit: { first: false, today: false, week: false, month: false },
      next: stored,
    });
  });

  it('reads only well-formed stored days', () => {
    expect(
      readStoredVisits('{"first":"2026-11-01","last":"2026-11-02"}')
    ).toEqual({
      first: '2026-11-01',
      last: '2026-11-02',
    });
    for (const text of [
      null,
      '',
      'nope',
      '{"first":"2026-11-03","last":"2026-11-02"}',
      '{"first":"yesterday","last":"2026-11-02"}',
      '[]',
    ])
      expect(readStoredVisits(text)).toBeUndefined();
  });

  it('numbers ISO weeks across a year end', () => {
    expect(isoWeek('2026-11-11')).toBe('2026-W46');
    expect(isoWeek('2026-12-31')).toBe('2026-W53');
    expect(isoWeek('2027-01-03')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
  });
});

describe('measures', () => {
  it('summarizes latencies as median, slowest and count', () => {
    expect(summarizeLatency([])).toBeUndefined();
    expect(summarizeLatency([30, 10, 20])).toEqual({
      median: 20,
      max: 30,
      samples: 3,
    });
    expect(summarizeLatency([10, 20, 30, 41])).toEqual({
      median: 25,
      max: 41,
      samples: 4,
    });
  });

  it('takes the slowest interaction, or about the 98th percentile past 50', () => {
    expect(interactionToNextPaint([])).toBeUndefined();
    expect(interactionToNextPaint([40, 300, 120])).toBe(300);
    const many = Array.from({ length: 120 }, (_, index) => index + 1);
    // Two skipped for 120 interactions.
    expect(interactionToNextPaint(many)).toBe(118);
  });

  it('keeps the worst window of layout shifts not caused by input', () => {
    expect(cumulativeLayoutShift([])).toBe(0);
    expect(
      cumulativeLayoutShift([
        { startTime: 100, value: 0.1, hadRecentInput: false },
        { startTime: 600, value: 0.05, hadRecentInput: false },
        { startTime: 700, value: 0.5, hadRecentInput: true },
        // More than a second after the last: a new window.
        { startTime: 3_000, value: 0.12, hadRecentInput: false },
      ])
    ).toBe(0.15);
  });

  it('names an error by kind and first line, without what makes copies differ', () => {
    expect(
      errorSignature(new TypeError("Cannot read 'x' of undefined\n  at f"))
    ).toBe("TypeError: Cannot read 'x' of undefined");
    expect(
      errorSignature(
        new Error(
          'Failed to fetch https://beta.ptcgsim.online/v2/rooms/ABCDEF234567 after 3 tries'
        )
      )
    ).toBe('Error: Failed to fetch <url> after N tries');
    expect(errorSignature('chunk 0a1b2c3d4e5f6a7b failed')).toBe(
      'chunk <id> failed'
    );
    expect(errorSignature({ message: 'plain object' })).toBe('plain object');
    expect(errorSignature('')).toBeUndefined();
    expect(errorSignature('x'.repeat(400))).toHaveLength(160);
  });

  it('keeps another site that linked here, and a campaign', () => {
    expect(
      referrerHost('https://www.reddit.com/r/ptcg', 'beta.ptcgsim.online')
    ).toBe('reddit.com');
    expect(referrerHost('https://ptcgsim.online/', 'beta.ptcgsim.online')).toBe(
      'ptcgsim.online'
    );
    expect(
      referrerHost('https://beta.ptcgsim.online/?x=1', 'beta.ptcgsim.online')
    ).toBeUndefined();
    expect(referrerHost('', 'beta.ptcgsim.online')).toBeUndefined();
    expect(referrerHost('not a url', 'x')).toBeUndefined();
    expect(campaignOf('?utm_source=discord&x=1')).toBe('discord');
    expect(campaignOf('?utm_source=<script>')).toBeUndefined();
  });
});

/** A page the test drives: its clock, visibility, storage and sends. */
const fakePage = (options: { hidden?: boolean; storage?: boolean } = {}) => {
  let now = at('2026-11-11T12:00:00Z');
  let sincePageStart = 0;
  let hidden = options.hidden ?? false;
  const sent: PageReport[] = [];
  const stored = new Map<string, string>();
  const observers = new Map<string, (entries: readonly never[]) => void>();
  const visibility: (() => void)[] = [];
  const pageHide: (() => void)[] = [];
  const errors: ((error: unknown) => void)[] = [];
  const inputs: (() => void)[] = [];
  const environment: PageReportEnvironment = {
    now: () => now,
    sincePageStart: () => sincePageStart,
    storage:
      options.storage === false
        ? undefined
        : {
            getItem: (key) => stored.get(key) ?? null,
            setItem: (key, value) => void stored.set(key, value),
          },
    send: (path, body) => {
      expect(path).toBe('/v2/beacon');
      const report = parsePageReport(body);
      expect(report, body).toBeDefined();
      sent.push(report!);
    },
    observe: (type, callback) => observers.set(type, callback as never),
    navigationResponseStart: () => 180,
    isHidden: () => hidden,
    onVisibilityChange: (listener) => visibility.push(listener),
    onPageHide: (listener) => pageHide.push(listener),
    onError: (listener) => errors.push(listener),
    onInput: (listener) => inputs.push(listener),
    coarsePointer: () => false,
    viewport: () => ({ width: 1280, height: 720 }),
    language: () => 'de',
    referrer: 'https://ptcgsim.online/',
    host: 'beta.ptcgsim.online',
    search: '?utm_source=newsletter',
  };
  return {
    environment,
    sent,
    stored,
    entries: (type: string, entries: readonly object[]) =>
      observers.get(type)?.(entries as never),
    advance: (ms: number) => {
      now += ms;
      sincePageStart += ms;
    },
    hide: () => {
      hidden = true;
      for (const listener of visibility) listener();
    },
    show: () => {
      hidden = false;
      for (const listener of visibility) listener();
    },
    close: () => {
      for (const listener of pageHide) listener();
    },
    fail: (error: unknown) => {
      for (const listener of errors) listener(error);
    },
    input: () => {
      for (const listener of inputs) listener();
    },
  };
};

describe('PageReporter', () => {
  it("sends the visit's load, game and errors when hidden, and only news after", () => {
    const page = fakePage();
    const reporter = new PageReporter('invite', page.environment);
    page.entries('paint', [{ name: 'first-contentful-paint', startTime: 240 }]);
    page.entries('largest-contentful-paint', [
      { startTime: 400 },
      { startTime: 900 },
    ]);
    page.advance(2_500);
    reporter.tableIs('multiplayer');
    reporter.tableShown();
    page.input();
    // Painted after the player acted: not the largest contentful paint.
    page.entries('largest-contentful-paint', [{ startTime: 5_000 }]);
    page.entries('event', [
      { interactionId: 7, duration: 64, startTime: 3_000 },
      { interactionId: 7, duration: 96, startTime: 3_000 },
      { interactionId: 0, duration: 400, startTime: 3_100 },
    ]);
    reporter.heartbeat(40);
    reporter.heartbeat(60);
    reporter.moveAnswered(80);
    reporter.reconnecting();
    page.fail(new RangeError('Invalid array length 12'));
    page.fail(new Error('second'));
    page.advance(60_000);
    page.hide();
    // Closing the hidden page sends nothing more.
    page.close();
    expect(page.sent).toHaveLength(1);
    expect(page.sent[0]).toEqual<PageReport>({
      type: 'PageReport',
      version: 1,
      sequence: 0,
      landing: 'invite',
      visit: { first: true, today: true, week: true, month: true },
      timings: { ttfb: 180, fcp: 240, lcp: 900, table: 2_500, inp: 96, cls: 0 },
      heartbeat: { median: 50, max: 60, samples: 2 },
      moves: { median: 80, max: 80, samples: 1 },
      table: 'multiplayer',
      visibleMs: 62_500,
      reconnects: 1,
      errors: 2,
      error: 'RangeError: Invalid array length N',
      pointer: 'fine',
      width: 1280,
      height: 720,
      language: 'de',
      referrer: 'ptcgsim.online',
      campaign: 'newsletter',
    });
    expect(JSON.parse(page.stored.get(VISIT_STORAGE_KEY)!)).toEqual({
      first: '2026-11-11',
      last: '2026-11-11',
    });

    page.show();
    page.advance(10_000);
    reporter.tableIs('none');
    page.hide();
    expect(page.sent).toHaveLength(2);
    expect(page.sent[1]).toEqual<PageReport>({
      type: 'PageReport',
      version: 1,
      sequence: 1,
      landing: 'invite',
      timings: { inp: 96, cls: 0 },
      table: 'none',
      visibleMs: 10_000,
      reconnects: 0,
      errors: 0,
      pointer: 'fine',
      width: 1280,
      height: 720,
      language: 'de',
    });
  });

  it('times no load for a page opened in the background, nor a table seen after a hide', () => {
    const page = fakePage({ hidden: true });
    const reporter = new PageReporter('solo', page.environment);
    page.advance(5_000);
    page.show();
    reporter.tableShown();
    page.advance(1_000);
    page.hide();
    expect(page.sent[0]?.timings).toEqual({});
    expect(page.sent[0]?.visibleMs).toBe(1_000);
  });

  it('reports a page closed while visible, once', () => {
    const page = fakePage();
    new PageReporter('lobby', page.environment);
    page.advance(3_000);
    page.close();
    expect(page.sent.map((report) => report.sequence)).toEqual([0]);
  });

  it('counts no visit without storage, and stops after the last report', () => {
    const page = fakePage({ storage: false });
    new PageReporter('room_code', page.environment);
    for (let index = 0; index < 20; index += 1) {
      page.hide();
      page.show();
    }
    expect(page.sent).toHaveLength(12);
    expect(page.sent[0]?.visit).toBeUndefined();
    expect(page.sent.at(-1)?.sequence).toBe(11);
  });

  it('never fails the page when a report cannot be sent', () => {
    const page = fakePage();
    const reporter = new PageReporter('solo', {
      ...page.environment,
      send: () => {
        throw new Error('no network');
      },
    });
    expect(() => page.hide()).not.toThrow();
    expect(reporter.takeReport()?.sequence).toBe(1);
  });

  it('starts every visit as a later one once the day is stored', () => {
    const page = fakePage();
    page.stored.set(
      VISIT_STORAGE_KEY,
      JSON.stringify({ first: '2026-10-01', last: '2026-11-10' })
    );
    new PageReporter('solo', page.environment);
    page.advance(DAY / 24);
    page.hide();
    expect(page.sent[0]?.visit).toEqual({
      first: false,
      today: true,
      week: false,
      month: false,
      daysSince: 1,
    });
  });
});
