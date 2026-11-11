import { analyticsDataPoint, ANALYTICS_LAYOUT, type AnalyticsKind } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import type { ViewResponse } from '../../shared/api.js';
import { demoSources } from '../../shared/demo.js';
import { FREE_LIMITS } from '../../shared/limits.js';
import type { RangeDays, SiteEnvironment } from '../../shared/site.js';
import type { ViewId } from '../../shared/queries.js';
import { headline } from './common.js';
import { shapeErrors } from './errors.js';
import { describeEvent } from './events.js';
import { shapeLive } from './live.js';
import { shapeOverview } from './overview.js';
import { project, shapeUsage } from './usage.js';

const NOW = Date.parse('2026-11-11T15:30:00Z');

const demo = (view: ViewId, env: SiteEnvironment = 'beta', days: RangeDays = 30, now = NOW): ViewResponse => ({
  view,
  env,
  days,
  asOf: now,
  demo: true,
  sources: demoSources({ view, env, days, now }),
});

describe('headline', () => {
  it('averages the last seven complete days and compares the seven before', () => {
    // 14 complete days and a partial today, which is left out.
    const series = [...Array.from({ length: 7 }, () => 10), ...Array.from({ length: 7 }, () => 15), 1];
    expect(headline(series, 'up')).toEqual({ value: 15, delta: 0.5, kind: 'relative', good: 'up' });
  });

  it('takes a rate as a ratio of sums, its change in points', () => {
    const errors = [...Array.from({ length: 7 }, () => 1), ...Array.from({ length: 7 }, () => 2), 0];
    const reports = Array.from({ length: 15 }, () => 100);
    const rate = headline(errors, 'down', reports);
    expect(rate.value).toBeCloseTo(0.02);
    expect(rate.delta).toBeCloseTo(1);
    expect(rate.kind).toBe('points');
  });

  it('has nothing to say without data', () => {
    expect(headline([null, null, null], 'up')).toMatchObject({ value: null, delta: null });
    expect(headline([], 'up')).toMatchObject({ value: null, delta: null });
  });
});

describe('shapeOverview', () => {
  it('lays out a range of days with every section filled', () => {
    for (const days of [7, 30, 90] as const) {
      const model = shapeOverview(demo('overview', 'beta', days));
      expect(model.days).toHaveLength(days);
      expect(model.days.at(-1)).toBe('2026-11-11');
      for (const tile of model.pulse) {
        expect(tile.headline.value, tile.id).not.toBeNull();
        expect(tile.trend).toHaveLength(days);
      }
      expect(model.problems).toEqual({});
      for (const [name, rows] of Object.entries(model.dimensions)) {
        expect(rows.length, name).toBeGreaterThan(0);
        expect(rows.reduce((total, row) => total + row.share, 0), name).toBeCloseTo(1, 5);
      }
      expect(model.traffic?.daily.series[0]?.values.length).toBe(days);
      expect(model.speed.vitals.every((vital) => vital.rating !== null)).toBe(true);
      expect(model.speed.phases.reduce((total, phase) => total + phase.ms, 0)).toBeGreaterThan(0);
    }
    expect(shapeOverview(demo('overview', 'preview')).traffic).toBeUndefined();
  });

  it('says which source failed and still shapes the rest', () => {
    const response = demo('overview');
    const broken: ViewResponse = {
      ...response,
      sources: {
        ...response.sources,
        pagesDaily: { ok: false, reason: 'unauthorized', message: 'no' },
        zone: { ok: false, reason: 'failed', message: 'zone down' },
      },
    };
    const model = shapeOverview(broken);
    expect(model.problems.pagesDaily?.reason).toBe('unauthorized');
    expect(model.problems.zone?.message).toBe('zone down');
    expect(model.pulse.find((tile) => tile.id === 'players')?.headline.value).toBe(0);
    expect(model.traffic).toBeUndefined();
    expect(model.games.started.series[0]?.values.some((value) => (value ?? 0) > 0)).toBe(true);
  });

  it('shapes nothing at all into zeros and nulls, never a fault', () => {
    const empty: ViewResponse = { view: 'overview', env: 'beta', days: 7, asOf: NOW, demo: false, sources: {} };
    const model = shapeOverview(empty);
    expect(model.days).toHaveLength(7);
    expect(model.pulse.map((tile) => tile.headline.value)).toEqual([0, 0, 0, 0, null, null]);
    expect(model.speed.vitals.every((vital) => vital.value === null && vital.rating === null)).toBe(true);
  });
});

