/**
 * How often the deck index may call Limitless. Its public API allows 50
 * requests per five minutes per caller, and without a key the Worker shares
 * that with whoever else calls from Cloudflare's addresses, so the index
 * keeps well under it: at most 30 in any five minutes. The crawl may use 20
 * of them and players opening a tournament not read yet 15, so neither can
 * leave the other none: players always have 10, the crawl 15. A 429, or
 * Limitless saying none are left, stops every request until its window
 * resets.
 */
import type { LimitlessRateLimit } from '../limitless.js';

export const BUDGET = Object.freeze({
  windowMs: 5 * 60 * 1000,
  total: 30,
  /** The most the crawl may spend. */
  crawl: 20,
  /** The most players' own requests may spend. */
  demand: 15,
  /** How long a 429 holds requests back when Limitless doesn't say. */
  defaultBlockMs: 5 * 60 * 1000,
  /** Never held back longer than this, whatever a header says. */
  maximumBlockMs: 30 * 60 * 1000,
});

export type RequestKind = 'crawl' | 'demand';

export interface BudgetState {
  /** When each request in the current window was made. */
  readonly spent: readonly number[];
  /** Which of them players asked for (the rest were the crawl's). */
  readonly demand: readonly number[];
  /** No request before this. */
  readonly blockedUntil: number;
}

export const EMPTY_BUDGET: BudgetState = {
  spent: [],
  demand: [],
  blockedUntil: 0,
};

const inWindow = (times: readonly number[], now: number): number[] =>
  times.filter((at) => at > now - BUDGET.windowMs && at <= now);

/** The crawl's requests: all of them less the players'. */
const crawlTimes = (state: BudgetState, now: number): number[] => {
  const crawl = inWindow(state.spent, now);
  for (const at of inWindow(state.demand, now)) {
    const index = crawl.indexOf(at);
    if (index >= 0) crawl.splice(index, 1);
  }
  return crawl;
};

/** When a window holding these requests has room for one more of `cap`. */
const roomAt = (times: readonly number[], cap: number): number => {
  const sorted = [...times].sort((left, right) => left - right);
  const over = sorted.length - cap + 1;
  // The oldest requests have to leave the window first.
  return over > 0 ? sorted[over - 1]! + BUDGET.windowMs : 0;
};

/**
 * When a request of this kind may next be made: `now` if it may be made
 * now, otherwise the first moment the window or a block lets it.
 */
export const nextAllowedAt = (
  state: BudgetState,
  kind: RequestKind,
  now: number
): number => {
  return Math.max(
    now,
    state.blockedUntil,
    roomAt(inWindow(state.spent, now), BUDGET.total),
    kind === 'crawl'
      ? roomAt(crawlTimes(state, now), BUDGET.crawl)
      : roomAt(inWindow(state.demand, now), BUDGET.demand)
  );
};

export const spend = (
  state: BudgetState,
  now: number,
  kind: RequestKind
): BudgetState => ({
  spent: [...inWindow(state.spent, now), now],
  demand:
    kind === 'demand'
      ? [...inWindow(state.demand, now), now]
      : inWindow(state.demand, now),
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
    spent: inWindow(state.spent, now),
    demand: inWindow(state.demand, now),
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
      // A budget stored before players' requests were told apart has
      // none: all of it counts as the crawl's.
      const demand = (parsed as Partial<BudgetState>).demand;
      return {
        spent: (parsed as BudgetState).spent.slice(-BUDGET.total * 2),
        demand:
          Array.isArray(demand) && demand.every((at) => Number.isFinite(at))
            ? demand.slice(-BUDGET.total * 2)
            : [],
        blockedUntil: (parsed as BudgetState).blockedUntil,
      };
    }
  } catch {
    // Unreadable: start over.
  }
  return EMPTY_BUDGET;
};
