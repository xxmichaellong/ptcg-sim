import {
  analyticsDataPoint,
  ANALYTICS_LAYOUT,
  type AnalyticsKind,
} from '@ptcgsim/protocol';

import type { SourceResult } from './api.js';
import {
  seriesStart,
  sqlTime,
  startOfUtcDay,
  type ViewRequest,
} from './queries.js';
import { SITE } from './site.js';

/**
 * Stand-in rows for every source (OPS_DEMO=on), shaped exactly as
 * Cloudflare returns them, so the dashboard can be built, tested and shown
 * without a token or real traffic. Deterministic: the same day gives the
 * same numbers. The page says "Demo data" while they are shown.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A small, seeded random source (mulberry32). */
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const round = (value: number, places = 0): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Players a day: growing since launch, busier at weekends, a little noisy. */
const dailyPlayers = (day: number, env: ViewRequest['env']): number => {
  const random = seeded(day * 7 + (env === 'beta' ? 1 : 2));
  const launch = Date.UTC(2026, 9, 20) / DAY_MS;
  const age = Math.max(0, day - launch);
  const base = env === 'beta' ? 30 + age * 4.2 : 3 + (age % 5);
  const weekday = new Date(day * DAY_MS).getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1;
  return Math.max(0, Math.round(base * weekend * (0.85 + random() * 0.3)));
};

const days = (request: ViewRequest): readonly number[] => {
  const first = seriesStart(request.now, request.days) / DAY_MS;
  const last = startOfUtcDay(request.now) / DAY_MS;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
};

/** The share of today that has passed: today's rows are partial. */
const dayFraction = (day: number, now: number): number =>
  day === startOfUtcDay(now) / DAY_MS ? (now - day * DAY_MS) / DAY_MS : 1;

const t = (ms: number): string => sqlTime(ms);

const COUNTRIES = [
  ['US', 0.38],
  ['GB', 0.09],
  ['CA', 0.07],
  ['DE', 0.06],
  ['FR', 0.05],
  ['AU', 0.05],
  ['BR', 0.04],
  ['MX', 0.04],
  ['JP', 0.03],
  ['IT', 0.03],
  ['ES', 0.03],
  ['NL', 0.02],
] as const;
const DEVICES = [
  ['desktop', 0.71],
  ['mobile', 0.21],
  ['tablet', 0.08],
] as const;
const BROWSERS = [
  ['Chrome', 0.58],
  ['Safari', 0.17],
  ['Edge', 0.09],
  ['Firefox', 0.07],
  ['Discord', 0.05],
  ['Samsung Internet', 0.03],
  ['Opera', 0.01],
] as const;
const SYSTEMS = [
  ['Windows', 0.52],
  ['macOS', 0.17],
  ['iOS', 0.12],
  ['Android', 0.1],
  ['iPadOS', 0.05],
  ['ChromeOS', 0.02],
  ['Linux', 0.02],
] as const;
const LANGUAGES = [
  ['en', 0.74],
  ['fr', 0.05],
  ['de', 0.05],
  ['es', 0.05],
  ['pt', 0.04],
  ['it', 0.03],
  ['ja', 0.02],
  ['nl', 0.02],
] as const;
const REFERRERS = [
  ['', 0.46],
  ['ptcgsim.online', 0.24],
  ['discord.com', 0.13],
  ['google.com', 0.07],
  ['reddit.com', 0.04],
  ['limitlesstcg.com', 0.03],
  ['youtube.com', 0.02],
  ['twitter.com', 0.01],
] as const;
const LANDINGS = [
  ['solo', 0.62],
  ['invite', 0.17],
  ['room_code', 0.12],
  ['lobby', 0.09],
] as const;

const dimensionRows = (
  shares: readonly (readonly [string, number])[],
  views: number,
  seed: number,
  slow: (key: string) => number = () => 1
): readonly Record<string, unknown>[] => {
  const random = seeded(seed);
  return shares.map(([key, share]) => {
    const n = Math.round(views * share * (0.9 + random() * 0.2));
    return {
      key,
      views: n,
      players: Math.round(n * 0.78),
      table75: round(2_300 * slow(key) * (0.9 + random() * 0.2)),
      tableN: Math.round(n * 0.93),
      heartbeat50: round(48 * slow(key) * (0.85 + random() * 0.3)),
      heartbeatN: Math.round(n * 0.6),
    };
  });
};

const COMMAND_TYPES = [
  ['MoveCards', 0.31],
  ['ApplyCardSteps', 0.18],
  ['DrawCards', 0.11],
  ['SetDamage', 0.09],
  ['FlipCoin', 0.07],
  ['ShuffleZone', 0.06],
  ['PassTurn', 0.05],
  ['SetCondition', 0.04],
  ['AttachCard', 0.04],
  ['RevealCards', 0.03],
  ['Chat', 0.02],
] as const;

