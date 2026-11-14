import {
  FREE_LIMITS,
  FREE_STORAGE_BYTES,
  paidEstimate,
  type FreeLimit,
  type FreeLimitId,
  type PaidEstimate,
} from '../../shared/limits.js';
import { OBJECT_CLASS_LABELS, SCRIPT_LABELS } from '../../shared/site.js';
import {
  dailySum,
  dataOf,
  daysBetween,
  graphqlRows,
  graphqlScope,
  isoDay,
  lastDays,
  num,
  path,
  ratio,
  rowsOf,
  str,
  type Row,
  type Rows,
  type Sources,
} from './common.js';

/**
 * The account's use of its Workers Free allowances (ADR-051): today by the
 * hour and where it is heading, each day of the range against its limit,
 * who used it (by Worker and by kind of Durable Object), and what the same
 * use would cost on Workers Paid.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface LimitUse extends FreeLimit {
  readonly today: number;
  /** Where today ends at this pace (yesterday's shape of the day). */
  readonly projected: number;
  /** As much of yesterday as has passed of today. */
  readonly yesterdayByNow: number;
  readonly yesterday: number;
  /** Each day of the range, oldest first (today last, partial). */
  readonly history: readonly number[];
}

export interface UsageShare {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly workerRequests: number;
  readonly objectRequests: number;
  readonly gbSeconds: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface UsageModel {
  readonly days: readonly string[];
  readonly limits: readonly LimitUse[];
  /** The limit today's pace takes closest to (or past) its line. */
  readonly tightest: LimitUse | undefined;
  readonly storageBytes: number | null;
  readonly storageLimit: number;
  readonly byScript: readonly UsageShare[];
  readonly byClass: readonly UsageShare[];
  readonly paid: PaidEstimate | undefined;
  /** The days the paid estimate stands on. */
  readonly paidDays: number;
}

interface Namespace {
  readonly script: string;
  readonly className: string;
}

const namespacesOf = (data: unknown): ReadonlyMap<string, Namespace> => {
  const map = new Map<string, Namespace>();
  if (!Array.isArray(data)) return map;
  for (const item of data as Row[]) {
    map.set(str(item.id), { script: str(item.script), className: str(item.class) });
  }
  return map;
};

const withKey = (rows: Rows, key: string, ...pathTo: readonly string[]): Rows =>
  rows.map((row) => ({ ...row, [key]: str(path(row, ...pathTo)) }));

/** The share of a day that has passed by `now` (UTC). */
const dayFraction = (now: number): number => (now % DAY_MS) / DAY_MS;

/**
 * Where today ends: yesterday's total, scaled by how today compares with
 * yesterday so far. Early in the day (little of yesterday behind) the
 * comparison is noise, so it leans on yesterday's total; the scale is
 * bounded either way. Without a yesterday, today's straight-line pace.
 */
export const project = (today: number, yesterdayByNow: number, yesterday: number, now: number): number => {
  if (yesterday > 0) {
    const settled = Math.min(1, yesterdayByNow / (yesterday * 0.15));
    const pace = yesterdayByNow > 0 ? Math.min(4, Math.max(0.25, today / yesterdayByNow)) : 1;
    return Math.max(today, yesterday * (1 + (pace - 1) * settled));
  }
  const fraction = dayFraction(now);
  return fraction > 0.04 ? today / fraction : today;
};

/** Today's and yesterday's use by the hour (the `usageToday` source). */
const todayUse = (
  data: unknown,
  now: number
): Readonly<Record<Exclude<FreeLimitId, 'analyticsEvents'>, { today: number; yesterday: number; byNow: number }>> => {
  const scope = graphqlScope(data, 'accounts');
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const sinceMidnight = now - todayStart;
  const tally = (rows: Rows, pick: (row: Row) => number) => {
    let today = 0;
    let yesterday = 0;
    let byNow = 0;
    for (const row of rows) {
      const hour = Date.parse(str(path(row, 'dimensions', 'datetimeHour')));
      if (!Number.isFinite(hour)) continue;
      const value = pick(row);
      if (hour >= todayStart) today += value;
      else if (hour >= todayStart - DAY_MS) {
        yesterday += value;
        const into = hour - (todayStart - DAY_MS);
        // The hour now running counts for the part of it that has passed.
        if (into + HOUR_MS <= sinceMidnight) byNow += value;
        else if (into < sinceMidnight) byNow += value * ((sinceMidnight - into) / HOUR_MS);
      }
    }
    return { today, yesterday, byNow };
  };
  const workers = graphqlRows(scope, 'workers');
  const invocations = graphqlRows(scope, 'invocations');
  const periodic = graphqlRows(scope, 'periodic');
  return {
    workerRequests: tally(workers, (row) => num(path(row, 'sum', 'requests'))),
    objectRequests: tally(invocations, (row) => num(path(row, 'sum', 'requests'))),
    objectDuration: tally(periodic, (row) => num(path(row, 'sum', 'duration'))),
    rowsRead: tally(periodic, (row) => num(path(row, 'sum', 'rowsRead'))),
    rowsWritten: tally(periodic, (row) => num(path(row, 'sum', 'rowsWritten'))),
  };
};

export interface UsageInput {
  readonly sources: Sources;
  readonly asOf: number;
  readonly days: number;
  /** The daily-usage source, if the view has one (Budget). */
  readonly daily?: string;
  /** Analytics Engine rows a day, by source name. */
  readonly events: readonly string[];
}

export const shapeUsage = ({ sources, asOf, days: rangeDays, daily, events }: UsageInput): UsageModel => {
  const allDays = daysBetween(asOf - (Math.max(rangeDays, 14) - 1) * DAY_MS, asOf);
  const days = lastDays(allDays, rangeDays);
  const scope = daily ? graphqlScope(dataOf(sources, daily), 'accounts') : undefined;
  const workers = withKey(graphqlRows(scope, 'workers'), '__date', 'dimensions', 'date');
  const invocations = withKey(graphqlRows(scope, 'invocations'), '__date', 'dimensions', 'date');
  const periodic = withKey(graphqlRows(scope, 'periodic'), '__date', 'dimensions', 'date');
  const storage = withKey(graphqlRows(scope, 'storage'), '__date', 'dimensions', 'date');
  const eventRows = events.flatMap((name) => rowsOf(sources, name) ?? []);
  const history: Readonly<Record<FreeLimitId, readonly number[]>> = {
    workerRequests: dailySum(workers, allDays, (row) => num(path(row, 'sum', 'requests')), '__date'),
    objectRequests: dailySum(invocations, allDays, (row) => num(path(row, 'sum', 'requests')), '__date'),
    objectDuration: dailySum(periodic, allDays, (row) => num(path(row, 'sum', 'duration')), '__date'),
    rowsRead: dailySum(periodic, allDays, (row) => num(path(row, 'sum', 'rowsRead')), '__date'),
    rowsWritten: dailySum(periodic, allDays, (row) => num(path(row, 'sum', 'rowsWritten')), '__date'),
    analyticsEvents: dailySum(eventRows, allDays, (row) => num(row.rows)),
  };
  const hourly = todayUse(dataOf(sources, 'usageToday'), asOf);
  const today = isoDay(asOf);
  const limits: LimitUse[] = FREE_LIMITS.map((limit) => {
    if (limit.id === 'analyticsEvents') {
      const todayValue = history.analyticsEvents.at(-1) ?? 0;
      const yesterday = history.analyticsEvents.at(-2) ?? 0;
      const fraction = dayFraction(asOf);
      return {
        ...limit,
        today: todayValue,
        yesterday,
        yesterdayByNow: yesterday * fraction,
        projected: project(todayValue, yesterday * fraction, yesterday, asOf),
        history: lastDays(history.analyticsEvents, rangeDays),
      };
    }
    const use = hourly[limit.id];
    const series = [...history[limit.id]];
    // Today's hours are fresher than the daily rows.
    if (series.length > 0 && allDays.at(-1) === today) series[series.length - 1] = Math.max(series.at(-1) ?? 0, use.today);
    return {
      ...limit,
      today: use.today,
      yesterday: use.yesterday,
      yesterdayByNow: use.byNow,
      projected: project(use.today, use.byNow, use.yesterday, asOf),
      history: lastDays(series, rangeDays),
    };
  });
  const tightest = [...limits].sort(
    (left, right) => right.projected / right.daily - left.projected / left.daily
  )[0];

  const namespaces = namespacesOf(dataOf(sources, 'namespaces'));
  const rangeStart = days[0] ?? today;
  const inRange = (row: Row) => str(row.__date) >= rangeStart;
  const shares = new Map<string, { -readonly [K in keyof UsageShare]: UsageShare[K] }>();
  const share = (key: string, label: string, detail: string) => {
    let entry = shares.get(key);
    if (!entry) {
      entry = { key, label, detail, workerRequests: 0, objectRequests: 0, gbSeconds: 0, rowsRead: 0, rowsWritten: 0 };
      shares.set(key, entry);
    }
    return entry;
  };
  const scriptLabel = (script: string) => SCRIPT_LABELS[script] ?? script;
  for (const row of workers.filter(inRange)) {
    const script = str(path(row, 'dimensions', 'scriptName'));
    share(`script:${script}`, scriptLabel(script), script).workerRequests += num(path(row, 'sum', 'requests'));
  }
  for (const row of invocations.filter(inRange)) {
    const id = str(path(row, 'dimensions', 'namespaceId'));
    const namespace = namespaces.get(id);
    const script = namespace?.script || str(path(row, 'dimensions', 'scriptName'));
    share(`script:${script}`, scriptLabel(script), script).objectRequests += num(path(row, 'sum', 'requests'));
    const className = namespace?.className ?? 'Unknown';
    share(`class:${script}:${className}`, OBJECT_CLASS_LABELS[className] ?? className, scriptLabel(script)).objectRequests += num(path(row, 'sum', 'requests'));
  }
  for (const row of periodic.filter(inRange)) {
    const id = str(path(row, 'dimensions', 'namespaceId'));
    const namespace = namespaces.get(id);
    const script = namespace?.script ?? 'Unknown';
    const className = namespace?.className ?? 'Unknown';
    for (const entry of [
      share(`script:${script}`, scriptLabel(script), script),
      share(`class:${script}:${className}`, OBJECT_CLASS_LABELS[className] ?? className, scriptLabel(script)),
    ]) {
      entry.gbSeconds += num(path(row, 'sum', 'duration'));
      entry.rowsRead += num(path(row, 'sum', 'rowsRead'));
      entry.rowsWritten += num(path(row, 'sum', 'rowsWritten'));
    }
  }
  const sorted = (prefix: string) =>
    [...shares.values()]
      .filter((entry) => entry.key.startsWith(prefix))
      .sort((left, right) => right.rowsWritten + right.objectRequests + right.workerRequests - (left.rowsWritten + left.objectRequests + left.workerRequests));

  const storageValues = storage.map((row) => num(path(row, 'max', 'storedBytes')));
  const storageBytes = storageValues.length > 0 ? (storageValues.at(-1) ?? null) : null;

  // A month's use from the last thirty complete days (or as many as there are).
  const complete = (values: readonly number[]) => values.slice(Math.max(0, values.length - 31), values.length - 1);
  const paidDays = scope ? Math.min(30, Math.max(0, allDays.length - 1)) : 0;
  const monthly = (values: readonly number[]) =>
    paidDays > 0 ? (complete(values).reduce((total, value) => total + value, 0) / paidDays) * 30.4 : 0;
  const cpuMs = dailySum(workers, allDays, (row) => num(path(row, 'sum', 'cpuTimeUs')) / 1_000, '__date');
  const paid = scope
    ? paidEstimate({
        workerRequests: monthly(history.workerRequests),
        workerCpuMs: monthly(cpuMs),
        objectRequests: monthly(history.objectRequests),
        objectGbSeconds: monthly(history.objectDuration),
        rowsRead: monthly(history.rowsRead),
        rowsWritten: monthly(history.rowsWritten),
        storageGb: (storageBytes ?? 0) / 1_000_000_000,
      })
    : undefined;

  return {
    days,
    limits,
    tightest,
    storageBytes,
    storageLimit: FREE_STORAGE_BYTES,
    byScript: sorted('script:'),
    byClass: sorted('class:'),
    paid,
    paidDays,
  };
};

/** How full a limit is today and where it is heading, as shares of it. */
export const limitShares = (limit: LimitUse) => ({
  today: ratio(limit.today, limit.daily) ?? 0,
  projected: ratio(limit.projected, limit.daily) ?? 0,
});
