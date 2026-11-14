import type { ProbeResult, ViewResponse } from '../../shared/api.js';
import { dataOf, num, problemOf, rowsOf, str, type Sources } from './common.js';
import { feedOf, type FeedEvent } from './events.js';
import { releasesOf, type Problem, type Release } from './overview.js';
import { shapeUsage, type UsageModel } from './usage.js';

/**
 * The Live view: whether each site is up, today so far against the same
 * time yesterday, today and yesterday by the hour, the free plan's day so
 * far, and the latest events.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface Health {
  readonly name: string;
  readonly state: 'up' | 'degraded' | 'down' | 'unknown';
  readonly status: number;
  readonly ms: number | null;
  readonly build?: string;
  readonly note?: string;
}

export interface TodayFigure {
  readonly id: string;
  readonly label: string;
  readonly today: number;
  /** Yesterday, up to the same time of day. */
  readonly yesterdayByNow: number;
  readonly good: 'up' | 'down';
}

export interface HourlyMetric {
  readonly id: string;
  readonly label: string;
  /** 24 hours of today (null for hours still to come) and of yesterday. */
  readonly today: readonly (number | null)[];
  readonly yesterday: readonly number[];
}

export interface LiveModel {
  readonly asOf: number;
  readonly health: readonly Health[];
  readonly today: readonly TodayFigure[];
  readonly hourly: readonly HourlyMetric[];
  readonly usage: UsageModel;
  readonly feed: readonly FeedEvent[];
  readonly releases: readonly Release[];
  readonly problems: Readonly<Record<string, Problem>>;
}

const health = (sources: Sources, name: string, label: string, slowMs: number): Health => {
  const probe = dataOf(sources, name) as ProbeResult | undefined;
  if (!probe) return { name: label, state: 'unknown', status: 0, ms: null };
  const body = probe.body as { buildId?: unknown; status?: unknown } | null;
  const build = typeof body?.buildId === 'string' ? body.buildId : undefined;
  const ok = probe.status >= 200 && probe.status < 400 && (body === null || body.status === undefined || body.status === 'ok');
  return {
    name: label,
    state: !ok ? 'down' : probe.ms > slowMs ? 'degraded' : 'up',
    status: probe.status,
    ms: probe.ms,
    ...(build ? { build } : {}),
    ...(probe.error ? { note: probe.error === 'TimeoutError' ? 'No answer in 8 s' : probe.error } : {}),
  };
};

const METRICS = [
  ['players', 'Players', 'up'],
  ['rooms', 'Games started', 'up'],
  ['moves', 'Moves', 'up'],
  ['errors', 'Errors', 'down'],
] as const;

export const shapeLive = (response: ViewResponse): LiveModel => {
  const { sources, asOf } = response;
  const todayStart = Math.floor(asOf / DAY_MS) * DAY_MS;
  const yesterdayStart = todayStart - DAY_MS;
  const hourlyRows = rowsOf(sources, 'hourly') ?? [];
  const slots = (start: number) => {
    const map = new Map<number, Record<string, number>>();
    for (const row of hourlyRows) {
      const at = Date.parse(`${str(row.t).replace(' ', 'T')}Z`);
      if (at < start || at >= start + DAY_MS) continue;
      map.set(Math.floor((at - start) / HOUR_MS), {
        players: num(row.players),
        rooms: num(row.rooms),
        moves: num(row.moves),
        errors: num(row.serverErrors) + num(row.pageErrors),
        views: num(row.views),
        joins: num(row.joins),
      });
    }
    return map;
  };
  const today = slots(todayStart);
  const yesterday = slots(yesterdayStart);
  const hourNow = Math.floor((asOf - todayStart) / HOUR_MS);
  const intoHour = ((asOf - todayStart) % HOUR_MS) / HOUR_MS;
  const hourly: HourlyMetric[] = METRICS.map(([id, label]) => ({
    id,
    label,
    today: Array.from({ length: 24 }, (_, hour) => (hour <= hourNow ? (today.get(hour)?.[id] ?? 0) : null)),
    yesterday: Array.from({ length: 24 }, (_, hour) => yesterday.get(hour)?.[id] ?? 0),
  }));
  const figures: TodayFigure[] = METRICS.map(([id, label, good]) => {
    let todayTotal = 0;
    let byNow = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      todayTotal += today.get(hour)?.[id] ?? 0;
      const before = yesterday.get(hour)?.[id] ?? 0;
      if (hour < hourNow) byNow += before;
      else if (hour === hourNow) byNow += before * intoHour;
    }
    return { id, label, today: todayTotal, yesterdayByNow: byNow, good };
  });
  const problems = Object.fromEntries(
    Object.keys(sources).flatMap((name) => {
      const problem = problemOf(sources, name);
      return problem ? [[name, { source: name, reason: problem.reason, message: problem.message }]] : [];
    })
  );
  return {
    asOf,
    health: [
      health(sources, 'betaHealth', 'Beta', 1_500),
      health(sources, 'previewHealth', 'Preview', 1_500),
      health(sources, 'v1Health', 'ptcgsim.online (v1)', 3_000),
    ],
    today: figures,
    hourly,
    usage: shapeUsage({ sources, asOf, days: 7, events: ['eventsToday', 'otherEventsToday'] }),
    feed: feedOf(rowsOf(sources, 'latest')),
    releases: releasesOf(dataOf(sources, 'deployments')).slice(0, 5),
    problems,
  };
};
