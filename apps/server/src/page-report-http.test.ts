import {
  analyticsColumn,
  type AnalyticsDataPoint,
  type PageReport,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  handlePageReportRequest,
  pageReportDataPoint,
  summarizeUserAgent,
} from './page-report-http.js';

const report: PageReport = {
  type: 'PageReport',
  version: 1,
  sequence: 0,
  landing: 'invite',
  visit: { first: false, today: true, week: false, month: false, daysSince: 3 },
  timings: { ttfb: 120.5, fcp: 300, table: 2400, inp: 88, cls: 0.02 },
  heartbeat: { median: 42, max: 130, samples: 12 },
  moves: { median: 61, max: 240, samples: 30 },
  table: 'multiplayer',
  visibleMs: 600_000,
  reconnects: 1,
  errors: 2,
  error: 'TypeError: x is undefined',
  pointer: 'fine',
  width: 1440,
  height: 900,
  language: 'fr',
  referrer: 'ptcgsim.online',
  campaign: 'discord',
};

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ANDROID_PHONE_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const DISCORD_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/280.0';
const FIREFOX_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const EDGE_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';

const HEADLESS =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36';

const field = (
  point: AnalyticsDataPoint,
  name: Parameters<typeof analyticsColumn<'page'>>[1]
): string | number => {
  const column = analyticsColumn('page', name);
  const index = Number(column.replace(/^\D+/u, '')) - 1;
  return column.startsWith('blob')
    ? (point.blobs[index] ?? '')
    : (point.doubles[index] ?? Number.NaN);
};

const post = (
  body: string,
  headers: Record<string, string> = {},
  method = 'POST'
): Request =>
  new Request('https://beta.example/v2/beacon', {
    method,
    headers: {
      Origin: 'https://beta.example',
      'Content-Type': 'text/plain;charset=UTF-8',
      'User-Agent': CHROME_WINDOWS,
      ...headers,
    },
    ...(method === 'POST' ? { body } : {}),
  });

const allowed = async () => ({ allowed: true, retryAfterSeconds: 60 });

describe('summarizeUserAgent', () => {
  it.each([
    [CHROME_WINDOWS, 'fine', 1440, 900, 'Chrome', 'Windows', 'desktop'],
    [SAFARI_IPHONE, 'coarse', 390, 844, 'Safari', 'iOS', 'mobile'],
    [SAFARI_IPAD_AS_MAC, 'coarse', 1180, 820, 'Safari', 'iPadOS', 'tablet'],
    [SAFARI_IPAD_AS_MAC, 'fine', 1512, 982, 'Safari', 'macOS', 'desktop'],
    [ANDROID_TABLET, 'coarse', 1280, 800, 'Chrome', 'Android', 'tablet'],
    [ANDROID_PHONE_SAMSUNG, 'coarse', 412, 915, 'Samsung Internet', 'Android', 'mobile'],
    [DISCORD_IOS, 'coarse', 390, 844, 'Discord', 'iOS', 'mobile'],
    [FIREFOX_LINUX, 'fine', 1920, 1080, 'Firefox', 'Linux', 'desktop'],
    [EDGE_MAC, 'fine', 1512, 982, 'Edge', 'macOS', 'desktop'],
    [HEADLESS, 'fine', 1280, 800, 'Headless', 'Linux', 'desktop'],
    ['', 'fine', 800, 600, 'Other', 'Other', 'desktop'],
  ] as const)(
    'reads %s as its family',
    (userAgent, pointer, width, height, browser, os, device) => {
      expect(summarizeUserAgent(userAgent, pointer, width, height)).toEqual({
        browser,
        os,
        device,
      });
    }
  );
});