describe('usage', () => {
  it('measures every allowance today, where it is heading, and each day of the range', () => {
    const response = demo('budget');
    const model = shapeUsage({ sources: response.sources, asOf: NOW, days: 30, daily: 'usage', events: ['betaEvents', 'previewEvents'] });
    expect(model.limits.map((limit) => limit.id)).toEqual(FREE_LIMITS.map((limit) => limit.id));
    for (const limit of model.limits) {
      expect(limit.history, limit.id).toHaveLength(30);
      expect(limit.today, limit.id).toBeGreaterThan(0);
      expect(limit.projected, limit.id).toBeGreaterThanOrEqual(limit.today);
    }
    expect(model.tightest?.id).toBe('rowsWritten');
    expect(model.byScript.map((share) => share.detail)).toContain('ptcgsim-v2');
    expect(model.byClass[0]?.label).toBe('Rooms');
    expect(model.paid?.totalUsd).toBeGreaterThanOrEqual(5);
    expect(model.storageBytes).toBeGreaterThan(0);
  });

  it("projects the day from yesterday's shape, steadier early on", () => {
    const evening = Date.parse('2026-11-11T18:00:00Z');
    // Yesterday 1,000 in all, 500 of it by this time; today 600: 20% ahead.
    expect(project(600, 500, 1_000, evening)).toBeCloseTo(1_200);
    // Minutes into the day, one early burst doesn't triple the forecast.
    expect(project(30, 10, 1_000, Date.parse('2026-11-11T00:20:00Z'))).toBeLessThan(1_200);
    // Never below what is already used.
    expect(project(900, 100, 200, evening)).toBe(900);
    // No yesterday: today's straight-line pace.
    expect(project(250, 0, 0, Date.parse('2026-11-11T06:00:00Z'))).toBeCloseTo(1_000);
  });
});

describe('describeEvent', () => {
  it('tells every kind of event in a line', () => {
    for (const kind of Object.keys(ANALYTICS_LAYOUT) as AnalyticsKind[]) {
      const point = analyticsDataPoint(kind, { build: 'b', country: 'FR' }, { blobs: {}, doubles: {} });
      const row: Record<string, unknown> = { timestamp: '2026-11-11 10:00:00', kind };
      point.blobs.forEach((value, index) => (row[`blob${String(index + 1)}`] = value));
      point.doubles.forEach((value, index) => (row[`double${String(index + 1)}`] = value));
      const event = describeEvent(row);
      expect(event?.title, kind).toBeTruthy();
      expect(event?.at).toBe(Date.parse('2026-11-11T10:00:00Z'));
    }
    expect(describeEvent({ kind: 'nonsense', timestamp: '2026-11-11 10:00:00' })).toBeUndefined();
  });

  it('reads a page report, a deleted room and a failure as a person would', () => {
    const row = (kind: AnalyticsKind, fields: Parameters<typeof analyticsDataPoint>[2]) => {
      const point = analyticsDataPoint(kind, { build: 'beta-1', country: 'DE' }, fields as never);
      const out: Record<string, unknown> = { timestamp: '2026-11-11 10:00:00', kind };
      point.blobs.forEach((value, index) => (out[`blob${String(index + 1)}`] = value));
      point.doubles.forEach((value, index) => (out[`double${String(index + 1)}`] = value));
      return out;
    };
    expect(describeEvent(row('page', { blobs: { visit: 'first', device: 'mobile', browser: 'Safari', referrer: 'discord.com' }, doubles: { tableMs: 2_300, sequence: 0 } }))).toMatchObject({
      title: 'A new player arrived',
      detail: 'Germany · mobile, Safari · from discord.com · table in 2.3 s',
      tone: 'good',
    });
    expect(describeEvent(row('room', { blobs: { outcome: 'expired', mode: 'multiplayer' }, doubles: { authorityVersion: 340 } }))).toMatchObject({
      title: 'Online room deleted after a day unused',
      detail: '340 moves · beta-1',
    });
    expect(describeEvent(row('failure', { blobs: { subsystem: 'socket_send', source: 'room' }, doubles: { retryable: 1 } }))).toMatchObject({
      title: 'Server failure: socket send',
      tone: 'critical',
    });
  });
});

describe('shapeLive', () => {
  it('reads each health check, and today against yesterday by now', () => {
    const response = demo('live');
    const down: ViewResponse = {
      ...response,
      sources: {
        ...response.sources,
        v1Health: { ok: true, data: { status: 0, ms: 8_000, body: null, error: 'TimeoutError' } },
        previewHealth: { ok: true, data: { status: 200, ms: 2_400, body: { status: 'ok', buildId: 'p' } } },
      },
    };
    const model = shapeLive(down);
    expect(model.health.map((site) => site.state)).toEqual(['up', 'degraded', 'down']);
    expect(model.health[2]?.note).toBe('No answer in 8 s');
    expect(model.health[0]?.build).toBe('beta-demo123');
    expect(model.today.map((figure) => figure.id)).toEqual(['players', 'rooms', 'moves', 'errors']);
    for (const metric of model.hourly) {
      expect(metric.today).toHaveLength(24);
      // 15:30: hours to 15 are counted, the rest still to come.
      expect(metric.today[15]).not.toBeNull();
      expect(metric.today[16]).toBeNull();
    }
    expect(model.feed.length).toBeGreaterThan(10);
    expect(model.feed[0]!.at).toBeGreaterThanOrEqual(model.feed.at(-1)!.at);
  });
});

describe('shapeErrors', () => {
  it('ranks what went wrong and keeps when it was last seen', () => {
    const model = shapeErrors(demo('errors', 'beta', 7));
    expect(model.tiles).toHaveLength(6);
    expect(model.daily.days).toHaveLength(7);
    expect(model.signatures[0]?.reports).toBeGreaterThanOrEqual(model.signatures[1]?.reports ?? 0);
    expect(Number.isFinite(model.signatures[0]?.last)).toBe(true);
    expect(model.closes[0]?.cells[0]).toBe('Page left');
    expect(model.workerStatuses.length).toBeGreaterThanOrEqual(0);
    expect(model.latest.length).toBeGreaterThan(0);
  });
});
