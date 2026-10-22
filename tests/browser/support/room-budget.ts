import type { BrowserContext } from '@playwright/test';

/**
 * Gives a test's browser its own room-creation budget on the local Worker.
 *
 * The Worker allows 12 room creations a minute per client address, keyed
 * on `CF-Connecting-IP` (request-rate-limit.ts). Locally every spec comes
 * from 127.0.0.1 and shares that budget, so a spec that makes several rooms
 * (the tutorial makes a practice room beside the Solo one) could be refused
 * by what ran before it. Cloudflare sets the header itself in production;
 * the local Worker takes the one the request carries, so each test can
 * stand in for a client of its own. The limiter itself is unchanged.
 */
export const ownRoomBudget = async (context: BrowserContext): Promise<void> => {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  await context.setExtraHTTPHeaders({
    // Benchmarking addresses (RFC 2544): never a real client.
    'CF-Connecting-IP': `198.18.${String(octet())}.${String(octet())}`,
  });
};