describe('pageReportDataPoint', () => {
  it('places every fact of a report in its column', () => {
    const point = pageReportDataPoint(
      report,
      { build: 'beta-abc', country: 'FR', colo: 'CDG' },
      CHROME_WINDOWS
    );
    expect(point.indexes).toEqual(['page']);
    expect(point.blobs.slice(0, 4)).toEqual(['page', 'beta-abc', 'FR', 'CDG']);
    expect(point.doubles[0]).toBe(1);
    expect(field(point, 'landing')).toBe('invite');
    expect(field(point, 'table')).toBe('multiplayer');
    expect(field(point, 'device')).toBe('desktop');
    expect(field(point, 'browser')).toBe('Chrome');
    expect(field(point, 'os')).toBe('Windows');
    expect(field(point, 'language')).toBe('fr');
    expect(field(point, 'referrer')).toBe('ptcgsim.online');
    expect(field(point, 'campaign')).toBe('discord');
    expect(field(point, 'error')).toBe('TypeError: x is undefined');
    expect(field(point, 'visit')).toBe('returning');
    expect(field(point, 'today')).toBe('1');
    expect(field(point, 'week')).toBe('0');
    expect(field(point, 'month')).toBe('0');
    expect(field(point, 'daysSince')).toBe(3);
    expect(field(point, 'ttfb')).toBe(120.5);
    expect(field(point, 'lcp')).toBe(-1);
    expect(field(point, 'tableMs')).toBe(2400);
    expect(field(point, 'inp')).toBe(88);
    expect(field(point, 'cls')).toBe(0.02);
    expect(field(point, 'heartbeatMedian')).toBe(42);
    expect(field(point, 'moveMedian')).toBe(61);
    expect(field(point, 'moveMax')).toBe(240);
    expect(field(point, 'moves')).toBe(30);
    expect(field(point, 'reconnects')).toBe(1);
    expect(field(point, 'errors')).toBe(2);
    expect(field(point, 'visibleMs')).toBe(600_000);
  });

  it('leaves a later report without a visit, so it counts no player', () => {
    const { visit: _visit, ...later } = report;
    const point = pageReportDataPoint(
      { ...later, sequence: 3, moves: undefined },
      { build: 'b' },
      ''
    );
    expect(field(point, 'visit')).toBe('');
    expect(field(point, 'today')).toBe('');
    expect(field(point, 'daysSince')).toBe(-1);
    expect(field(point, 'moves')).toBe(0);
    expect(field(point, 'sequence')).toBe(3);
  });
});

describe('handlePageReportRequest', () => {
  it('keeps a same-origin report as one row and answers no content', async () => {
    const writeDataPoint = vi.fn();
    const response = await handlePageReportRequest(post(JSON.stringify(report)), {
      dataset: { writeDataPoint },
      build: 'beta-abc',
      origin: { country: 'US', colo: 'LAX' },
      rateLimit: allowed,
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(writeDataPoint).toHaveBeenCalledOnce();
    const [point] = writeDataPoint.mock.calls[0] as [AnalyticsDataPoint];
    expect(point.blobs.slice(0, 4)).toEqual(['page', 'beta-abc', 'US', 'LAX']);
  });

  it('turns away other methods, other sites, floods, oversize and nonsense', async () => {
    const writeDataPoint = vi.fn();
    const dependencies = {
      dataset: { writeDataPoint },
      build: 'b',
      origin: {},
      rateLimit: allowed,
    };
    const body = JSON.stringify(report);
    expect(
      (await handlePageReportRequest(post('', {}, 'GET'), dependencies)).status
    ).toBe(405);
    expect(
      (
        await handlePageReportRequest(
          post(body, { Origin: 'https://evil.example' }),
          dependencies
        )
      ).status
    ).toBe(403);
    expect(
      (
        await handlePageReportRequest(post(body), {
          ...dependencies,
          rateLimit: async () => ({ allowed: false, retryAfterSeconds: 60 }),
        })
      ).status
    ).toBe(429);
    expect(
      (
        await handlePageReportRequest(
          post(JSON.stringify({ ...report, error: 'x'.repeat(5_000) })),
          dependencies
        )
      ).status
    ).toBe(413);
    for (const nonsense of [
      'not json',
      '{}',
      JSON.stringify({ ...report, version: 2 }),
      JSON.stringify({ ...report, sequence: 12 }),
      JSON.stringify({ ...report, landing: 'elsewhere' }),
      JSON.stringify({ ...report, extra: true }),
      JSON.stringify({ ...report, referrer: 'https://x.example/path' }),
      JSON.stringify({ ...report, timings: { ttfb: -1 } }),
    ]) {
      expect(
        (await handlePageReportRequest(post(nonsense), dependencies)).status
      ).toBe(400);
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('answers the page the same when the dataset is missing or refuses', async () => {
    for (const dataset of [
      undefined,
      {
        writeDataPoint: () => {
          throw new Error('over the daily limit');
        },
      },
    ]) {
      const response = await handlePageReportRequest(
        post(JSON.stringify(report)),
        { dataset, build: 'b', origin: {}, rateLimit: allowed }
      );
      expect(response.status).toBe(204);
    }
  });
});