const ROUTES = [
  ['admission_ticket', 0.24, 18],
  ['socket_upgrade', 0.22, 9],
  ['room_creation', 0.16, 42],
  ['health', 0.12, 2],
  ['card_catalog', 0.08, 6],
  ['current_decks', 0.06, 5],
  ['room_code', 0.05, 21],
  ['image_serve', 0.03, 11],
  ['room_code_join', 0.02, 25],
  ['account', 0.02, 7],
] as const;

const worker = (request: ViewRequest, script: string): unknown => {
  const rows = days(request).flatMap((day) => {
    const players =
      dailyPlayers(day, request.env) * dayFraction(day, request.now);
    const requests = Math.round(players * 14);
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    const random = seeded(day * 13);
    return [
      {
        dimensions: { date, status: 'success' },
        sum: {
          requests,
          errors: 0,
          subrequests: Math.round(requests * 0.7),
          cpuTimeUs: requests * 1_900,
        },
        quantiles: {
          cpuTimeP50: 1_700,
          cpuTimeP99: 9_800,
          wallTimeP50: 120_000,
          wallTimeP99: 4_200_000,
        },
      },
      ...(random() < 0.35
        ? [
            {
              dimensions: { date, status: 'scriptThrewException' },
              sum: {
                requests: 1 + Math.floor(random() * 3),
                errors: 1,
                subrequests: 0,
                cpuTimeUs: 3_000,
              },
              quantiles: {
                cpuTimeP50: 3_000,
                cpuTimeP99: 3_000,
                wallTimeP50: 3_000,
                wallTimeP99: 3_000,
              },
            },
          ]
        : []),
    ];
  });
  return { viewer: { accounts: [{ w0: rows }] }, script };
};

const zone = (request: ViewRequest): unknown => {
  const recent = days(request).slice(-30);
  const total = recent.reduce(
    (sum, day) => sum + dailyPlayers(day, request.env),
    0
  );
  const by = (
    shares: readonly (readonly [string, number])[],
    dimension: string
  ) =>
    shares.map(([key, share]) => ({
      count: Math.round(total * 31 * share),
      sum: { visits: Math.round(total * 1.3 * share) },
      dimensions: { [dimension]: key },
    }));
  return {
    viewer: {
      zones: [
        {
          daily: recent.map((day) => {
            const players =
              dailyPlayers(day, request.env) * dayFraction(day, request.now);
            return {
              count: Math.round(players * 31),
              sum: {
                visits: Math.round(players * 1.3),
                edgeResponseBytes: Math.round(players * 6_400_000),
              },
              dimensions: {
                date: new Date(day * DAY_MS).toISOString().slice(0, 10),
              },
            };
          }),
          statuses: [
            {
              count: Math.round(total * 27),
              dimensions: { edgeResponseStatus: 200 },
            },
            {
              count: Math.round(total * 2),
              dimensions: { edgeResponseStatus: 101 },
            },
            {
              count: Math.round(total * 1.2),
              dimensions: { edgeResponseStatus: 304 },
            },
            {
              count: Math.round(total * 0.4),
              dimensions: { edgeResponseStatus: 201 },
            },
            {
              count: Math.round(total * 0.1),
              dimensions: { edgeResponseStatus: 404 },
            },
            {
              count: Math.round(total * 0.01),
              dimensions: { edgeResponseStatus: 500 },
            },
          ],
          clientCountryName: by(COUNTRIES, 'clientCountryName'),
          clientDeviceType: by(DEVICES, 'clientDeviceType'),
          userAgentBrowser: by(BROWSERS, 'userAgentBrowser'),
          userAgentOS: by(SYSTEMS, 'userAgentOS'),
        },
      ],
    },
  };
};

const deployments = (request: ViewRequest): unknown => ({
  deployments: [3, 9, 16, 24, 33, 47, 61].map((ago, index) => ({
    id: `demo-deployment-${String(index)}`,
    source: 'wrangler',
    author_email: 'owner@example.com',
    created_on: new Date(
      startOfUtcDay(request.now) - ago * DAY_MS + 15 * HOUR_MS
    ).toISOString(),
    annotations: { 'workers/triggered_by': 'upload' },
    versions: [
      { version_id: `demo-version-${String(index)}`, percentage: 100 },
    ],
  })),
});

/** One generated event as Analytics Engine returns it to `SELECT ... blobN, doubleN`. */
const eventRow = (
  kind: AnalyticsKind,
  timestamp: number,
  fields: Parameters<typeof analyticsDataPoint>[2],
  origin: { country?: string; colo?: string } = {}
): Record<string, unknown> => {
  const point = analyticsDataPoint(
    kind,
    { build: 'beta-demo123', ...origin },
    fields as never
  );
  const row: Record<string, unknown> = { timestamp: sqlTime(timestamp), kind };
  for (let index = 0; index < 18; index += 1)
    row[`blob${String(index + 1)}`] = point.blobs[index] ?? '';
  for (let index = 0; index < 17; index += 1)
    row[`double${String(index + 1)}`] = point.doubles[index] ?? 0;
  return row;
};

