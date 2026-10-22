/**
 * How often the deck index may call Limitless. Its public API allows 50
 * requests per five minutes per caller, and without a key the Worker shares
 * that with whoever else calls from Cloudflare's addresses, so the index
 * keeps well under it: at most 30 in any five minutes, of which the crawl
 * may use 20 and the rest stay for a player opening a tournament not read
 * yet. A 429, or Limitless saying none are left, stops every request until
 * its window resets.
 */
import type { LimitlessRateLimit } from '../limitless.js';

export const BUDGET = Object.freeze({
  windowMs: 5 * 60 * 1000,
  total: 30,
  /** Kept back from the crawl for players' own requests. */
  reservedForDemand: 10,
  /** How long a 429 holds requests back when Limitless doesn't say. */
  defaultBlockMs: 5 * 60 * 1000,
  /** Never held back longer than this, whatever a header says. */
  maximumBlockMs: 30 * 60 * 1000,
});

export type RequestKind = 'crawl' | 'demand';

export interface BudgetState {
  /** When each request in the current window was made. */
  readonly spent: readonly number[];
  /** No request before this. */
  readonly blockedUntil: number;
}

export const EMPTY_BUDGET: BudgetState = { spent: [], blockedUntil: 0 };

const live = (state: BudgetState, now: number): readonly number[] =>
  state.spent.filter((at) => at > now - BUDGET.windowMs && at <= now);

const allowance = (kind: RequestKind): number =>
  kind === 'crawl' ? BUDGET.total - BUDGET.reservedForDemand : BUDGET.total;

/**
 * When a request of this kind may next be made: `now` if it may be made
 * now, otherwise the first moment the window or a block lets it.
 */
export const nextAllowedAt = (
  state: BudgetState,
  kind: RequestKind,
  now: number
): number => {
  const spent = [...live(state, now)].sort((left, right) => left - right);
  let at = Math.max(now, state.blockedUntil);
  const over = spent.length - allowance(kind) + 1;
  if (over > 0) {
    // The oldest requests have to leave the window first.
    at = Math.max(at, spent[over - 1]! + BUDGET.windowMs);
  }
  return at;
};

export const spend = (state: BudgetState, now: number): BudgetState => ({
  spent: [...live(state, now), now],
  blockedUntil: state.blockedUntil,
});

/** What Limitless said about its limit: blocks until its window resets. */
export const observe = (
  state: BudgetState,
  now: number,
  answer: {
    readonly rateLimited?: boolean;
    readonly rateLimit?: LimitlessRateLimit;
    readonly retryAfterMs?: number;
  }
): BudgetState => {
  const exhausted =
    answer.rateLimited === true || answer.rateLimit?.remaining === 0;
  if (!exhausted) return state;
  const wait = Math.min(
    BUDGET.maximumBlockMs,
    answer.retryAfterMs ??
      (answer.rateLimit ? answer.rateLimit.resetSeconds * 1000 : undefined) ??
      BUDGET.defaultBlockMs
  );
  return {
    spent: live(state, now),
    blockedUntil: Math.max(state.blockedUntil, now + Math.max(1_000, wait)),
  };
};

/** A stored budget, or an empty one if it isn't one. */
export const readBudget = (value: unknown): BudgetState => {
  if (typeof value !== 'string') return EMPTY_BUDGET;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as BudgetState).spent) &&
      (parsed as BudgetState).spent.every((at) => Number.isFinite(at)) &&
      Number.isFinite((parsed as BudgetState).blockedUntil)
    ) {
      return {
        spent: (parsed as BudgetState).spent.slice(-BUDGET.total * 2),
        blockedUntil: (parsed as BudgetState).blockedUntil,
      };
    }
  } catch {
    // Unreadable: start over.
  }
  return EMPTY_BUDGET;
};
