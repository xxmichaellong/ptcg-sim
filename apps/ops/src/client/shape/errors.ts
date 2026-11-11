import type { ViewResponse } from '../../shared/api.js';
import { parseSqlTime } from '../format.js';
import {
  dataOf,
  daysBetween,
  dailySum,
  graphqlRows,
  graphqlScope,
  headline,
  lastDays,
  num,
  path,
  problemOf,
  rowsOf,
  str,
  type Headline,
  type Row,
} from './common.js';
import { CLOSE_CODES, feedOf, type FeedEvent } from './events.js';
import { releasesOf, type DailyChart, type Problem, type Release } from './overview.js';

/**
 * The Errors view: what goes wrong, how often, since when, for whom.
 */

const DAY_MS = 86_400_000;

export interface ErrorTile {
  readonly id: string;
  readonly label: string;
  readonly info: string;
  readonly unit: 'count' | 'percent';
  readonly headline: Headline;
  readonly trend: readonly (number | null)[];
}

export interface Signature {
  readonly error: string;
  readonly reports: number;
  readonly errors: number;
  readonly first: number;
  readonly last: number;
  readonly browsers: readonly string[];
  readonly systems: readonly string[];
  readonly builds: readonly string[];
}

export interface CountRow {
  readonly key: string;
  readonly cells: readonly string[];
  readonly n: number;
  readonly last?: number;
}

export interface ErrorsModel {
  readonly tiles: readonly ErrorTile[];
  readonly daily: DailyChart;
  readonly signatures: readonly Signature[];
  readonly failures: readonly CountRow[];
  readonly httpErrors: readonly CountRow[];
  readonly moveRefusals: readonly CountRow[];
  readonly admissionRefusals: readonly CountRow[];
  readonly closes: readonly CountRow[];
  readonly limited: readonly CountRow[];
  readonly workerStatuses: readonly CountRow[];
  readonly latest: readonly FeedEvent[];
  readonly releases: readonly Release[];
  readonly problems: Readonly<Record<string, Problem>>;
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.map(str).filter(Boolean) : [];

const WORKER_STATUSES: Readonly<Record<string, string>> = {
  scriptThrewException: 'The Worker threw',
  exceededResources: 'Over its CPU or memory limit',
  internalError: 'Cloudflare internal error',
  clientDisconnected: 'Visitor left mid-request',
};

export const shapeErrors = (response: ViewResponse): ErrorsModel => {
  const { sources } = response;
  const allDays = daysBetween(response.asOf - (Math.max(response.days, 14) - 1) * DAY_MS, response.asOf);
  const days = lastDays(allDays, response.days);
  const inRange = <T>(values: readonly T[]) => lastDays(values, response.days);
  const trouble = rowsOf(sources, 'troubleDaily');
  const of = (field: string) => dailySum(trouble, allDays, (row) => num(row[field]));
  const pageErrors = of('pageErrors');
  const failures = of('failures');
  const serverErrors = of('serverErrors');
  const movesFailed = of('movesFailed');
  const dropped = of('dropped');
  const connections = of('connections');
  const limited = of('limited');

  const tiles: ErrorTile[] = [
    { id: 'pageErrors', label: 'Page errors', info: 'Script errors the players’ pages caught.', unit: 'count', headline: headline(pageErrors, 'down'), trend: inRange(pageErrors) },
    { id: 'failures', label: 'Server failures', info: 'Faults the server caught in a room, a save or a refresh.', unit: 'count', headline: headline(failures, 'down'), trend: inRange(failures) },
    { id: 'serverErrors', label: 'Failed requests', info: 'Requests the Worker answered with a 5xx.', unit: 'count', headline: headline(serverErrors, 'down'), trend: inRange(serverErrors) },
    { id: 'movesFailed', label: 'Failed moves', info: 'Moves the room could not process (not refusals: those are the rules or a stale view).', unit: 'count', headline: headline(movesFailed, 'down'), trend: inRange(movesFailed) },
    { id: 'dropped', label: 'Dropped connections', info: 'Room connections that ended abnormally, as a share of those opened.', unit: 'percent', headline: headline(dropped, 'down', connections), trend: inRange(connections.map((total, index) => (total > 0 ? (dropped[index] ?? 0) / total : null))) },
    { id: 'limited', label: 'Rate-limited', info: 'Requests turned away for coming too often.', unit: 'count', headline: headline(limited, 'down'), trend: inRange(limited) },
  ];

  const signatures: Signature[] = (rowsOf(sources, 'signatures') ?? []).map((row) => ({
    error: str(row.error),
    reports: num(row.reports),
    errors: num(row.errors),
    first: parseSqlTime(row.first),
    last: parseSqlTime(row.last),
    browsers: strings(row.browsers),
    systems: strings(row.systems),
    builds: strings(row.builds),
  }));

  const count = (name: string, cells: (row: Row) => readonly string[]): readonly CountRow[] =>
    (rowsOf(sources, name) ?? []).map((row, index) => ({
      key: `${name}-${String(index)}`,
      cells: cells(row),
      n: num(row.n),
      ...(row.last !== undefined ? { last: parseSqlTime(row.last) } : {}),
    }));

  const workerScope = graphqlScope(dataOf(sources, 'worker'), 'accounts');
  const statusTotals = new Map<string, number>();
  const rangeStart = days[0] ?? '';
  for (const row of graphqlRows(workerScope, 'w')) {
    const status = str(path(row, 'dimensions', 'status'));
    if (status === 'success' || str(path(row, 'dimensions', 'date')) < rangeStart) continue;
    statusTotals.set(status, (statusTotals.get(status) ?? 0) + num(path(row, 'sum', 'requests')));
  }

  return {
    tiles,
    daily: {
      days,
      unit: 'count',
      series: [
        { id: 'pageErrors', label: 'Page errors', values: inRange(pageErrors) },
        { id: 'failures', label: 'Server failures', values: inRange(failures) },
        { id: 'serverErrors', label: 'Failed requests', values: inRange(serverErrors) },
        { id: 'movesFailed', label: 'Failed moves', values: inRange(movesFailed) },
      ],
    },
    signatures,
    failures: count('failures', (row) => [str(row.subsystem), str(row.source), `${String(num(row.retryable))} retryable`, strings(row.builds).join(', ')]),
    httpErrors: count('httpErrors', (row) => [str(row.route), String(num(row.status))]),
    moveRefusals: count('moveRefusals', (row) => [str(row.type), str(row.outcome), str(row.reason)]),
    admissionRefusals: count('admissionRefusals', (row) => [str(row.operation), str(row.outcome), str(row.reason), str(row.role)]),
    closes: count('socketCloses', (row) => [CLOSE_CODES[num(row.code)] ?? 'Other', String(num(row.code)), str(row.outcome)]),
    limited: count('limited', (row) => [str(row.operation)]),
    workerStatuses: [...statusTotals.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([status, n]) => ({ key: status, cells: [WORKER_STATUSES[status] ?? status, status], n })),
    latest: feedOf(rowsOf(sources, 'latest')),
    releases: releasesOf(dataOf(sources, 'deployments')),
    problems: Object.fromEntries(
      Object.keys(sources).flatMap((name) => {
        const problem = problemOf(sources, name);
        return problem ? [[name, { source: name, reason: problem.reason, message: problem.message }]] : [];
      })
    ),
  };
};
