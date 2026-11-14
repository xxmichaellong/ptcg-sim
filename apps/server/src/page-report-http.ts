import {
  analyticsDataPoint,
  MAX_PAGE_REPORT_CODE_UNITS,
  readPageReport,
  type AnalyticsDataPoint,
  type PageReport,
} from '@ptcgsim/protocol';

import type {
  AnalyticsDataset,
  AnalyticsRequestOrigin,
} from './analytics-sink.js';
import {
  browserJsonResponse,
  browserNoContentResponse,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import type { RequestRateLimitDecision } from './request-rate-limit.js';

/**
 * A page's report of its visit (ADR-054), `POST /v2/beacon`: checked, given
 * the visitor's country and browser family, and kept as one analytics row.
 * Only this site's own pages send it (same origin), each address only so
 * often, and nothing else is done with it: no room, no storage, no reply.
 */

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface UserAgentSummary {
  readonly browser: string;
  readonly os: string;
  readonly device: DeviceClass;
}

/**
 * A browser's family, system and kind of device from its User-Agent and
 * what the page says of its pointer and size. Only these coarse families
 * are kept, never the string.
 */
export const summarizeUserAgent = (
  userAgent: string,
  pointer: PageReport['pointer'],
  width: number,
  height: number
): UserAgentSummary => {
  const ua = userAgent;
  // A headless browser is a test or a bot, never a player's.
  const browser = /\bHeadlessChrome\/|\bHeadless\b/u.test(ua)
    ? 'Headless'
    : /Discord\//u.test(ua)
      ? 'Discord'
    : /\bEdg(?:e|A|iOS)?\//u.test(ua)
      ? 'Edge'
      : /\bOPR\/|\bOpera\b/u.test(ua)
        ? 'Opera'
        : /SamsungBrowser\//u.test(ua)
          ? 'Samsung Internet'
          : /\bFirefox\/|\bFxiOS\//u.test(ua)
            ? 'Firefox'
            : /\bCriOS\/|\bChrome\/|\bChromium\//u.test(ua)
              ? 'Chrome'
              : /\bVersion\/[\d.]+.*Safari\//u.test(ua) ||
                  /\b(?:iPhone|iPad|iPod)\b/u.test(ua)
                ? 'Safari'
                : 'Other';
  const touchMac = /Macintosh/u.test(ua) && pointer === 'coarse';
  const os = /\b(?:iPhone|iPod)\b/u.test(ua)
    ? 'iOS'
    : /\biPad\b/u.test(ua) || touchMac
      ? 'iPadOS'
      : /\bAndroid\b/u.test(ua)
        ? 'Android'
        : /\bCrOS\b/u.test(ua)
          ? 'ChromeOS'
          : /\bWindows\b/u.test(ua)
            ? 'Windows'
            : /\bMac OS X\b|\bMacintosh\b/u.test(ua)
              ? 'macOS'
              : /\bLinux\b/u.test(ua)
                ? 'Linux'
                : 'Other';
  const shortSide = Math.min(width, height);
  const device: DeviceClass =
    os === 'iPadOS' ||
    (os === 'Android' && !/\bMobile\b/u.test(ua) && shortSide >= 600)
      ? 'tablet'
      : os === 'iOS' ||
          os === 'Android' ||
          /\bMobi/u.test(ua) ||
          (pointer === 'coarse' && shortSide > 0 && shortSide < 600)
        ? 'mobile'
        : pointer === 'coarse'
          ? 'tablet'
          : 'desktop';
  return { browser, os, device };
};

const flag = (value: boolean | undefined): string =>
  value === undefined ? '' : value ? '1' : '0';

/** The row a report becomes. */
export const pageReportDataPoint = (
  report: PageReport,
  origin: AnalyticsRequestOrigin & { readonly build: string },
  userAgent: string
): AnalyticsDataPoint => {
  const { browser, os, device } = summarizeUserAgent(
    userAgent,
    report.pointer,
    report.width,
    report.height
  );
  const visit = report.visit;
  return analyticsDataPoint('page', origin, {
    blobs: {
      landing: report.landing,
      table: report.table,
      device,
      browser,
      os,
      language: report.language,
      ...(report.referrer ? { referrer: report.referrer } : {}),
      ...(report.campaign ? { campaign: report.campaign } : {}),
      ...(report.error ? { error: report.error } : {}),
      pointer: report.pointer,
      ...(visit
        ? {
            visit: visit.first ? 'first' : 'returning',
            today: flag(visit.today),
            week: flag(visit.week),
            month: flag(visit.month),
          }
        : {}),
    },
    doubles: {
      sequence: report.sequence,
      visibleMs: report.visibleMs,
      ...(visit?.daysSince !== undefined ? { daysSince: visit.daysSince } : {}),
      ...(report.timings.ttfb !== undefined ? { ttfb: report.timings.ttfb } : {}),
      ...(report.timings.fcp !== undefined ? { fcp: report.timings.fcp } : {}),
      ...(report.timings.lcp !== undefined ? { lcp: report.timings.lcp } : {}),
      ...(report.timings.table !== undefined
        ? { tableMs: report.timings.table }
        : {}),
      ...(report.timings.inp !== undefined ? { inp: report.timings.inp } : {}),
      ...(report.timings.cls !== undefined ? { cls: report.timings.cls } : {}),
      ...(report.heartbeat
        ? {
            heartbeatMedian: report.heartbeat.median,
            heartbeatMax: report.heartbeat.max,
          }
        : {}),
      ...(report.moves
        ? {
            moveMedian: report.moves.median,
            moveMax: report.moves.max,
            moves: report.moves.samples,
          }
        : { moves: 0 }),
      reconnects: report.reconnects,
      errors: report.errors,
    },
  });
};

export interface PageReportDependencies {
  readonly dataset: AnalyticsDataset | undefined;
  readonly build: string;
  readonly origin: AnalyticsRequestOrigin;
  readonly rateLimit: () => Promise<RequestRateLimitDecision>;
}

export const handlePageReportRequest = async (
  request: Request,
  { dataset, build, origin, rateLimit }: PageReportDependencies
): Promise<Response> => {
  if (request.method !== 'POST') {
    return browserJsonResponse({ error: 'method_not_allowed' }, 405, {
      Allow: 'POST',
    });
  }
  if (!isSameOriginBrowserRequest(request)) {
    return browserJsonResponse({ error: 'forbidden' }, 403);
  }
  const limit = await rateLimit();
  if (!limit.allowed) {
    return browserJsonResponse({ error: 'rate_limited' }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }
  let value: unknown;
  try {
    value = await readBoundedJsonRequest(request, MAX_PAGE_REPORT_CODE_UNITS);
  } catch (error) {
    return error instanceof RangeError
      ? browserJsonResponse({ error: 'too_large' }, 413)
      : browserJsonResponse({ error: 'invalid_report' }, 400);
  }
  const report = readPageReport(value);
  if (!report) return browserJsonResponse({ error: 'invalid_report' }, 400);
  try {
    dataset?.writeDataPoint(
      pageReportDataPoint(
        report,
        { build, ...origin },
        request.headers.get('User-Agent') ?? ''
      )
    );
  } catch {
    // A report that can't be kept is lost; the page is told nothing.
  }
  return browserNoContentResponse();
};
