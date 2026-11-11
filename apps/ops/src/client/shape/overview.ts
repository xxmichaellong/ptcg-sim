import type { ViewResponse } from '../../shared/api.js';
import { countryName, languageName } from '../format.js';
import {
  daysBetween,
  dailyLevel,
  dailySum,
  dataOf,
  graphqlRows,
  graphqlScope,
  headline,
  isoDay,
  lastDays,
  measured,
  num,
  path,
  problemOf,
  ratio,
  rowsOf,
  str,
  sum,
  type Headline,
  type Rows,
  type Sources,
} from './common.js';

/**
 * The Overview: who plays, how much, how fast and what goes wrong, for one
 * environment over the chosen range.
 */

const DAY_MS = 86_400_000;

export type Unit = 'count' | 'ms' | 'percent' | 'decimal' | 'bytes' | 'unitless';

export interface Series {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
}

export interface DailyChart {
  readonly days: readonly string[];
  readonly series: readonly Series[];
  readonly unit: Unit;
}

export interface PulseTile {
  readonly id: string;
  readonly label: string;
  readonly info: string;
  readonly unit: Unit;
  readonly headline: Headline;
  readonly trend: readonly (number | null)[];
  /** Why there is no figure: its source couldn't be read. */
  readonly unavailable?: string;
}

export interface DimensionRow {
  readonly key: string;
  readonly label: string;
  readonly views: number;
  readonly share: number;
  readonly players: number;
  readonly table75: number | null;
  readonly heartbeat50: number | null;
}

export type Rating = 'good' | 'fair' | 'poor';

export interface Vital {
  readonly id: string;
  readonly label: string;
  readonly info: string;
  readonly unit: Unit;
  readonly value: number | null;
  readonly rating: Rating | null;
  readonly samples: number;
}

/** Core Web Vitals' thresholds at the 75th percentile; time to table is ours. */
const VITALS: readonly {
  readonly id: string;
  readonly label: string;
  readonly info: string;
  readonly unit: Unit;
  readonly good: number;
  readonly poor: number;
  readonly value: string;
  readonly samples: string;
}[] = [
  { id: 'table', label: 'Time to table', info: 'From asking for the page until the table is seen and the loading screen lifts. The site’s own measure of a load.', unit: 'ms', good: 3_000, poor: 6_000, value: 'table75', samples: 'tableN' },
  { id: 'inp', label: 'Responsiveness (INP)', info: 'Interaction to Next Paint: how long the slowest taps, clicks and keys wait for the screen to answer.', unit: 'ms', good: 200, poor: 500, value: 'inp75', samples: 'inpN' },
  { id: 'ttfb', label: 'First byte (TTFB)', info: 'Time to First Byte: until the page itself starts arriving.', unit: 'ms', good: 800, poor: 1_800, value: 'ttfb75', samples: 'ttfbN' },
  { id: 'fcp', label: 'First paint (FCP)', info: 'First Contentful Paint: until anything is drawn (the loading screen).', unit: 'ms', good: 1_800, poor: 3_000, value: 'fcp75', samples: 'fcpN' },
  { id: 'lcp', label: 'Largest paint (LCP)', info: 'Largest Contentful Paint: until the biggest thing is drawn, before the player acts.', unit: 'ms', good: 2_500, poor: 4_000, value: 'lcp75', samples: 'lcpN' },
  { id: 'cls', label: 'Layout shift (CLS)', info: 'Cumulative Layout Shift: how much the page jumps while it is used. Unitless.', unit: 'unitless', good: 0.1, poor: 0.25, value: 'cls75', samples: 'clsN' },
];

export const rate = (value: number | null, good: number, poor: number): Rating | null =>
  value === null ? null : value <= good ? 'good' : value <= poor ? 'fair' : 'poor';

export interface Release {
  readonly at: number;
  readonly id: string;
}

export interface Problem {
  readonly source: string;
  readonly reason: 'unconfigured' | 'unauthorized' | 'failed';
  readonly message: string;
}