const latest = (
  request: ViewRequest,
  trouble: boolean
): readonly Record<string, unknown>[] => {
  const random = seeded(Math.floor(request.now / HOUR_MS));
  const rows: Record<string, unknown>[] = [];
  let at = request.now - 40_000;
  const pick = <T>(items: readonly (readonly [T, number])[]): T => {
    let roll = random();
    for (const [item, share] of items) {
      roll -= share;
      if (roll <= 0) return item;
    }
    return items[0]![0];
  };
  for (let index = 0; index < (trouble ? 50 : 60); index += 1) {
    const country = pick(COUNTRIES);
    const roll = random();
    if (trouble) {
      if (roll < 0.45)
        rows.push(
          eventRow(
            'page',
            at,
            {
              blobs: {
                landing: 'solo',
                table: 'solo',
                device: pick(DEVICES),
                browser: pick(BROWSERS),
                os: pick(SYSTEMS),
                language: 'en',
                error:
                  random() < 0.6
                    ? "TypeError: Cannot read properties of undefined (reading 'stackId')"
                    : 'Error: Room connection lost after N tries',
                pointer: 'fine',
              },
              doubles: {
                sequence: 0,
                errors: 1 + Math.floor(random() * 2),
                visibleMs: 300_000,
              },
            },
            { country }
          )
        );
      else if (roll < 0.7)
        rows.push(
          eventRow('move', at, {
            blobs: {
              commandType: pick(COMMAND_TYPES),
              outcome: 'rejected',
              reason:
                random() < 0.7 ? 'stale_reference' : 'precondition_failed',
            },
            doubles: { durationMs: 3 },
          })
        );
      else if (roll < 0.85)
        rows.push(
          eventRow('failure', at, {
            blobs: {
              subsystem: random() < 0.5 ? 'socket_send' : 'session_disconnect',
              source: 'room',
            },
            doubles: { retryable: 1 },
          })
        );
      else if (roll < 0.95)
        rows.push(
          eventRow(
            'http',
            at,
            {
              blobs: { route: 'admission_ticket', outcome: 'failed' },
              doubles: { durationMs: 1_200, status: 500 },
            },
            { country, colo: 'IAD' }
          )
        );
      else
        rows.push(
          eventRow('limited', at, {
            blobs: { operation: 'admission_ticket' },
            doubles: { retryAfterSeconds: 60 },
          })
        );
    } else if (roll < 0.42) {
      rows.push(
        eventRow(
          'page',
          at,
          {
            blobs: {
              landing: pick(LANDINGS),
              table: random() < 0.7 ? 'solo' : 'multiplayer',
              device: pick(DEVICES),
              browser: pick(BROWSERS),
              os: pick(SYSTEMS),
              language: pick(LANGUAGES),
              referrer: pick(REFERRERS),
              pointer: 'fine',
              visit: random() < 0.3 ? 'first' : 'returning',
              today: '1',
            },
            doubles: {
              sequence: 0,
              tableMs: round(1_400 + random() * 2_600),
              visibleMs: round(60_000 + random() * 1_500_000),
              moves: Math.floor(random() * 300),
            },
          },
          { country, colo: 'DFW' }
        )
      );
    } else if (roll < 0.7) {
      rows.push(
        eventRow('admission', at, {
          blobs: {
            operation: random() < 0.75 ? 'hello_ticket' : 'code_join',
            outcome: 'accepted',
            reason: 'none',
            role: random() < 0.9 ? 'player' : 'spectator',
          },
          doubles: { durationMs: round(4 + random() * 20, 1) },
        })
      );
    } else if (roll < 0.92) {
      const created = random() < 0.65;
      rows.push(
        eventRow('room', at, {
          blobs: {
            outcome: created ? 'created' : 'expired',
            mode: random() < 0.7 ? 'solo' : 'multiplayer',
          },
          doubles: {
            durationMs: round(10 + random() * 30, 1),
            authorityVersion: created ? 0 : Math.floor(random() * 600),
          },
        })
      );
    } else if (roll < 0.97) {
      rows.push(
        eventRow('admission', at, {
          blobs: {
            operation: 'room_open',
            outcome: 'accepted',
            reason: 'none',
            role: 'player',
          },
          doubles: { durationMs: 12 },
        })
      );
    } else {
      rows.push(
        eventRow('failure', at, {
          blobs: { subsystem: 'socket_send', source: 'room' },
          doubles: { retryable: 1 },
        })
      );
    }
    at -= Math.round((trouble ? 900_000 : 60_000) * (0.2 + random() * 1.6));
  }
  return rows;
};

const share = <T>(items: readonly (readonly [T, number])[], total: number) =>
  items.map(([item, part]) => [item, Math.round(total * part)] as const);

