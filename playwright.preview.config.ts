import { defineConfig } from '@playwright/test';

import {
  builtApp,
  chromium,
  lane,
  reporter,
} from './tests/browser/support/playwright-config.js';

const external = process.env['PTCGSIM_PREVIEW_URL']?.trim();

/**
 * The production topology: the built app served by the Worker on 4174, or
 * the deployed preview PTCGSIM_PREVIEW_URL names (then no server starts).
 */
export default defineConfig({
  ...lane,
  testMatch: 'production-topology.spec.ts',
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/production-topology',
  reporter: reporter('playwright-report/production-topology'),
  use: {
    baseURL: external || 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [chromium],
  ...(external ? {} : { webServer: builtApp(4174) }),
});