export interface OverviewModel {
  /** The range's days, oldest first; the last is today (partial). */
  readonly days: readonly string[];
  readonly pulse: readonly PulseTile[];
  readonly players: {
    readonly daily: DailyChart;
    readonly totals: {
      readonly views: number;
      readonly players: number;
      readonly newPlayers: number;
      readonly returningShare: number | null;
      readonly weeklyPlayers: number | null;
      readonly minutesPerPlayer: number | null;
      readonly movesPerPlayer: number | null;
      readonly onlineShare: number | null;
    };
  };
  readonly dimensions: Readonly<
    Record<'country' | 'device' | 'browser' | 'os' | 'language' | 'referrer' | 'landing', readonly DimensionRow[]>
  >;
  readonly games: {
    readonly started: DailyChart;
    readonly moves: DailyChart;
    readonly joins: DailyChart;
    readonly totals: {
      readonly solo: number;
      readonly online: number;
      readonly openedOnline: number;
      readonly codeJoins: number;
      readonly spectators: number;
      readonly invites: number;
    };
    readonly sizes: readonly {
      readonly mode: string;
      readonly rooms: number;
      readonly median: number | null;
      readonly p90: number | null;
      readonly untouchedShare: number | null;
    }[];
  };
  readonly speed: {
    readonly table: DailyChart;
    readonly vitals: readonly Vital[];
    readonly roundTrip: DailyChart;
    readonly server: DailyChart;
    readonly phases: readonly { readonly id: string; readonly label: string; readonly ms: number }[];
    readonly types: readonly {
      readonly type: string;
      readonly moves: number;
      readonly server50: number | null;
      readonly server95: number | null;
      readonly publicationBytes: number | null;
    }[];
    readonly routes: readonly {
      readonly route: string;
      readonly requests: number;
      readonly p50: number | null;
      readonly p95: number | null;
      readonly failed: number;
      readonly refused: number;
      readonly limited: number;
    }[];
  };
  readonly reliability: {
    readonly daily: DailyChart;
    readonly totals: {
      readonly visitsWithErrors: number | null;
      readonly droppedShare: number | null;
      readonly reconnectsPerVisit: number | null;
      readonly rejectedShare: number | null;
      readonly limited: number;
      readonly workerExceptions: number;
    };
  };
  readonly traffic?: {
    readonly daily: DailyChart;
    readonly totals: { readonly requests: number; readonly visits: number; readonly bytes: number };
    readonly statuses: readonly { readonly status: number; readonly requests: number }[];
    readonly countries: readonly DimensionRow[];
    readonly devices: readonly DimensionRow[];
    readonly browsers: readonly DimensionRow[];
  };
  readonly worker: DailyChart;
  readonly releases: readonly Release[];
  readonly problems: Readonly<Record<string, Problem>>;
}

const dimension = (
  rows: Rows | undefined,
  label: (key: string) => string
): readonly DimensionRow[] => {
  const list = rows ?? [];
  const total = list.reduce((all, row) => all + num(row.views), 0);
  return list.map((row) => {
    const key = str(row.key);
    return {
      key,
      label: label(key),
      views: num(row.views),
      share: total > 0 ? num(row.views) / total : 0,
      players: num(row.players),
      table75: measured(row.table75, row.tableN),
      heartbeat50: measured(row.heartbeat50, row.heartbeatN),
    };
  });
};

const LANDING_LABELS: Readonly<Record<string, string>> = {
  solo: 'Straight to the Solo table',
  lobby: 'Play online',
  invite: 'An invite link',
  room_code: 'A room code link',
};
const DEVICE_LABELS: Readonly<Record<string, string>> = {
  desktop: 'Desktop',
  mobile: 'Phone',
  tablet: 'Tablet',
};

/** Deployments, newest first, from the deployments API's result. */
export const releasesOf = (data: unknown): readonly Release[] => {
  const list = (data as { deployments?: unknown } | null)?.deployments;
  if (!Array.isArray(list)) return [];
  return list
    .map((item: Record<string, unknown>) => ({
      at: Date.parse(str(item.created_on)),
      id: str(item.id),
    }))
    .filter((release) => Number.isFinite(release.at))
    .sort((left, right) => right.at - left.at);
};

