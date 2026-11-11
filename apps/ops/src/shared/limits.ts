/**
 * The account's daily allowances on Workers Free, and what the same use
 * would cost on Workers Paid (ADR-051, ADR-054). Free limits are per
 * account (every Worker in it shares them) and per UTC day; past one,
 * operations of that kind fail until 00:00 UTC.
 *
 * Sources (2026-11):
 * https://developers.cloudflare.com/workers/platform/limits/
 * https://developers.cloudflare.com/workers/platform/pricing/
 * https://developers.cloudflare.com/durable-objects/platform/pricing/
 * https://developers.cloudflare.com/analytics/analytics-engine/pricing/
 */

export type FreeLimitId =
  | 'workerRequests'
  | 'objectRequests'
  | 'objectDuration'
  | 'rowsRead'
  | 'rowsWritten'
  | 'analyticsEvents';

export interface FreeLimit {
  readonly id: FreeLimitId;
  readonly label: string;
  /** What running out of it does to the site. */
  readonly consequence: string;
  readonly daily: number;
  readonly unit: 'count' | 'gbSeconds';
}

export const FREE_LIMITS: readonly FreeLimit[] = [
  {
    id: 'rowsWritten',
    label: 'Rows written',
    consequence: 'Moves and joins fail: rooms can’t save.',
    daily: 100_000,
    unit: 'count',
  },
  {
    id: 'objectDuration',
    label: 'Room time',
    consequence: 'Rooms stop answering.',
    daily: 13_000,
    unit: 'gbSeconds',
  },
  {
    id: 'objectRequests',
    label: 'Room requests',
    consequence: 'Rooms stop answering.',
    daily: 100_000,
    unit: 'count',
  },
  {
    id: 'workerRequests',
    label: 'Worker requests',
    consequence: 'The site’s API answers 429 (the page itself still loads).',
    daily: 100_000,
    unit: 'count',
  },
  {
    id: 'rowsRead',
    label: 'Rows read',
    consequence: 'Rooms stop loading.',
    daily: 5_000_000,
    unit: 'count',
  },
  {
    id: 'analyticsEvents',
    label: 'Analytics events',
    consequence: 'This dashboard misses events; the site is unaffected.',
    daily: 100_000,
    unit: 'count',
  },
];

/** Durable Object storage, all objects together (not daily). */
export const FREE_STORAGE_BYTES = 5_000_000_000;

/** A Durable Object is billed at 128 MB while active: GB-s per second. */
export const OBJECT_GB_PER_SECOND = 0.128;

/** Workers Paid: a month's base price and what it includes, then per unit. */
export const PAID_PLAN = {
  baseUsd: 5,
  workerRequests: { included: 10_000_000, usdPerMillion: 0.3 },
  workerCpuMs: { included: 30_000_000, usdPerMillion: 0.02 },
  objectRequests: { included: 1_000_000, usdPerMillion: 0.15 },
  objectGbSeconds: { included: 400_000, usdPerMillion: 12.5 },
  rowsRead: { included: 25_000_000_000, usdPerMillion: 0.001 },
  rowsWritten: { included: 50_000_000, usdPerMillion: 1 },
  storageGbMonth: { included: 5, usdPerGb: 0.2 },
} as const;

export interface MonthlyUse {
  readonly workerRequests: number;
  readonly workerCpuMs: number;
  readonly objectRequests: number;
  readonly objectGbSeconds: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly storageGb: number;
}

export interface PaidEstimate {
  readonly totalUsd: number;
  /** Each charge beyond the base, in dollars, when above zero. */
  readonly overages: readonly {
    readonly label: string;
    readonly usd: number;
  }[];
}

const overage = (
  used: number,
  rate: { readonly included: number; readonly usdPerMillion: number }
): number =>
  (Math.max(0, used - rate.included) / 1_000_000) * rate.usdPerMillion;

/** What a month of this use would cost on Workers Paid. */
export const paidEstimate = (use: MonthlyUse): PaidEstimate => {
  const charges = [
    {
      label: 'Worker requests',
      usd: overage(use.workerRequests, PAID_PLAN.workerRequests),
    },
    {
      label: 'Worker CPU',
      usd: overage(use.workerCpuMs, PAID_PLAN.workerCpuMs),
    },
    {
      label: 'Room requests',
      usd: overage(use.objectRequests, PAID_PLAN.objectRequests),
    },
    {
      label: 'Room time',
      usd: overage(use.objectGbSeconds, PAID_PLAN.objectGbSeconds),
    },
    { label: 'Rows read', usd: overage(use.rowsRead, PAID_PLAN.rowsRead) },
    {
      label: 'Rows written',
      usd: overage(use.rowsWritten, PAID_PLAN.rowsWritten),
    },
    {
      label: 'Storage',
      usd:
        Math.max(0, use.storageGb - PAID_PLAN.storageGbMonth.included) *
        PAID_PLAN.storageGbMonth.usdPerGb,
    },
  ].filter((charge) => charge.usd >= 0.005);
  return {
    totalUsd:
      PAID_PLAN.baseUsd +
      charges.reduce((total, charge) => total + charge.usd, 0),
    overages: charges,
  };
};
