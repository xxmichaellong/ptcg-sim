import { analyticsColumn } from '@ptcgsim/protocol';

import { SITE, type RangeDays, type SiteEnvironment } from './site.js';

/**
 * Every question the dashboard asks Cloudflare (ADR-054), by view. The
 * browser names a view, an environment and a range; the Worker builds these
 * fixed queries from them (nothing the browser sends reaches a query but
 * those three checked values), runs them, and hands back their rows. The
 * browser shapes the rows (shape/*.ts), so the Worker stays within its
 * small CPU allowance.
 *
 * Three kinds of source:
 * - `ae`: Workers Analytics Engine SQL over the site's own events
 *   (ANALYTICS_LAYOUT names their columns). Rows may be sampled; each
 *   stands for `_sample_interval` events, so every count is a sum of it and
 *   every quantile is weighted by it. A move row also carries its own
 *   weight (`double1`, ANALYTICS_MOVE_SAMPLE).
 * - `graphql`: Cloudflare's GraphQL analytics, for what Cloudflare itself
 *   measures: Worker and Durable Object usage, and the zone's traffic.
 * - `rest` and `probe`: deployments and namespaces, and the sites' health.
 */

export type ViewId = 'overview' | 'live' | 'budget' | 'errors';
export const VIEW_IDS: readonly ViewId[] = [
  'overview',
  'live',
  'budget',
  'errors',
];
export const isViewId = (value: unknown): value is ViewId =>
  VIEW_IDS.includes(value as ViewId);

export type SourceQuery =
  | { readonly kind: 'ae'; readonly sql: string }
  | {
      readonly kind: 'graphql';
      readonly query: string;
      readonly variables: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'rest'; readonly path: string }
  | { readonly kind: 'probe'; readonly url: string };

export interface ViewRequest {
  readonly view: ViewId;
  readonly env: SiteEnvironment;
  readonly days: RangeDays;
  /** The moment the view is as of, in milliseconds. */
  readonly now: number;
}