export const problemsOf = (sources: Sources): Readonly<Record<string, Problem>> =>
  Object.fromEntries(
    Object.keys(sources).flatMap((name) => {
      const problem = problemOf(sources, name);
      return problem
        ? [[name, { source: name, reason: problem.reason, message: problem.message }]]
        : [];
    })
  );

/**
 * The Worker statuses that are faults. `clientDisconnected` is a visitor
 * leaving mid-request, as every room connection ends, and is not one.
 */
export const WORKER_FAULTS: ReadonlySet<string> = new Set(['scriptThrewException', 'exceededResources', 'internalError']);

const PHASES = [
  ['authorityMs', 'Rules'],
  ['projectionMs', 'Each player’s view'],
  ['persistenceMs', 'Saving'],
  ['serializationMs', 'Packing'],
  ['sendMs', 'Sending'],
] as const;

export const shapeOverview = (response: ViewResponse): OverviewModel => {
  const { sources } = response;
  const allDays = daysBetween(
    response.asOf - (Math.max(response.days, 14) - 1) * DAY_MS,
    response.asOf
  );
  const days = lastDays(allDays, response.days);
  const inRange = <T>(values: readonly T[]) => lastDays(values, response.days);

  const pages = rowsOf(sources, 'pagesDaily');
  const players = dailySum(pages, allDays, (row) => num(row.players));
  const newPlayers = dailySum(pages, allDays, (row) => num(row.newPlayers));
  const views = dailySum(pages, allDays, (row) => num(row.views));
  const reports = dailySum(pages, allDays, (row) => num(row.reports));
  const reportsWithErrors = dailySum(pages, allDays, (row) => num(row.reportsWithErrors));
  const reconnects = dailySum(pages, allDays, (row) => num(row.reconnects));
  const visibleMs = dailySum(pages, allDays, (row) => num(row.visibleMs));
  const pageMoves = dailySum(pages, allDays, (row) => num(row.moves));
  const weekFirsts = dailySum(pages, allDays, (row) => num(row.weekFirsts));
  const onlineReports = dailySum(pages, allDays, (row) => num(row.onlineReports));
  const soloReports = dailySum(pages, allDays, (row) => num(row.soloReports));

  const speed = rowsOf(sources, 'speedDaily');
  const level = (value: string, samples: string) =>
    dailyLevel(speed, allDays, (row) => measured(row[value], row[samples]));
  const table50 = level('table50', 'tableN');
  const table75 = level('table75', 'tableN');
  const table95 = level('table95', 'tableN');
  const move50 = level('move50', 'moveN');
  const move90 = level('move90', 'moveN');
  const heartbeat50 = level('heartbeat50', 'heartbeatN');

  const rooms = rowsOf(sources, 'roomsDaily');
  const created = (mode: string) =>
    dailySum(rooms, allDays, (row) =>
      str(row.outcome) === 'created' && str(row.mode) === mode ? num(row.rooms) : 0
    );
  const solo = created('solo');
  const online = created('multiplayer');
  const games = solo.map((value, index) => value + (online[index] ?? 0));

  const admissions = rowsOf(sources, 'admissionsDaily');
  const admitted = (operation: string, role?: string) =>
    dailySum(admissions, allDays, (row) =>
      str(row.operation) === operation &&
      str(row.outcome) === 'accepted' &&
      (role === undefined || str(row.role) === role)
        ? num(row.n)
        : 0
    );
  const joinsPlayers = admitted('hello_ticket', 'player');
  const joinsSpectators = admitted('hello_ticket', 'spectator');

  const movesRows = rowsOf(sources, 'movesDaily');
  const accepted = dailySum(movesRows, allDays, (row) =>
    str(row.outcome) === 'accepted' ? num(row.moves) : 0
  );
  const allMoves = dailySum(movesRows, allDays, (row) => num(row.moves));
  const rejected = dailySum(movesRows, allDays, (row) =>
    str(row.outcome) === 'rejected' ? num(row.moves) : 0
  );
  const serverLevel = (field: string) =>
    dailyLevel(
      (movesRows ?? []).filter((row) => str(row.outcome) === 'accepted'),
      allDays,
      (row) => measured(row[field], row.moves)
    );

  const trouble = rowsOf(sources, 'troubleDaily');
  const troubleOf = (field: string) => dailySum(trouble, allDays, (row) => num(row[field]));
  const pageErrors = troubleOf('pageErrors');
  const failures = troubleOf('failures');
  const serverErrors = troubleOf('serverErrors');
  const movesFailed = troubleOf('movesFailed');
  const dropped = troubleOf('dropped');
  const connections = troubleOf('connections');
  const limitedDaily = troubleOf('limited');

  const workerScope = graphqlScope(dataOf(sources, 'worker'), 'accounts');
  const workerRows = graphqlRows(workerScope, 'w');
  // GraphQL rows carry their date under dimensions.
  const withDate: Rows = workerRows.map((row) => ({ ...row, __date: str(path(row, 'dimensions', 'date')) }));
  const workerRequests = dailySum(withDate, allDays, (row) => num(path(row, 'sum', 'requests')), '__date');
  const workerExceptions = dailySum(
    withDate,
    allDays,
    (row) => (WORKER_FAULTS.has(str(path(row, 'dimensions', 'status'))) ? num(path(row, 'sum', 'requests')) : 0),
    '__date'
  );

  const rangeSum = (values: readonly number[]) => sum(inRange(values));
  const totalViews = rangeSum(views);
  const totalPlayers = rangeSum(players);
  const totalNew = rangeSum(newPlayers);
  const rangeWeeks = Math.max(1, response.days / 7);

  const tiles: PulseTile[] = [
    {
      id: 'players',
      label: 'Daily players',
      info: 'Browsers that opened the site that UTC day, each counted once a day.',
      unit: 'count',
      headline: headline(players, 'up'),
      trend: inRange(players),
    },
    {
      id: 'new',
      label: 'New players',
      info: 'First visit ever from that browser.',
      unit: 'count',
      headline: headline(newPlayers, 'up'),
      trend: inRange(newPlayers),
    },
    {
      id: 'games',
      label: 'Games a day',
      info: 'Rooms made, Solo and online.',
      unit: 'count',
      headline: headline(games, 'up'),
      trend: inRange(games),
    },
    {
      id: 'moves',
      label: 'Moves a day',
      info: 'Moves the rooms accepted (counted from a sample of one in four).',
      unit: 'count',
      headline: headline(accepted, 'up'),
      trend: inRange(accepted),
    },
    {
      id: 'table',
      label: 'Time to table',
      info: 'How long most loads take (75th percentile): from asking for the page until the table is seen.',
      unit: 'ms',
      headline: headline(table75, 'down'),
      trend: inRange(table75),
    },
    {
      id: 'errors',
      label: 'Visits with errors',
      info: 'Share of page reports that saw a script error.',
      unit: 'percent',
      headline: headline(reportsWithErrors, 'down', reports),
      trend: inRange(reports.map((total, index) => ratio(reportsWithErrors[index] ?? 0, total))),
    },
  ];

  // A tile whose source couldn't be read says so rather than show zero.
  const TILE_SOURCES: Readonly<Record<string, string>> = {
    players: 'pagesDaily',
    new: 'pagesDaily',
    games: 'roomsDaily',
    moves: 'movesDaily',
    table: 'speedDaily',
    errors: 'pagesDaily',
  };
  const pulse: readonly PulseTile[] = tiles.map((tile) => {
    const problem = problemOf(sources, TILE_SOURCES[tile.id] ?? '');
    return problem ? { ...tile, unavailable: problem.reason === 'failed' ? 'Couldn’t load' : 'Needs the API token' } : tile;
  });
  const speedRows = speed ?? [];
  const recentSpeed = speedRows.filter((row) => days.slice(-8, -1).includes(str(row.t).slice(0, 10)));
  const vitals: Vital[] = VITALS.map((vital) => {
    // The last seven complete days' days, weighted by their samples.
    let weighted = 0;
    let samples = 0;
    for (const row of recentSpeed) {
      const value = measured(row[vital.value], row[vital.samples]);
      if (value === null) continue;
      weighted += value * num(row[vital.samples]);
      samples += num(row[vital.samples]);
    }
    const value = samples > 0 ? weighted / samples : null;
    return {
      id: vital.id,
      label: vital.label,
      info: vital.info,
      unit: vital.unit,
      value,
      rating: rate(value, vital.good, vital.poor),
      samples,
    };
  });

  const types = (rowsOf(sources, 'moveTypes') ?? []).map((row) => ({
    type: str(row.type),
    moves: num(row.moves),
    server50: measured(row.server50, row.moves),
    server95: measured(row.server95, row.moves),
    publicationBytes: measured(row.publicationBytes, row.moves),
  }));
  const typeRows = rowsOf(sources, 'moveTypes') ?? [];
  const typeMoves = typeRows.reduce((total, row) => total + num(row.moves), 0);
  const phases = PHASES.map(([id, label]) => ({
    id,
    label,
    ms:
      typeMoves > 0
        ? typeRows.reduce((total, row) => total + num(row[id]) * num(row.moves), 0) / typeMoves
        : 0,
  }));

  const sizes = (rowsOf(sources, 'roomSizes') ?? []).map((row) => ({
    mode: str(row.mode),
    rooms: num(row.rooms),
    median: measured(row.moves50, row.rooms),
    p90: measured(row.moves90, row.rooms),
    untouchedShare: ratio(num(row.untouched), num(row.rooms)),
  }));

  const zoneScope = graphqlScope(dataOf(sources, 'zone'), 'zones');
  let traffic: OverviewModel['traffic'];
  if (zoneScope) {
    const daily: Rows = graphqlRows(zoneScope, 'daily').map((row) => ({
      ...row,
      __date: str(path(row, 'dimensions', 'date')),
    }));
    const zoneDays = days;
    const zoneDimension = (name: string, label: (key: string) => string): readonly DimensionRow[] => {
      const rows = graphqlRows(zoneScope, name).filter((row) => num(path(row, 'sum', 'visits')) > 0);
      const total = rows.reduce((all, row) => all + num(path(row, 'sum', 'visits')), 0);
      return rows.map((row) => {
        const key = str(path(row, 'dimensions', name));
        return {
          key,
          label: label(key),
          views: num(path(row, 'sum', 'visits')),
          share: total > 0 ? num(path(row, 'sum', 'visits')) / total : 0,
          players: num(row.count),
          table75: null,
          heartbeat50: null,
        };
      });
    };
    traffic = {
      daily: {
        days: zoneDays,
        unit: 'count',
        series: [
          { id: 'visits', label: 'Visits', values: dailySum(daily, zoneDays, (row) => num(path(row, 'sum', 'visits')), '__date') },
        ],
      },
      totals: {
        requests: daily.reduce((all, row) => all + num(row.count), 0),
        visits: daily.reduce((all, row) => all + num(path(row, 'sum', 'visits')), 0),
        bytes: daily.reduce((all, row) => all + num(path(row, 'sum', 'edgeResponseBytes')), 0),
      },
      statuses: graphqlRows(zoneScope, 'statuses')
        .map((row) => ({
          status: num(path(row, 'dimensions', 'edgeResponseStatus')),
          requests: num(row.count),
        }))
        .sort((left, right) => right.requests - left.requests),
      countries: zoneDimension('clientCountryName', countryName),
      devices: zoneDimension('clientDeviceType', (key) => DEVICE_LABELS[key] ?? key),
      browsers: zoneDimension('userAgentBrowser', (key) => key || 'Unknown'),
    };
  }

  return {
    days,
    pulse,
    players: {
      daily: {
        days,
        unit: 'count',
        series: [
          { id: 'players', label: 'Players', values: inRange(players) },
          { id: 'new', label: 'New', values: inRange(newPlayers) },
        ],
      },
      totals: {
        views: totalViews,
        players: totalPlayers,
        newPlayers: totalNew,
        returningShare: ratio(totalPlayers - totalNew, totalPlayers),
        weeklyPlayers: rangeSum(weekFirsts) / rangeWeeks || null,
        minutesPerPlayer: ratio(rangeSum(visibleMs) / 60_000, totalPlayers),
        movesPerPlayer: ratio(rangeSum(pageMoves), totalPlayers),
        onlineShare: ratio(rangeSum(onlineReports), rangeSum(onlineReports) + rangeSum(soloReports)),
      },
    },
    dimensions: {
      country: dimension(rowsOf(sources, 'byCountry'), countryName),
      device: dimension(rowsOf(sources, 'byDevice'), (key) => DEVICE_LABELS[key] ?? key),
      browser: dimension(rowsOf(sources, 'byBrowser'), (key) => key || 'Unknown'),
      os: dimension(rowsOf(sources, 'byOs'), (key) => key || 'Unknown'),
      language: dimension(rowsOf(sources, 'byLanguage'), languageName),
      referrer: dimension(rowsOf(sources, 'byReferrer'), (key) =>
        key === '' ? 'Direct or unknown' : key === 'ptcgsim.online' ? 'ptcgsim.online (v1)' : key
      ),
      landing: dimension(rowsOf(sources, 'byLanding'), (key) => LANDING_LABELS[key] ?? key),
    },
    games: {
      started: {
        days,
        unit: 'count',
        series: [
          { id: 'solo', label: 'Solo', values: inRange(solo) },
          { id: 'online', label: 'Online', values: inRange(online) },
        ],
      },
      moves: {
        days,
        unit: 'count',
        series: [{ id: 'moves', label: 'Moves', values: inRange(accepted) }],
      },
      joins: {
        days,
        unit: 'count',
        series: [
          { id: 'players', label: 'Players', values: inRange(joinsPlayers) },
          { id: 'spectators', label: 'Spectators', values: inRange(joinsSpectators) },
        ],
      },
      totals: {
        solo: rangeSum(solo),
        online: rangeSum(online),
        openedOnline: rangeSum(admitted('room_open')),
        codeJoins: rangeSum(admitted('code_join')),
        spectators: rangeSum(joinsSpectators),
        invites: rangeSum(admitted('invitation_issue')),
      },
      sizes,
    },
    speed: {
      table: {
        days,
        unit: 'ms',
        series: [
          { id: 'p50', label: 'Median', values: inRange(table50) },
          { id: 'p75', label: '75th percentile', values: inRange(table75) },
          { id: 'p95', label: '95th percentile', values: inRange(table95) },
        ],
      },
      vitals,
      roundTrip: {
        days,
        unit: 'ms',
        series: [
          { id: 'move50', label: 'Move, median', values: inRange(move50) },
          { id: 'move90', label: 'Move, slowest 10%', values: inRange(move90) },
          { id: 'heartbeat50', label: 'Connection, median', values: inRange(heartbeat50) },
        ],
      },
      server: {
        days,
        unit: 'ms',
        series: [
          { id: 'server50', label: 'Median', values: inRange(serverLevel('server50')) },
          { id: 'server95', label: '95th percentile', values: inRange(serverLevel('server95')) },
        ],
      },
      phases,
      types,
      routes: (rowsOf(sources, 'httpRoutes') ?? []).map((row) => ({
        route: str(row.route),
        requests: num(row.requests),
        p50: measured(row.p50, row.requests),
        p95: measured(row.p95, row.requests),
        failed: num(row.failed),
        refused: num(row.refused),
        limited: num(row.limited),
      })),
    },
    reliability: {
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
      totals: {
        visitsWithErrors: ratio(rangeSum(reportsWithErrors), rangeSum(reports)),
        droppedShare: ratio(rangeSum(dropped), rangeSum(connections)),
        reconnectsPerVisit: ratio(rangeSum(reconnects), totalViews),
        rejectedShare: ratio(rangeSum(rejected), rangeSum(allMoves)),
        limited: rangeSum(limitedDaily),
        workerExceptions: rangeSum(workerExceptions),
      },
    },
    ...(traffic ? { traffic } : {}),
    worker: {
      days,
      unit: 'count',
      series: [
        { id: 'requests', label: 'Requests', values: inRange(workerRequests) },
        { id: 'exceptions', label: 'Exceptions', values: inRange(workerExceptions) },
      ],
    },
    releases: releasesOf(dataOf(sources, 'deployments')).filter(
      (release) => isoDay(release.at) >= (days[0] ?? '')
    ),
    problems: problemsOf(sources),
  };
};
