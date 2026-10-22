import { describe, expect, it } from 'vitest';

import {
  BUDGET,
  EMPTY_BUDGET,
  nextAllowedAt,
  observe,
  readBudget,
  spend,
  type BudgetState,
} from './budget.js';

const spendTimes = (state: BudgetState, times: readonly number[]) =>
  times.reduce((next, at) => spend(next, at), state);

describe('the deck index request budget', () => {
  it('lets the crawl spend 20 in five minutes and keeps 10 for players', () => {
    const start = 1_000_000;
    const crawled = spendTimes(
      EMPTY_BUDGET,
      Array.from({ length: 20 }, (_, index) => start + index * 1_000)
    );
    const now = start + 20_000;
    // The crawl waits for its oldest request to leave the window...
    expect(nextAllowedAt(crawled, 'crawl', now)).toBe(start + BUDGET.windowMs);
    // ...while a player's request still goes now.
    expect(nextAllowedAt(crawled, 'demand', now)).toBe(now);
    const full = spendTimes(
      crawled,
      Array.from({ length: 10 }, (_, index) => now + index)
    );
    expect(nextAllowedAt(full, 'demand', now + 10)).toBe(
      start + BUDGET.windowMs
    );
  });

  it('forgets requests that have left the window', () => {
    const state = spendTimes(
      EMPTY_BUDGET,
      Array.from({ length: 30 }, (_, index) => index)
    );
    const later = BUDGET.windowMs + 100;
    expect(nextAllowedAt(state, 'crawl', later)).toBe(later);
    expect(spend(state, later).spent).toEqual([later]);
  });

  it('stops every request after a 429 until Limitless says, or five minutes', () => {
    const blocked = observe(EMPTY_BUDGET, 0, {
      rateLimited: true,
      retryAfterMs: 42_000,
    });
    expect(nextAllowedAt(blocked, 'demand', 1)).toBe(42_000);
    expect(
      nextAllowedAt(observe(EMPTY_BUDGET, 0, { rateLimited: true }), 'crawl', 0)
    ).toBe(BUDGET.defaultBlockMs);
    // None left in Limitless's window: wait for it to reset.
    expect(
      nextAllowedAt(
        observe(EMPTY_BUDGET, 0, {
          rateLimit: { remaining: 0, resetSeconds: 90 },
        }),
        'crawl',
        0
      )
    ).toBe(90_000);
    // Some left: nothing changes; and never longer than half an hour.
    expect(
      observe(EMPTY_BUDGET, 0, { rateLimit: { remaining: 3, resetSeconds: 9 } })
    ).toBe(EMPTY_BUDGET);
    expect(
      nextAllowedAt(
        observe(EMPTY_BUDGET, 0, { rateLimited: true, retryAfterMs: 9e9 }),
        'crawl',
        0
      )
    ).toBe(BUDGET.maximumBlockMs);
  });

  it('starts over from anything stored that is not a budget', () => {
    expect(readBudget(undefined)).toBe(EMPTY_BUDGET);
    expect(readBudget('{nope')).toBe(EMPTY_BUDGET);
    expect(readBudget(JSON.stringify({ spent: ['x'], blockedUntil: 1 }))).toBe(
      EMPTY_BUDGET
    );
    expect(
      readBudget(JSON.stringify({ spent: [1, 2], blockedUntil: 3 }))
    ).toEqual({ spent: [1, 2], blockedUntil: 3 });
  });
});