const overview = (request: ViewRequest): Record<string, SourceResult> => {
  const allDays = days(request);
  const rangeViews = allDays
    .slice(-request.days)
    .reduce((sum, day) => sum + dailyPlayers(day, request.env) * 1.4, 0);
  const pagesDaily = allDays.map((day) => {
    const random = seeded(day * 3);
    const f = dayFraction(day, request.now);
    const players = Math.round(dailyPlayers(day, request.env) * f);
    const views = Math.round(players * 1.4);
    const reports = Math.round(views * 1.7);
    return {
      t: t(day * DAY_MS),
      views,
      players,
      newPlayers: Math.round(players * (0.22 + random() * 0.08)),
      weekFirsts: Math.round(
        players * (new Date(day * DAY_MS).getUTCDay() === 1 ? 0.7 : 0.2)
      ),
      monthFirsts: Math.round(
        players * (new Date(day * DAY_MS).getUTCDate() === 1 ? 0.8 : 0.08)
      ),
      reports,
      reportsWithErrors: Math.round(reports * (0.012 + random() * 0.012)),
      errors: Math.round(reports * 0.03),
      reconnects: Math.round(reports * 0.05),
      visibleMs: Math.round(players * (19 + random() * 6) * 60_000),
      moves: Math.round(players * (140 + random() * 40)),
      onlineReports: Math.round(reports * 0.31),
      soloReports: Math.round(reports * 0.62),
    };
  });
  const speedDaily = allDays.map((day) => {
    const random = seeded(day * 5);
    const players = dailyPlayers(day, request.env);
    return {
      t: t(day * DAY_MS),
      table50: round(1_650 + random() * 250),
      table75: round(2_350 + random() * 400),
      table95: round(4_800 + random() * 1_200),
      tableN: players,
      ttfb75: round(140 + random() * 60),
      ttfbN: players,
      fcp75: round(380 + random() * 120),
      fcpN: players,
      lcp75: round(900 + random() * 300),
      lcpN: players,
      inp75: round(96 + random() * 60),
      inpN: Math.round(players * 0.9),
      cls75: round(0.01 + random() * 0.03, 3),
      clsN: players,
      heartbeat50: round(44 + random() * 10),
      heartbeat90: round(160 + random() * 60),
      heartbeatN: Math.round(players * 0.7),
      move50: round(68 + random() * 14),
      move90: round(190 + random() * 70),
      moveN: Math.round(players * 0.7),
    };
  });
  const slowCountry = (key: string) =>
    ({
      US: 0.9,
      CA: 0.95,
      GB: 1,
      DE: 1,
      FR: 1.05,
      BR: 1.5,
      MX: 1.3,
      AU: 1.4,
      JP: 1.25,
    })[key] ?? 1.1;
  const slowDevice = (key: string) =>
    ({ desktop: 0.9, mobile: 1.45, tablet: 1.2 })[key] ?? 1;
  const roomsDaily = allDays.flatMap((day) => {
    const players =
      dailyPlayers(day, request.env) * dayFraction(day, request.now);
    return [
      {
        t: t(day * DAY_MS),
        outcome: 'created',
        mode: 'solo',
        rooms: Math.round(players * 0.9),
      },
      {
        t: t(day * DAY_MS),
        outcome: 'created',
        mode: 'multiplayer',
        rooms: Math.round(players * 0.21),
      },
      {
        t: t(day * DAY_MS),
        outcome: 'expired',
        mode: 'solo',
        rooms: Math.round(players * 0.85),
      },
      {
        t: t(day * DAY_MS),
        outcome: 'expired',
        mode: 'multiplayer',
        rooms: Math.round(players * 0.2),
      },
      {
        t: t(day * DAY_MS),
        outcome: 'restored',
        mode: '',
        rooms: Math.round(players * 0.4),
      },
    ];
  });
  const admissionsDaily = allDays.flatMap((day) => {
    const players =
      dailyPlayers(day, request.env) * dayFraction(day, request.now);
    const row = (
      operation: string,
      outcome: string,
      role: string,
      n: number
    ) => ({
      t: t(day * DAY_MS),
      operation,
      outcome,
      role,
      n: Math.round(n),
    });
    return [
      row('hello_ticket', 'accepted', 'player', players * 1.3),
      row('hello_ticket', 'accepted', 'spectator', players * 0.06),
      row('hello_resume', 'accepted', 'player', players * 0.5),
      row('code_join', 'accepted', 'player', players * 0.11),
      row('code_join', 'rejected', 'player', players * 0.02),
      row('invitation_issue', 'accepted', 'player', players * 0.09),
      row('room_open', 'accepted', 'player', players * 0.06),
      row('ticket_issue', 'accepted', 'player', players * 1.9),
      row('ticket_issue', 'rate_limited', 'player', players * 0.004),
    ];
  });
  const movesDaily = allDays.flatMap((day) => {
    const random = seeded(day * 11);
    const moves =
      dailyPlayers(day, request.env) * dayFraction(day, request.now) * 160;
    return [
      {
        t: t(day * DAY_MS),
        outcome: 'accepted',
        moves: Math.round(moves),
        server50: round(5.5 + random() * 1.5, 1),
        server95: round(19 + random() * 8, 1),
      },
      {
        t: t(day * DAY_MS),
        outcome: 'rejected',
        moves: Math.round(moves * 0.006),
        server50: 2.1,
        server95: 6,
      },
      {
        t: t(day * DAY_MS),
        outcome: 'failed',
        moves: Math.round(moves * 0.0004),
        server50: 30,
        server95: 120,
      },
    ];
  });
  const totalMoves = rangeViews * 110;
  const moveTypes = share(COMMAND_TYPES, totalMoves).map(
    ([type, moves], index) => ({
      type,
      moves,
      server50: round(4 + index * 0.4, 1),
      server95: round(14 + index * 1.2, 1),
      authorityMs: round(1.1 + index * 0.1, 2),
      projectionMs: round(1.6 + index * 0.08, 2),
      persistenceMs: round(2.4, 2),
      serializationMs: round(0.4, 2),
      sendMs: round(0.2, 2),
      publicationBytes: Math.round(2_400 + index * 300),
    })
  );
  const httpRoutes = ROUTES.map(([route, part, p50]) => {
    const requests = Math.round(rangeViews * 9 * part);
    return {
      route,
      requests,
      failed: Math.round(requests * 0.0006),
      limited: route === 'admission_ticket' ? Math.round(requests * 0.001) : 0,
      refused: Math.round(requests * 0.004),
      p50,
      p95: p50 * 3.4,
    };
  });
  const troubleDaily = allDays.map((day) => {
    const random = seeded(day * 17);
    const players =
      dailyPlayers(day, request.env) * dayFraction(day, request.now);
    return {
      t: t(day * DAY_MS),
      failures: Math.round(players * 0.01 * random()),
      serverErrors: Math.round(players * 0.006 * random()),
      movesFailed: Math.round(players * 0.05 * random()),
      movesRejected: Math.round(players * 0.9 * (0.6 + random() * 0.6)),
      limited: Math.round(players * 0.01 * random()),
      dropped: Math.round(players * 0.25 * (0.6 + random() * 0.6)),
      connections: Math.round(players * 1.9),
      pagesWithErrors: Math.round(players * 0.02 * (0.5 + random())),
      pageErrors: Math.round(players * 0.04 * (0.5 + random())),
    };
  });
  return {
    pagesDaily: { ok: true, rows: pagesDaily },
    speedDaily: { ok: true, rows: speedDaily },
    byCountry: {
      ok: true,
      rows: dimensionRows(COUNTRIES, rangeViews, 1, slowCountry),
    },
    byDevice: {
      ok: true,
      rows: dimensionRows(DEVICES, rangeViews, 2, slowDevice),
    },
    byBrowser: { ok: true, rows: dimensionRows(BROWSERS, rangeViews, 3) },
    byOs: { ok: true, rows: dimensionRows(SYSTEMS, rangeViews, 4) },
    byLanguage: { ok: true, rows: dimensionRows(LANGUAGES, rangeViews, 5) },
    byReferrer: { ok: true, rows: dimensionRows(REFERRERS, rangeViews, 6) },
    byLanding: { ok: true, rows: dimensionRows(LANDINGS, rangeViews, 7) },
    roomsDaily: { ok: true, rows: roomsDaily },
    roomSizes: {
      ok: true,
      rows: [
        {
          mode: 'solo',
          rooms: Math.round(rangeViews * 0.6),
          moves: Math.round(rangeViews * 0.6 * 180),
          moves50: 96,
          moves90: 420,
          untouched: Math.round(rangeViews * 0.08),
        },
        {
          mode: 'multiplayer',
          rooms: Math.round(rangeViews * 0.15),
          moves: Math.round(rangeViews * 0.15 * 340),
          moves50: 260,
          moves90: 780,
          untouched: Math.round(rangeViews * 0.02),
        },
      ],
    },
    admissionsDaily: { ok: true, rows: admissionsDaily },
    movesDaily: { ok: true, rows: movesDaily },
    moveTypes: { ok: true, rows: moveTypes },
    httpRoutes: { ok: true, rows: httpRoutes },
    troubleDaily: { ok: true, rows: troubleDaily },
    worker: { ok: true, data: worker(request, SITE[request.env].script) },
    ...(SITE[request.env].zoneHost
      ? { zone: { ok: true, data: zone(request) } as const }
      : {}),
    deployments: { ok: true, data: deployments(request) },
  };
};

