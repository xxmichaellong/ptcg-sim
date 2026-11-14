/**
 * Where each fact of the site's analytics events sits (ADR-054). The Worker
 * writes events to Workers Analytics Engine, whose rows have only numbered
 * columns: one index, twenty strings (`blob1`..`blob20`) and twenty numbers
 * (`double1`..`double20`). This table names them, once, for the writer (the
 * server) and the reader (the internal dashboard, apps/ops), so the two can
 * never disagree on what `blob7` means.
 *
 * Every row starts the same: the index and `blob1` are its kind, then the
 * build that wrote it, the visitor's country and the Cloudflare data center
 * that served them (both blank where no visitor's request is at hand, in a
 * room's own events), and `double1` its weight: how many events it stands
 * for when only some are written (moves, ANALYTICS_MOVE_SAMPLE).
 *
 * A number that wasn't measured is written as -1 (ANALYTICS_ABSENT), so a
 * reader keeps `>= 0` rows for a quantile or an average.
 *
 * Append fields; never move or reuse one. Rows already written keep their
 * meaning for three months.
 */

export const ANALYTICS_ABSENT = -1;
/** One accepted move in this many is written, weighted to stand for all. */
export const ANALYTICS_MOVE_SAMPLE = 4;

/** The datasets the Worker's environments write. */
export const ANALYTICS_DATASETS = {
  beta: 'ptcgsim_events',
  preview: 'ptcgsim_events_preview',
} as const;
export type AnalyticsEnvironment = keyof typeof ANALYTICS_DATASETS;

const COMMON_BLOBS = ['kind', 'build', 'country', 'colo'] as const;
const COMMON_DOUBLES = ['weight'] as const;

export const ANALYTICS_LAYOUT = {
  /** A request the Worker answered itself (ServerHttpRoute). */
  http: {
    blobs: ['route', 'outcome'],
    doubles: ['durationMs', 'status'],
  },
  /** A room made, restored from storage, or deleted after its last use. */
  room: {
    blobs: ['outcome', 'mode'],
    doubles: [
      'durationMs',
      'authorityVersion',
      'activeSessions',
      'activeSockets',
    ],
  },
  /** A player or spectator let in, or turned away (RoomAdmissionOperation). */
  admission: {
    blobs: ['operation', 'outcome', 'reason', 'role'],
    doubles: ['durationMs', 'authorityVersion'],
  },
  /** A move: one in ANALYTICS_MOVE_SAMPLE accepted, every other outcome. */
  move: {
    blobs: ['commandType', 'outcome', 'reason'],
    doubles: [
      'durationMs',
      'authorityMs',
      'projectionMs',
      'persistenceMs',
      'serializationMs',
      'sendMs',
      'requestBytes',
      'publicationBytes',
      'deliveries',
    ],
  },
  /** A room's connection upgraded, restored after hibernation, or closed. */
  socket: {
    blobs: ['outcome'],
    doubles: ['closeCode', 'activeSockets'],
  },
  /** A request the room or the edge turned away for coming too often. */
  limited: {
    blobs: ['operation'],
    doubles: ['retryAfterSeconds'],
  },
  /** A save made, restored, revoked or expired (ADR-021's continuations). */
  save: {
    blobs: ['operation', 'outcome'],
    doubles: ['durationMs'],
  },
  /** Something the server caught going wrong (ServerFailureSubsystem). */
  failure: {
    blobs: ['subsystem', 'source'],
    doubles: ['retryable'],
  },
  /** A page's report of its visit (PageReport). */
  page: {
    blobs: [
      'landing',
      'table',
      'device',
      'browser',
      'os',
      'language',
      'referrer',
      'campaign',
      'error',
      'pointer',
      /** `first` for a first visit, else `returning`. */
      'visit',
      /** `1` for the first visit this UTC day, ISO week, month; else `0`. */
      'today',
      'week',
      'month',
    ],
    doubles: [
      'sequence',
      'visibleMs',
      'daysSince',
      'ttfb',
      'fcp',
      'lcp',
      'tableMs',
      'inp',
      'cls',
      'heartbeatMedian',
      'heartbeatMax',
      'moveMedian',
      'moveMax',
      'moves',
      'reconnects',
      'errors',
    ],
  },
} as const;

export type AnalyticsKind = keyof typeof ANALYTICS_LAYOUT;
export type AnalyticsBlobField<Kind extends AnalyticsKind> =
  | (typeof COMMON_BLOBS)[number]
  | (typeof ANALYTICS_LAYOUT)[Kind]['blobs'][number];
export type AnalyticsDoubleField<Kind extends AnalyticsKind> =
  | (typeof COMMON_DOUBLES)[number]
  | (typeof ANALYTICS_LAYOUT)[Kind]['doubles'][number];

/** The column a kind's field is in: `blob7`, `double3`. */
export const analyticsColumn = <Kind extends AnalyticsKind>(
  kind: Kind,
  field: AnalyticsBlobField<Kind> | AnalyticsDoubleField<Kind>
): string => {
  const blobs: readonly string[] = [
    ...COMMON_BLOBS,
    ...ANALYTICS_LAYOUT[kind].blobs,
  ];
  const blob = blobs.indexOf(field);
  if (blob >= 0) return `blob${String(blob + 1)}`;
  const doubles: readonly string[] = [
    ...COMMON_DOUBLES,
    ...ANALYTICS_LAYOUT[kind].doubles,
  ];
  const double = doubles.indexOf(field);
  if (double >= 0) return `double${String(double + 1)}`;
  throw new Error(`No analytics field ${String(field)} on ${kind}`);
};

export interface AnalyticsDataPoint {
  readonly indexes: [string];
  readonly blobs: string[];
  readonly doubles: number[];
}

export interface AnalyticsOrigin {
  readonly build: string;
  readonly country?: string;
  readonly colo?: string;
}

/** Strings over this length are cut: rows are small and fields bounded. */
const MAX_BLOB_CODE_UNITS = 160;

/** One event's row, its fields placed by the layout. */
export const analyticsDataPoint = <Kind extends AnalyticsKind>(
  kind: Kind,
  origin: AnalyticsOrigin,
  fields: {
    readonly blobs: Partial<
      Record<(typeof ANALYTICS_LAYOUT)[Kind]['blobs'][number], string>
    >;
    readonly doubles: Partial<
      Record<(typeof ANALYTICS_LAYOUT)[Kind]['doubles'][number], number>
    >;
  },
  weight = 1
): AnalyticsDataPoint => {
  const layout = ANALYTICS_LAYOUT[kind];
  const blobFields = fields.blobs as Record<string, string | undefined>;
  const doubleFields = fields.doubles as Record<string, number | undefined>;
  const blobs = [
    kind,
    origin.build,
    origin.country ?? '',
    origin.colo ?? '',
    ...layout.blobs.map((field: string) => blobFields[field] ?? ''),
  ].map((value) => value.slice(0, MAX_BLOB_CODE_UNITS));
  const doubles = [
    weight,
    ...layout.doubles.map((field: string) => {
      const value = doubleFields[field];
      return value === undefined || !Number.isFinite(value)
        ? ANALYTICS_ABSENT
        : value;
    }),
  ];
  return { indexes: [kind], blobs, doubles };
};