export interface AccountConfig {
  readonly accountId: string;
  readonly zoneId: string;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Midnight UTC of a moment's day. */
export const startOfUtcDay = (ms: number): number =>
  Math.floor(ms / DAY_MS) * DAY_MS;

/** A moment as Analytics Engine's SQL reads it: `YYYY-MM-DD HH:MM:SS` (UTC). */
export const sqlTime = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export const isoDate = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

/**
 * The first day a range's daily series reads: enough for the range itself
 * and for the seven days before its last week, which the headline figures
 * compare against.
 */
export const seriesStart = (now: number, days: RangeDays): number =>
  startOfUtcDay(now) - (Math.max(days, 14) - 1) * DAY_MS;

const W = '_sample_interval';
/** A move row's weight times its sample: the moves it stands for. */
const MOVE_W = `${W} * double1`;
const page = (field: Parameters<typeof analyticsColumn<'page'>>[1]) =>
  analyticsColumn('page', field);
const move = (field: Parameters<typeof analyticsColumn<'move'>>[1]) =>
  analyticsColumn('move', field);
const http = (field: Parameters<typeof analyticsColumn<'http'>>[1]) =>
  analyticsColumn('http', field);
const room = (field: Parameters<typeof analyticsColumn<'room'>>[1]) =>
  analyticsColumn('room', field);
const admission = (field: Parameters<typeof analyticsColumn<'admission'>>[1]) =>
  analyticsColumn('admission', field);
const socket = (field: Parameters<typeof analyticsColumn<'socket'>>[1]) =>
  analyticsColumn('socket', field);
const failure = (field: Parameters<typeof analyticsColumn<'failure'>>[1]) =>
  analyticsColumn('failure', field);
const limited = (field: Parameters<typeof analyticsColumn<'limited'>>[1]) =>
  analyticsColumn('limited', field);

/**
 * Analytics Engine's SQL is strictly typed: both branches of `if` must be
 * one type (a sample interval is an integer, a column or a weighted move a
 * double) and its condition a comparison, never `1`. These say "nothing"
 * in the type of what they stand beside.
 */
const zeroLike = (weight: string): string => (weight === W ? '0' : '0.0');
/** Rows where the field was measured, or every row (`ALWAYS`). */
const ALWAYS = 'always';
const weightWhere = (measured: string, weight: string): string =>
  measured === ALWAYS
    ? weight
    : `if(${measured}, ${weight}, ${zeroLike(weight)})`;

/** A weighted quantile of the rows where `measured` holds. */
const quantile = (
  q: number,
  value: string,
  measured: string,
  weight = W
): string =>
  `quantileExactWeighted(${String(q)})(${value}, toUInt32(${weightWhere(measured, weight)}))`;
/** How many events a quantile stands on. */
const measuredCount = (measured: string, weight = W): string =>
  `SUM(${weightWhere(measured, weight)})`;
/** A column's total, its absent (-1) and zero values left out. */
const positive = (value: string): string => `if(${value} > 0, ${value}, 0.0)`;
const sumOf = (value: string, weight = W): string =>
  `SUM(${weight} * ${positive(value)})`;
const countWhere = (condition: string, weight = W): string =>
  `SUM(if(${condition}, ${weight}, ${zeroLike(weight)}))`;

const since = (from: number): string =>
  `timestamp >= toDateTime('${sqlTime(from)}')`;
const DAY = 'toStartOfDay(timestamp)';
const HOUR = 'toStartOfHour(timestamp)';

const timing = (field: Parameters<typeof analyticsColumn<'page'>>[1]) =>
  `${page(field)} >= 0`;

/** Page reports, a day per row: visits, players, time and trouble. */
const pagesDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t,
  ${countWhere(`${page('sequence')} = 0`)} AS views,
  ${countWhere(`${page('today')} = '1'`)} AS players,
  ${countWhere(`${page('visit')} = 'first'`)} AS newPlayers,
  ${countWhere(`${page('week')} = '1'`)} AS weekFirsts,
  ${countWhere(`${page('month')} = '1'`)} AS monthFirsts,
  SUM(${W}) AS reports,
  ${countWhere(`${page('errors')} > 0`)} AS reportsWithErrors,
  ${sumOf(page('errors'))} AS errors,
  ${sumOf(page('reconnects'))} AS reconnects,
  ${sumOf(page('visibleMs'))} AS visibleMs,
  ${sumOf(page('moves'))} AS moves,
  ${countWhere(`${page('table')} = 'multiplayer'`)} AS onlineReports,
  ${countWhere(`${page('table')} = 'solo'`)} AS soloReports
FROM ${dataset}
WHERE index1 = 'page' AND ${since(from)}
GROUP BY t ORDER BY t`;

/** How fast pages loaded and answered, a day per row. */
const speedDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t,
  ${quantile(0.5, page('tableMs'), timing('tableMs'))} AS table50,
  ${quantile(0.75, page('tableMs'), timing('tableMs'))} AS table75,
  ${quantile(0.95, page('tableMs'), timing('tableMs'))} AS table95,
  ${measuredCount(timing('tableMs'))} AS tableN,
  ${quantile(0.75, page('ttfb'), timing('ttfb'))} AS ttfb75,
  ${measuredCount(timing('ttfb'))} AS ttfbN,
  ${quantile(0.75, page('fcp'), timing('fcp'))} AS fcp75,
  ${measuredCount(timing('fcp'))} AS fcpN,
  ${quantile(0.75, page('lcp'), timing('lcp'))} AS lcp75,
  ${measuredCount(timing('lcp'))} AS lcpN,
  ${quantile(0.75, page('inp'), timing('inp'))} AS inp75,
  ${measuredCount(timing('inp'))} AS inpN,
  ${quantile(0.75, page('cls'), timing('cls'))} AS cls75,
  ${measuredCount(timing('cls'))} AS clsN,
  ${quantile(0.5, page('heartbeatMedian'), timing('heartbeatMedian'))} AS heartbeat50,
  ${quantile(0.9, page('heartbeatMedian'), timing('heartbeatMedian'))} AS heartbeat90,
  ${measuredCount(timing('heartbeatMedian'))} AS heartbeatN,
  ${quantile(0.5, page('moveMedian'), timing('moveMedian'))} AS move50,
  ${quantile(0.9, page('moveMedian'), timing('moveMedian'))} AS move90,
  ${measuredCount(timing('moveMedian'))} AS moveN
FROM ${dataset}
WHERE index1 = 'page' AND ${since(from)}
GROUP BY t ORDER BY t`;

/** The first reports of the range's visits, by one of their traits. */
const pagesBy = (dataset: string, from: number, column: string): string => `
SELECT ${column} AS key,
  SUM(${W}) AS views,
  ${countWhere(`${page('today')} = '1'`)} AS players,
  ${quantile(0.75, page('tableMs'), timing('tableMs'))} AS table75,
  ${measuredCount(timing('tableMs'))} AS tableN,
  ${quantile(0.5, page('heartbeatMedian'), timing('heartbeatMedian'))} AS heartbeat50,
  ${measuredCount(timing('heartbeatMedian'))} AS heartbeatN
FROM ${dataset}
WHERE index1 = 'page' AND ${page('sequence')} = 0 AND ${since(from)}
GROUP BY key ORDER BY views DESC LIMIT 12`;

const roomsDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t, ${room('outcome')} AS outcome, ${room('mode')} AS mode,
  SUM(${W}) AS rooms
FROM ${dataset}
WHERE index1 = 'room' AND ${since(from)}
GROUP BY t, outcome, mode ORDER BY t`;

/** Rooms deleted after their last use: how many moves a game had. */
const roomSizes = (dataset: string, from: number): string => `
SELECT ${room('mode')} AS mode,
  SUM(${W}) AS rooms,
  ${sumOf(room('authorityVersion'))} AS moves,
  ${quantile(0.5, room('authorityVersion'), ALWAYS)} AS moves50,
  ${quantile(0.9, room('authorityVersion'), ALWAYS)} AS moves90,
  ${countWhere(`${room('authorityVersion')} <= 1`)} AS untouched
FROM ${dataset}
WHERE index1 = 'room' AND ${room('outcome')} = 'expired' AND ${since(from)}
GROUP BY mode`;

const admissionsDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t, ${admission('operation')} AS operation,
  ${admission('outcome')} AS outcome, ${admission('role')} AS role,
  SUM(${W}) AS n
FROM ${dataset}
WHERE index1 = 'admission' AND ${since(from)}
GROUP BY t, operation, outcome, role ORDER BY t`;

const movesDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t, ${move('outcome')} AS outcome,
  SUM(${MOVE_W}) AS moves,
  ${quantile(0.5, move('durationMs'), ALWAYS, MOVE_W)} AS server50,
  ${quantile(0.95, move('durationMs'), ALWAYS, MOVE_W)} AS server95
FROM ${dataset}
WHERE index1 = 'move' AND ${since(from)}
GROUP BY t, outcome ORDER BY t`;

/** Where an accepted move's time goes on the server, and which moves. */
const moveTypes = (dataset: string, from: number): string => `
SELECT ${move('commandType')} AS type,
  SUM(${MOVE_W}) AS moves,
  ${quantile(0.5, move('durationMs'), ALWAYS, MOVE_W)} AS server50,
  ${quantile(0.95, move('durationMs'), ALWAYS, MOVE_W)} AS server95,
  SUM(${MOVE_W} * ${move('authorityMs')}) / SUM(${MOVE_W}) AS authorityMs,
  SUM(${MOVE_W} * ${move('projectionMs')}) / SUM(${MOVE_W}) AS projectionMs,
  SUM(${MOVE_W} * ${move('persistenceMs')}) / SUM(${MOVE_W}) AS persistenceMs,
  SUM(${MOVE_W} * ${move('serializationMs')}) / SUM(${MOVE_W}) AS serializationMs,
  SUM(${MOVE_W} * ${move('sendMs')}) / SUM(${MOVE_W}) AS sendMs,
  SUM(${MOVE_W} * ${move('publicationBytes')}) / SUM(${MOVE_W}) AS publicationBytes
FROM ${dataset}
WHERE index1 = 'move' AND ${move('outcome')} = 'accepted' AND ${since(from)}
GROUP BY type ORDER BY moves DESC LIMIT 15`;

const httpRoutes = (dataset: string, from: number): string => `
SELECT ${http('route')} AS route,
  SUM(${W}) AS requests,
  ${countWhere(`${http('status')} >= 500`)} AS failed,
  ${countWhere(`${http('status')} = 429`)} AS limited,
  ${countWhere(`${http('status')} >= 400 AND ${http('status')} < 500 AND ${http('status')} != 429`)} AS refused,
  ${quantile(0.5, http('durationMs'), ALWAYS)} AS p50,
  ${quantile(0.95, http('durationMs'), ALWAYS)} AS p95
FROM ${dataset}
WHERE index1 = 'http' AND ${since(from)}
GROUP BY route ORDER BY requests DESC LIMIT 30`;

/** Everything that went wrong, a day per row. */
const troubleDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t,
  ${countWhere(`index1 = 'failure'`)} AS failures,
  ${countWhere(`index1 = 'http' AND ${http('status')} >= 500`)} AS serverErrors,
  ${countWhere(`index1 = 'move' AND ${move('outcome')} = 'failed'`, MOVE_W)} AS movesFailed,
  ${countWhere(`index1 = 'move' AND ${move('outcome')} = 'rejected'`, MOVE_W)} AS movesRejected,
  ${countWhere(`index1 = 'limited'`)} AS limited,
  ${countWhere(`index1 = 'socket' AND ${socket('outcome')} = 'closed' AND ${socket('closeCode')} NOT IN (1000.0, 1001.0, 1005.0)`)} AS dropped,
  ${countWhere(`index1 = 'socket' AND ${socket('outcome')} = 'upgraded'`)} AS connections,
  ${countWhere(`index1 = 'page' AND ${page('errors')} > 0`)} AS pagesWithErrors,
  SUM(if(index1 = 'page', ${W} * ${positive(page('errors'))}, 0.0)) AS pageErrors
FROM ${dataset}
WHERE index1 IN ('failure', 'http', 'move', 'limited', 'socket', 'page') AND ${since(from)}
GROUP BY t ORDER BY t`;

/** The last day by the hour, across kinds: the Live view's chart. */
const liveHourly = (dataset: string, from: number): string => `
SELECT ${HOUR} AS t,
  ${countWhere(`index1 = 'page' AND ${page('sequence')} = 0`)} AS views,
  ${countWhere(`index1 = 'page' AND ${page('today')} = '1'`)} AS players,
  ${countWhere(`index1 = 'move' AND ${move('outcome')} = 'accepted'`, MOVE_W)} AS moves,
  ${countWhere(`index1 = 'room' AND ${room('outcome')} = 'created'`)} AS rooms,
  ${countWhere(`index1 = 'admission' AND ${admission('operation')} = 'hello_ticket' AND ${admission('outcome')} = 'accepted'`)} AS joins,
  ${countWhere(`index1 = 'failure' OR (index1 = 'http' AND ${http('status')} >= 500)`)} AS serverErrors,
  SUM(if(index1 = 'page', ${W} * ${positive(page('errors'))}, 0.0)) AS pageErrors
FROM ${dataset}
WHERE ${since(from)}
GROUP BY t ORDER BY t`;

const COLUMNS =
  'timestamp, index1 AS kind, ' +
  Array.from({ length: 18 }, (_, index) => `blob${String(index + 1)}`).join(
    ', '
  ) +
  ', ' +
  Array.from({ length: 17 }, (_, index) => `double${String(index + 1)}`).join(
    ', '
  );

/**
 * The latest events a person would want to see, newest first. A room
 * restored (woken from sleep) is routine, not news, and is left out.
 */
const latestEvents = (dataset: string, from: number): string => `
SELECT ${COLUMNS}
FROM ${dataset}
WHERE ${since(from)} AND (
  index1 IN ('failure', 'limited')
  OR (index1 = 'room' AND ${room('outcome')} != 'restored')
  OR (index1 = 'admission' AND ${admission('outcome')} = 'accepted'
      AND ${admission('operation')} IN ('hello_ticket', 'code_join', 'room_open', 'invitation_issue'))
  OR (index1 = 'admission' AND ${admission('outcome')} != 'accepted')
  OR (index1 = 'page' AND (${page('sequence')} = 0 OR ${page('errors')} > 0))
  OR (index1 = 'http' AND ${http('status')} >= 500)
  OR (index1 = 'move' AND ${move('outcome')} = 'failed')
)
ORDER BY timestamp DESC LIMIT 60`;

/** The latest things that went wrong, newest first. */
const latestTrouble = (dataset: string, from: number): string => `
SELECT ${COLUMNS}
FROM ${dataset}
WHERE ${since(from)} AND (
  index1 IN ('failure', 'limited')
  OR (index1 = 'page' AND ${page('errors')} > 0)
  OR (index1 = 'http' AND ${http('status')} >= 500)
  OR (index1 = 'move' AND ${move('outcome')} != 'accepted')
  OR (index1 = 'admission' AND ${admission('outcome')} IN ('failed', 'rate_limited'))
)
ORDER BY timestamp DESC LIMIT 80`;

const errorSignatures = (dataset: string, from: number): string => `
SELECT ${page('error')} AS error,
  SUM(${W}) AS reports,
  ${sumOf(page('errors'))} AS errors,
  min(timestamp) AS first,
  max(timestamp) AS last,
  topK(3)(${page('browser')}) AS browsers,
  topK(3)(${page('os')}) AS systems,
  topK(3)(blob2) AS builds
FROM ${dataset}
WHERE index1 = 'page' AND ${page('error')} != '' AND ${since(from)}
GROUP BY error ORDER BY reports DESC LIMIT 40`;

const failuresBy = (dataset: string, from: number): string => `
SELECT ${failure('subsystem')} AS subsystem, ${failure('source')} AS source,
  SUM(${W}) AS n, ${countWhere(`${failure('retryable')} = 1`)} AS retryable,
  max(timestamp) AS last, topK(3)(blob2) AS builds
FROM ${dataset}
WHERE index1 = 'failure' AND ${since(from)}
GROUP BY subsystem, source ORDER BY n DESC LIMIT 40`;

const httpErrors = (dataset: string, from: number): string => `
SELECT ${http('route')} AS route, ${http('status')} AS status,
  SUM(${W}) AS n, max(timestamp) AS last
FROM ${dataset}
WHERE index1 = 'http' AND ${http('status')} >= 400 AND ${since(from)}
GROUP BY route, status ORDER BY n DESC LIMIT 40`;

const moveRefusals = (dataset: string, from: number): string => `
SELECT ${move('commandType')} AS type, ${move('outcome')} AS outcome,
  ${move('reason')} AS reason, SUM(${MOVE_W}) AS n, max(timestamp) AS last
FROM ${dataset}
WHERE index1 = 'move' AND ${move('outcome')} != 'accepted' AND ${since(from)}
GROUP BY type, outcome, reason ORDER BY n DESC LIMIT 40`;

const admissionRefusals = (dataset: string, from: number): string => `
SELECT ${admission('operation')} AS operation, ${admission('outcome')} AS outcome,
  ${admission('reason')} AS reason, ${admission('role')} AS role,
  SUM(${W}) AS n, max(timestamp) AS last
FROM ${dataset}
WHERE index1 = 'admission' AND ${admission('outcome')} != 'accepted' AND ${since(from)}
GROUP BY operation, outcome, reason, role ORDER BY n DESC LIMIT 40`;

const socketCloses = (dataset: string, from: number): string => `
SELECT ${socket('outcome')} AS outcome, ${socket('closeCode')} AS code, SUM(${W}) AS n
FROM ${dataset}
WHERE index1 = 'socket' AND ${socket('outcome')} != 'upgraded' AND ${since(from)}
GROUP BY outcome, code ORDER BY n DESC LIMIT 30`;

const limitedBy = (dataset: string, from: number): string => `
SELECT ${limited('operation')} AS operation, SUM(${W}) AS n, max(timestamp) AS last
FROM ${dataset}
WHERE index1 = 'limited' AND ${since(from)}
GROUP BY operation ORDER BY n DESC LIMIT 20`;

/** Rows written to a dataset a day: the analytics' own daily allowance. */
const eventsDaily = (dataset: string, from: number): string => `
SELECT ${DAY} AS t, count() AS rows
FROM ${dataset}
WHERE ${since(from)}
GROUP BY t ORDER BY t`;

/** GraphQL's date windows: at most 31 days each. */
const dateWindows = (
  from: number,
  now: number
): readonly (readonly [string, string])[] => {
  const windows: (readonly [string, string])[] = [];
  for (let start = startOfUtcDay(from); start <= now; start += 31 * DAY_MS) {
    const end = Math.min(start + 30 * DAY_MS, startOfUtcDay(now));
    windows.push([isoDate(start), isoDate(end)]);
  }
  return windows;
};

const ACCOUNT = '$accountTag: string!';

/** The account's Worker and Durable Object use, by day, in date windows. */
const usageDaily = (
  from: number,
  now: number
): { query: string; variables: Record<string, unknown> } => {
  const windows = dateWindows(from, now);
  const variables: Record<string, unknown> = {};
  const fields = windows.map(([start, end], index) => {
    variables[`from${String(index)}`] = start;
    variables[`to${String(index)}`] = end;
    const range = `{date_geq: $from${String(index)}, date_leq: $to${String(index)}}`;
    return `
      workers${String(index)}: workersInvocationsAdaptive(limit: 2000, filter: ${range}) {
        sum { requests errors subrequests cpuTimeUs }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { date scriptName }
      }
      invocations${String(index)}: durableObjectsInvocationsAdaptiveGroups(limit: 4000, filter: ${range}) {
        sum { requests errors }
        dimensions { date namespaceId scriptName }
      }
      periodic${String(index)}: durableObjectsPeriodicGroups(limit: 4000, filter: ${range}) {
        sum { activeTime cpuTime duration rowsRead rowsWritten inboundWebsocketMsgCount outboundWebsocketMsgCount }
        dimensions { date namespaceId }
      }
      storage${String(index)}: durableObjectsStorageGroups(limit: 2000, filter: ${range}) {
        max { storedBytes }
        dimensions { date }
      }`;
  });
  const declared = windows
    .map(
      (_, index) => `, $from${String(index)}: Date!, $to${String(index)}: Date!`
    )
    .join('');
  return {
    query: `query (${ACCOUNT}${declared}) { viewer { accounts(filter: {accountTag: $accountTag}) {${fields.join('\n')}
    } } }`,
    variables,
  };
};

/** Today's use by the hour, for how the day is going and where it ends. */
const usageToday = (
  now: number
): { query: string; variables: Record<string, unknown> } => ({
  query: `query (${ACCOUNT}, $from: Time!, $to: Time!) { viewer { accounts(filter: {accountTag: $accountTag}) {
    workers: workersInvocationsAdaptive(limit: 2000, filter: {datetime_geq: $from, datetime_leq: $to}) {
      sum { requests errors }
      dimensions { datetimeHour scriptName }
    }
    invocations: durableObjectsInvocationsAdaptiveGroups(limit: 4000, filter: {datetime_geq: $from, datetime_leq: $to}) {
      sum { requests }
      dimensions { datetimeHour scriptName namespaceId }
    }
    periodic: durableObjectsPeriodicGroups(limit: 4000, filter: {datetime_geq: $from, datetime_leq: $to}) {
      sum { duration rowsRead rowsWritten }
      dimensions { datetimeHour namespaceId }
    }
  } } }`,
  variables: {
    // Yesterday too: "by this time yesterday".
    from: new Date(startOfUtcDay(now) - DAY_MS).toISOString(),
    to: new Date(now).toISOString(),
  },
});

/** One Worker's requests and failures by day. */
const workerDaily = (
  script: string,
  from: number,
  now: number
): { query: string; variables: Record<string, unknown> } => {
  const windows = dateWindows(from, now);
  const variables: Record<string, unknown> = { script };
  const fields = windows.map(([start, end], index) => {
    variables[`from${String(index)}`] = start;
    variables[`to${String(index)}`] = end;
    return `
      w${String(index)}: workersInvocationsAdaptive(limit: 2000, filter: {date_geq: $from${String(index)}, date_leq: $to${String(index)}, scriptName: $script}) {
        sum { requests errors subrequests cpuTimeUs }
        quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 }
        dimensions { date status }
      }`;
  });
  const declared = windows
    .map(
      (_, index) => `, $from${String(index)}: Date!, $to${String(index)}: Date!`
    )
    .join('');
  return {
    query: `query (${ACCOUNT}, $script: string${declared}) { viewer { accounts(filter: {accountTag: $accountTag}) {${fields.join('\n')}
    } } }`,
    variables,
  };
};

/**
 * The zone's own count of the beta's traffic: every request to its host,
 * visits, countries, devices and browsers. It goes back 31 days on the
 * Free plan, so it has history from before the site counted its own.
 */
const zoneTraffic = (
  zoneHost: string,
  from: number,
  now: number
): { query: string; variables: Record<string, unknown> } => {
  // Thirty days at most, within the zone's 31.
  const start = Math.max(from, startOfUtcDay(now) - 29 * DAY_MS);
  const filter =
    '{date_geq: $from, date_leq: $to, clientRequestHTTPHost: $host, requestSource: "eyeball"}';
  const by = (dimension: string) => `
      ${dimension}: httpRequestsAdaptiveGroups(limit: 15, filter: ${filter}, orderBy: [sum_visits_DESC]) {
        count sum { visits }
        dimensions { ${dimension} }
      }`;
  return {
    query: `query ($zoneTag: string!, $host: string!, $from: Date!, $to: Date!) { viewer { zones(filter: {zoneTag: $zoneTag}) {
      daily: httpRequestsAdaptiveGroups(limit: 100, filter: ${filter}, orderBy: [date_ASC]) {
        count sum { visits edgeResponseBytes }
        dimensions { date }
      }
      statuses: httpRequestsAdaptiveGroups(limit: 40, filter: ${filter}, orderBy: [count_DESC]) {
        count dimensions { edgeResponseStatus }
      }
      ${by('clientCountryName')}
      ${by('clientDeviceType')}
      ${by('userAgentBrowser')}
      ${by('userAgentOS')}
    } } }`,
    variables: { host: zoneHost, from: isoDate(start), to: isoDate(now) },
  };
};

const graphql = (
  built: { query: string; variables: Record<string, unknown> },
  config: AccountConfig
): SourceQuery => ({
  kind: 'graphql',
  query: built.query,
  variables: {
    accountTag: config.accountId,
    zoneTag: config.zoneId,
    ...built.variables,
  },
});

const deployments = (config: AccountConfig, script: string): SourceQuery => ({
  kind: 'rest',
  path: `/accounts/${config.accountId}/workers/scripts/${script}/deployments`,
});

/** The queries a view runs, by the name its rows come back under. */
export const viewQueries = (
  request: ViewRequest,
  config: AccountConfig
): Readonly<Record<string, SourceQuery>> => {
  const site = SITE[request.env];
  const ae = (sql: string): SourceQuery => ({ kind: 'ae', sql: sql.trim() });
  const from = seriesStart(request.now, request.days);
  const rangeFrom = startOfUtcDay(request.now) - (request.days - 1) * DAY_MS;
  const dataset = site.dataset;
  switch (request.view) {
    case 'overview':
      return {
        pagesDaily: ae(pagesDaily(dataset, from)),
        speedDaily: ae(speedDaily(dataset, from)),
        byCountry: ae(pagesBy(dataset, rangeFrom, 'blob3')),
        byDevice: ae(pagesBy(dataset, rangeFrom, page('device'))),
        byBrowser: ae(pagesBy(dataset, rangeFrom, page('browser'))),
        byOs: ae(pagesBy(dataset, rangeFrom, page('os'))),
        byLanguage: ae(pagesBy(dataset, rangeFrom, page('language'))),
        byReferrer: ae(pagesBy(dataset, rangeFrom, page('referrer'))),
        byLanding: ae(pagesBy(dataset, rangeFrom, page('landing'))),
        roomsDaily: ae(roomsDaily(dataset, from)),
        roomSizes: ae(roomSizes(dataset, rangeFrom)),
        admissionsDaily: ae(admissionsDaily(dataset, from)),
        movesDaily: ae(movesDaily(dataset, from)),
        moveTypes: ae(moveTypes(dataset, rangeFrom)),
        httpRoutes: ae(httpRoutes(dataset, rangeFrom)),
        troubleDaily: ae(troubleDaily(dataset, from)),
        worker: graphql(workerDaily(site.script, from, request.now), config),
        ...(site.zoneHost
          ? {
              zone: graphql(
                zoneTraffic(site.zoneHost, rangeFrom, request.now),
                config
              ),
            }
          : {}),
        deployments: deployments(config, site.script),
      };
    case 'live': {
      const dayAgo = request.now - 24 * HOUR_MS;
      return {
        hourly: ae(liveHourly(dataset, startOfUtcDay(request.now) - DAY_MS)),
        latest: ae(latestEvents(dataset, dayAgo)),
        usageToday: graphql(usageToday(request.now), config),
        eventsToday: ae(
          eventsDaily(dataset, startOfUtcDay(request.now) - DAY_MS)
        ),
        otherEventsToday: ae(
          eventsDaily(
            SITE[request.env === 'beta' ? 'preview' : 'beta'].dataset,
            startOfUtcDay(request.now) - DAY_MS
          )
        ),
        betaHealth: { kind: 'probe', url: `${SITE.beta.origin}/v2/health` },
        previewHealth: {
          kind: 'probe',
          url: `${SITE.preview.origin}/v2/health`,
        },
        v1Health: { kind: 'probe', url: 'https://ptcgsim.online/' },
        deployments: deployments(config, site.script),
      };
    }
    case 'budget':
      return {
        usage: graphql(usageDaily(from, request.now), config),
        usageToday: graphql(usageToday(request.now), config),
        namespaces: {
          kind: 'rest',
          path: `/accounts/${config.accountId}/workers/durable_objects/namespaces?per_page=100`,
        },
        betaEvents: ae(eventsDaily(SITE.beta.dataset, from)),
        previewEvents: ae(eventsDaily(SITE.preview.dataset, from)),
      };
    case 'errors':
      return {
        troubleDaily: ae(troubleDaily(dataset, from)),
        latest: ae(latestTrouble(dataset, rangeFrom)),
        signatures: ae(errorSignatures(dataset, rangeFrom)),
        failures: ae(failuresBy(dataset, rangeFrom)),
        httpErrors: ae(httpErrors(dataset, rangeFrom)),
        moveRefusals: ae(moveRefusals(dataset, rangeFrom)),
        admissionRefusals: ae(admissionRefusals(dataset, rangeFrom)),
        socketCloses: ae(socketCloses(dataset, rangeFrom)),
        limited: ae(limitedBy(dataset, rangeFrom)),
        worker: graphql(workerDaily(site.script, from, request.now), config),
        deployments: deployments(config, site.script),
      };
  }
};