const NAMESPACES = [
  ['ns-rooms', 'ptcgsim-v2', 'PtcgRoom'],
  ['ns-codes', 'ptcgsim-v2', 'PtcgRoomCode'],
  ['ns-catalog', 'ptcgsim-v2', 'PtcgCardCatalog'],
  ['ns-feed', 'ptcgsim-v2', 'PtcgDeckFeed'],
  ['ns-preview-rooms', 'ptcgsim-v2-preview', 'PtcgRoom'],
  ['ns-other', 'blood-on-the-loktower', 'Room'],
] as const;

/** One day's use of each namespace, scaled by that day's players. */
const usageRows = (day: number, fraction: number, hourly: boolean) => {
  const players = dailyPlayers(day, 'beta') * fraction;
  const preview = dailyPlayers(day, 'preview') * fraction;
  const scale = {
    'ns-rooms': players,
    'ns-codes': players * 0.2,
    'ns-catalog': 1,
    'ns-feed': 1,
    'ns-preview-rooms': preview,
    'ns-other': 4,
  } as const;
  return NAMESPACES.map(([namespaceId, scriptName]) => {
    const s = scale[namespaceId];
    const room = namespaceId.endsWith('rooms');
    return {
      namespaceId,
      scriptName,
      requests: Math.round(s * (room ? 330 : 6)),
      rowsWritten: Math.round(s * (room ? 360 : 2)),
      rowsRead: Math.round(s * (room ? 900 : 40)),
      duration: round(s * (room ? 21 : 0.3) * (hourly ? 1 : 1), 2),
    };
  });
};

