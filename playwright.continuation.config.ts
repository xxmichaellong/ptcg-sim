import { defineConfig } from '@playwright/test';

import {
  chromium,
  continuationWorker,
  lane,
  reporter,
} from './tests/browser/support/playwright-config.js';

const external = process.env['PTCGSIM_CONTINUATION_PREVIEW_URL']?.trim();

/**
 * The continuation journey on a Worker activated with test-only bindings
 * on 4176, or on the managed preview PTCGSIM_CONTINUATION_PREVIEW_URL
 * names (then no server starts).
 */
export default defineConfig({
  ...lane,
  testMatch: 'continuation-full-stack.spec.ts',
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: 'test-results/continuation',
  reporter: reporter('playwright-report/continuation'),
  use: {
    baseURL: external || 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [chromium],
  ...(external
    ? {}
    : {
        webServer: continuationWorker(4176, {
          BUILD_ID: 'continuation-browser-test',
          CONTINUATION_HTTP_ACTIVATION: 'ptcgsim-continuation-http-v1:enabled',
        }),
      }),
});
