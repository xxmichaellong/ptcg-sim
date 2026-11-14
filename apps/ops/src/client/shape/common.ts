import type { SourceResult } from '../../shared/api.js';

/**
 * What every view's shaping shares: reading a source's rows, laying them
 * out by UTC day, and the headline figure (the last seven complete days,
 * against the seven before).
 */

export type Row = Readonly<Record<string, unknown>>;
export type Rows = readonly Row[];
export type Sources = Readonly<Record<string, SourceResult>>;

const DAY_MS = 86_400_000;

export const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A measured number, or null when absent or not a number. */
export const measured = (value: unknown, samples?: unknown): number | null => {
  if (samples !== undefined && num(samples) <= 0) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const str = (value: unknown): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

export const rowsOf = (sources: Sources, name: string): Rows | undefined => {
  const source = sources[name];
  return source?.ok ? (source.rows ?? []) : undefined;
};

export const dataOf = (sources: Sources, name: string): unknown => {
  const source = sources[name];
  return source?.ok ? source.data : undefined;
};

/** Why a source has no rows, if it has none. */
export const problemOf = (
  sources: Sources,
  name: string
): Extract<SourceResult, { ok: false }> | undefined => {
  const source = sources[name];
  return source && !source.ok ? source : undefined;
};

/** The day a row is in: `YYYY-MM-DD` from a date or a SQL time. */
export const dayOf = (value: unknown): string => str(value).slice(0, 10);

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Every UTC day from `first` through `last`, as `YYYY-MM-DD`. */
export const daysBetween = (first: number, last: number): readonly string[] => {
  const days: string[] = [];
  for (let at = Math.floor(first / DAY_MS) * DAY_MS; at <= last; at += DAY_MS) days.push(isoDay(at));
  return days;
};

/** Rows by their day, each day's rows together. */
export const byDay = (rows: Rows, key = 't'): ReadonlyMap<string, Rows> => {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const day = dayOf(row[key]);
    const list = map.get(day);
    if (list) list.push(row);
    else map.set(day, [row]);
  }
  return map;
};

/** A value a day: summed across a day's rows, 0 for a day without any. */
export const dailySum = (
  rows: Rows | undefined,
  days: readonly string[],
  pick: (row: Row) => number,
  key = 't'
): readonly number[] => {
  const grouped = byDay(rows ?? [], key);
  return days.map((day) =>
    (grouped.get(day) ?? []).reduce((total, row) => total + pick(row), 0)
  );
};

/** A measured value a day (one row each), null for a day without one. */
export const dailyLevel = (
  rows: Rows | undefined,
  days: readonly string[],
  pick: (row: Row) => number | null,
  key = 't'
): readonly (number | null)[] => {
  const grouped = byDay(rows ?? [], key);
  return days.map((day) => {
    const row = grouped.get(day)?.[0];
    return row ? pick(row) : null;
  });
};

export interface Delta {
  /** Relative change (0.12 = +12%), or a difference in points for rates. */
  readonly delta: number | null;
  readonly kind: 'relative' | 'points';
  readonly good: 'up' | 'down';
}

export interface Headline extends Delta {
  readonly value: number | null;
}

const mean = (values: readonly (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((total, value) => total + value, 0) / present.length;
};

/**
 * The last seven complete days (today is partial and left out) and the
 * change from the seven before: an average of daily values for counts and
 * levels, a ratio of sums for rates.
 */
export const headline = (
  series: readonly (number | null)[],
  good: 'up' | 'down',
  denominator?: readonly number[]
): Headline => {
  const complete = series.length - 1;
  const recent = { from: Math.max(0, complete - 7), to: complete };
  const prior = { from: Math.max(0, complete - 14), to: Math.max(0, complete - 7) };
  if (denominator) {
    const rate = (window: { from: number; to: number }): number | null => {
      let top = 0;
      let bottom = 0;
      for (let index = window.from; index < window.to; index += 1) {
        top += series[index] ?? 0;
        bottom += denominator[index] ?? 0;
      }
      return bottom > 0 ? top / bottom : null;
    };
    const value = rate(recent);
    const before = rate(prior);
    return {
      value,
      delta: value !== null && before !== null && prior.to > prior.from ? (value - before) * 100 : null,
      kind: 'points',
      good,
    };
  }
  const value = mean(series.slice(recent.from, recent.to));
  const before = prior.to > prior.from ? mean(series.slice(prior.from, prior.to)) : null;
  return {
    value,
    delta: value !== null && before !== null && before !== 0 ? (value - before) / before : null,
    kind: 'relative',
    good,
  };
};

export const sum = (values: readonly (number | null)[]): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** The last `days` entries of a series (the range, from a longer read). */
export const lastDays = <T>(values: readonly T[], days: number): readonly T[] =>
  values.slice(Math.max(0, values.length - days));

export const ratio = (top: number, bottom: number): number | null =>
  bottom > 0 ? top / bottom : null;

/** The GraphQL `viewer.accounts[0]` (or `zones[0]`) object. */
export const graphqlScope = (data: unknown, scope: 'accounts' | 'zones'): Row | undefined => {
  if (typeof data !== 'object' || data === null) return undefined;
  const viewer = (data as { viewer?: Record<string, unknown> }).viewer;
  const list = viewer?.[scope];
  return Array.isArray(list) && typeof list[0] === 'object' && list[0] !== null
    ? (list[0] as Row)
    : undefined;
};

/** Every row of the aliased GraphQL fields `name`, `name0`, `name1`... */
export const graphqlRows = (scope: Row | undefined, name: string): Rows => {
  if (!scope) return [];
  return Object.entries(scope)
    .filter(([key]) => key === name || new RegExp(`^${name}\\d+$`, 'u').test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? (value as Row[]) : []));
};

/** A nested field of a GraphQL row: `path(row, 'sum', 'requests')`. */
export const path = (row: Row, ...keys: readonly string[]): unknown => {
  let value: unknown = row;
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};