const budget = (request: ViewRequest): Record<string, SourceResult> => {
  const usage = days(request).map((day) => {
    const f = dayFraction(day, request.now);
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    const rows = usageRows(day, f, false);
    const beta = dailyPlayers(day, 'beta') * f;
    const preview = dailyPlayers(day, 'preview') * f;
    return {
      workers: [
        {
          dimensions: { date, scriptName: 'ptcgsim-v2' },
          sum: {
            requests: Math.round(beta * 14),
            errors: 0,
            subrequests: 0,
            cpuTimeUs: Math.round(beta * 14 * 1_900),
          },
          quantiles: { cpuTimeP50: 1_700, cpuTimeP99: 9_800 },
        },
        {
          dimensions: { date, scriptName: 'ptcgsim-v2-preview' },
          sum: {
            requests: Math.round(preview * 14),
            errors: 0,
            subrequests: 0,
            cpuTimeUs: Math.round(preview * 14 * 1_900),
          },
          quantiles: { cpuTimeP50: 1_700, cpuTimeP99: 9_800 },
        },
        {
          dimensions: { date, scriptName: 'blood-on-the-loktower' },
          sum: { requests: 30, errors: 0, subrequests: 30, cpuTimeUs: 30_000 },
          quantiles: { cpuTimeP50: 900, cpuTimeP99: 2_900 },
        },
      ],
      invocations: rows.map((row) => ({
        dimensions: {
          date,
          namespaceId: row.namespaceId,
          scriptName: row.scriptName,
        },
        sum: { requests: row.requests, errors: 0 },
      })),
      periodic: rows.map((row) => ({
        dimensions: { date, namespaceId: row.namespaceId },
        sum: {
          activeTime: Math.round((row.duration / 0.128) * 1e6),
          cpuTime: Math.round(row.duration * 2e6),
          duration: row.duration,
          rowsRead: row.rowsRead,
          rowsWritten: row.rowsWritten,
          inboundWebsocketMsgCount: 0,
          outboundWebsocketMsgCount: Math.round(row.requests * 1.6),
        },
      })),
      storage: [
        {
          dimensions: { date },
          max: { storedBytes: Math.round(40_000_000 + beta * 220_000) },
        },
      ],
    };
  });
  const merged = {
    workers0: usage.flatMap((day) => day.workers),
    invocations0: usage.flatMap((day) => day.invocations),
    periodic0: usage.flatMap((day) => day.periodic),
    storage0: usage.flatMap((day) => day.storage),
  };
  const events = (env: ViewRequest['env']) =>
    days(request).map((day) => ({
      t: t(day * DAY_MS),
      rows: Math.round(
        dailyPlayers(day, env) * dayFraction(day, request.now) * 95
      ),
    }));
  return {
    usage: { ok: true, data: { viewer: { accounts: [merged] } } },
    usageToday: { ok: true, data: usageToday(request) },
    namespaces: {
      ok: true,
      data: NAMESPACES.map(([id, script, className]) => ({
        id,
        script,
        class: className,
      })),
    },
    betaEvents: { ok: true, rows: events('beta') },
    previewEvents: { ok: true, rows: events('preview') },
  };
};

/** Yesterday and today by the hour: busier in the evening (UTC). */
const hourShare = (hour: number): number =>
  [
    0.6, 0.5, 0.4, 0.3, 0.25, 0.25, 0.3, 0.4, 0.55, 0.7, 0.8, 0.9, 1, 1.05, 1.1,
    1.2, 1.35, 1.5, 1.7, 1.85, 1.9, 1.7, 1.3, 0.9,
  ][hour]! / 24;

