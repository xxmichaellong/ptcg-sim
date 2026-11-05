import { defineConfig } from '@playwright/test';

import {
  CI,
  chromium,
  devServers,
  lane,
  reporter,
} from './tests/browser/support/playwright-config.js';

/** The Chromium suite: every spec the other configs don't own. */
export default defineConfig({
  ...lane,
  testIgnore: [
    'continuation-full-stack.spec.ts',
    'continuation-drain.spec.ts',
    'continuation-rotation.spec.ts',
    'production-topology.spec.ts',
  ],
  // Timings taken by playwright.performance.config.ts.
  grepInvert: /@measure/u,
  // On CI a failed test runs once more, and one that then passes is
  // annotated as flaky. The JSON report refreshes the shard times
  // (scripts/browser-shards.mjs record).
  retries: CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: reporter(
    'playwright-report',
    ...(CI
      ? [['json', { outputFile: 'test-results/results.json' }] as const]
      : [])
  ),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [chromium],
  webServer: devServers,
});