const usageToday = (request: ViewRequest): unknown => {
  const start = startOfUtcDay(request.now) - DAY_MS;
  const workers: unknown[] = [];
  const invocations: unknown[] = [];
  const periodic: unknown[] = [];
  for (let at = start; at <= request.now; at += HOUR_MS) {
    const day = Math.floor(at / DAY_MS);
    const hour = new Date(at).getUTCHours();
    const share = hourShare(hour);
    const datetimeHour = new Date(at).toISOString().replace('.000', '');
    for (const row of usageRows(day, share, true)) {
      invocations.push({
        dimensions: {
          datetimeHour,
          scriptName: row.scriptName,
          namespaceId: row.namespaceId,
        },
        sum: { requests: row.requests },
      });
      periodic.push({
        dimensions: { datetimeHour, namespaceId: row.namespaceId },
        sum: {
          duration: row.duration,
          rowsRead: row.rowsRead,
          rowsWritten: row.rowsWritten,
        },
      });
    }
    workers.push({
      dimensions: { datetimeHour, scriptName: 'ptcgsim-v2' },
      sum: {
        requests: Math.round(dailyPlayers(day, 'beta') * 14 * share),
        errors: 0,
      },
    });
    workers.push({
      dimensions: { datetimeHour, scriptName: 'ptcgsim-v2-preview' },
      sum: {
        requests: Math.round(dailyPlayers(day, 'preview') * 14 * share),
        errors: 0,
      },
    });
  }
  return { viewer: { accounts: [{ workers, invocations, periodic }] } };
};

const live = (request: ViewRequest): Record<string, SourceResult> => {
  const start = startOfUtcDay(request.now) - DAY_MS;
  const hourly: Record<string, unknown>[] = [];
  for (let at = start; at <= request.now; at += HOUR_MS) {
    const day = Math.floor(at / DAY_MS);
    const random = seeded(Math.floor(at / HOUR_MS));
    const players =
      dailyPlayers(day, request.env) *
      hourShare(new Date(at).getUTCHours()) *
      (at + HOUR_MS > request.now ? (request.now - at) / HOUR_MS : 1);
    hourly.push({
      t: t(at),
      views: Math.round(players * 1.4),
      players: Math.round(players),
      moves: Math.round(players * 160),
      rooms: Math.round(players * 1.1),
      joins: Math.round(players * 1.3),
      serverErrors: random() < 0.2 ? 1 : 0,
      pageErrors: random() < 0.3 ? Math.ceil(random() * 3) : 0,
    });
  }
  const events = (env: ViewRequest['env']) =>
    [start, startOfUtcDay(request.now)].map((at) => ({
      t: t(at),
      rows: Math.round(
        dailyPlayers(Math.floor(at / DAY_MS), env) *
          95 *
          dayFraction(Math.floor(at / DAY_MS), request.now)
      ),
    }));
  return {
    hourly: { ok: true, rows: hourly },
    latest: { ok: true, rows: latest(request, false) },
    usageToday: { ok: true, data: usageToday(request) },
    eventsToday: { ok: true, rows: events(request.env) },
    otherEventsToday: {
      ok: true,
      rows: events(request.env === 'beta' ? 'preview' : 'beta'),
    },
    betaHealth: {
      ok: true,
      data: {
        status: 200,
        ms: 38,
        body: { status: 'ok', buildId: 'beta-demo123', protocolVersion: 2 },
      },
    },
    previewHealth: {
      ok: true,
      data: {
        status: 200,
        ms: 51,
        body: { status: 'ok', buildId: 'preview-demo456', protocolVersion: 2 },
      },
    },
    v1Health: { ok: true, data: { status: 200, ms: 212, body: null } },
    deployments: { ok: true, data: deployments(request) },
  };
};

const errors = (request: ViewRequest): Record<string, SourceResult> => {
  const base = overview(request);
  const views = days(request)
    .slice(-request.days)
    .reduce((sum, day) => sum + dailyPlayers(day, request.env) * 1.4, 0);
  const at = (hoursAgo: number) => sqlTime(request.now - hoursAgo * HOUR_MS);
  return {
    troubleDaily: base.troubleDaily!,
    latest: { ok: true, rows: latest(request, true) },
    signatures: {
      ok: true,
      rows: [
        {
          error:
            "TypeError: Cannot read properties of undefined (reading 'stackId')",
          reports: Math.round(views * 0.006),
          errors: Math.round(views * 0.009),
          first: at(24 * 5),
          last: at(0.4),
          browsers: ['Chrome', 'Edge'],
          systems: ['Windows', 'macOS'],
          builds: ['beta-demo123'],
        },
        {
          error: 'Error: Room connection lost after N tries',
          reports: Math.round(views * 0.003),
          errors: Math.round(views * 0.003),
          first: at(24 * 12),
          last: at(2),
          browsers: ['Safari', 'Chrome'],
          systems: ['iOS', 'Android'],
          builds: ['beta-demo123', 'beta-demo100'],
        },
        {
          error:
            'ResizeObserver loop completed with undelivered notifications.',
          reports: Math.round(views * 0.002),
          errors: Math.round(views * 0.004),
          first: at(24 * 20),
          last: at(5),
          browsers: ['Chrome'],
          systems: ['Windows'],
          builds: ['beta-demo123'],
        },
        {
          error: 'NotAllowedError: Write permission denied.',
          reports: Math.round(views * 0.0008),
          errors: Math.round(views * 0.0008),
          first: at(24 * 3),
          last: at(9),
          browsers: ['Safari'],
          systems: ['macOS'],
          builds: ['beta-demo123'],
        },
        {
          error: 'ChunkLoadError: Loading chunk N failed.',
          reports: Math.round(views * 0.0004),
          errors: Math.round(views * 0.0004),
          first: at(24 * 9),
          last: at(30),
          browsers: ['Firefox'],
          systems: ['Linux'],
          builds: ['beta-demo100'],
        },
      ],
    },
    failures: {
      ok: true,
      rows: [
        {
          subsystem: 'socket_send',
          source: 'room',
          n: Math.round(views * 0.004),
          retryable: Math.round(views * 0.004),
          last: at(1),
          builds: ['beta-demo123'],
        },
        {
          subsystem: 'session_disconnect',
          source: 'room',
          n: Math.round(views * 0.002),
          retryable: Math.round(views * 0.002),
          last: at(3),
          builds: ['beta-demo123'],
        },
        {
          subsystem: 'card_catalog_refresh',
          source: 'card_catalog',
          n: 2,
          retryable: 2,
          last: at(30),
          builds: ['beta-demo100'],
        },
      ],
    },
    httpErrors: {
      ok: true,
      rows: [
        {
          route: 'not_found',
          status: 404,
          n: Math.round(views * 0.03),
          last: at(0.2),
        },
        {
          route: 'room_code_join',
          status: 404,
          n: Math.round(views * 0.01),
          last: at(0.6),
        },
        {
          route: 'admission_ticket',
          status: 429,
          n: Math.round(views * 0.002),
          last: at(4),
        },
        {
          route: 'admission_ticket',
          status: 500,
          n: Math.round(views * 0.0005),
          last: at(7),
        },
        { route: 'image_upload', status: 413, n: 3, last: at(50) },
      ],
    },
    moveRefusals: {
      ok: true,
      rows: [
        {
          type: 'MoveCards',
          outcome: 'rejected',
          reason: 'stale_reference',
          n: Math.round(views * 0.08),
          last: at(0.1),
        },
        {
          type: 'ApplyCardSteps',
          outcome: 'rejected',
          reason: 'precondition_failed',
          n: Math.round(views * 0.03),
          last: at(0.5),
        },
        {
          type: 'SetDamage',
          outcome: 'rejected',
          reason: 'stale_reference',
          n: Math.round(views * 0.01),
          last: at(2),
        },
        {
          type: 'MoveCards',
          outcome: 'failed',
          reason: 'internal_retryable',
          n: 4,
          last: at(20),
        },
      ],
    },
    admissionRefusals: {
      ok: true,
      rows: [
        {
          operation: 'code_join',
          outcome: 'rejected',
          reason: 'seat_unavailable',
          role: 'player',
          n: Math.round(views * 0.01),
          last: at(1),
        },
        {
          operation: 'hello_resume',
          outcome: 'rejected',
          reason: 'invalid_capability',
          role: 'player',
          n: Math.round(views * 0.004),
          last: at(6),
        },
        {
          operation: 'ticket_issue',
          outcome: 'rate_limited',
          reason: 'rate_limited',
          role: 'player',
          n: 6,
          last: at(12),
        },
      ],
    },
    socketCloses: {
      ok: true,
      rows: [
        { outcome: 'closed', code: 1001, n: Math.round(views * 0.9) },
        { outcome: 'closed', code: 1006, n: Math.round(views * 0.25) },
        { outcome: 'closed', code: 1000, n: Math.round(views * 0.2) },
        { outcome: 'closed', code: 4404, n: Math.round(views * 0.01) },
        { outcome: 'error', code: 1006, n: Math.round(views * 0.004) },
      ],
    },
    limited: {
      ok: true,
      rows: [
        { operation: 'admission_ticket', n: 6, last: at(12) },
        { operation: 'chat', n: 2, last: at(40) },
      ],
    },
    worker: base.worker!,
    deployments: base.deployments!,
  };
};

/** Every source of a view, generated. */
export const demoSources = (
  request: ViewRequest
): Readonly<Record<string, SourceResult>> => {
  switch (request.view) {
    case 'overview':
      return overview(request);
    case 'live':
      return live(request);
    case 'budget':
      return budget(request);
    case 'errors':
      return errors(request);
  }
};

/** Every kind of event the layout names, for a test that renders them all. */
export const DEMO_EVENT_KINDS = Object.keys(
  ANALYTICS_LAYOUT
) as AnalyticsKind[];
