import { defineConfig } from '@playwright/test';

import { CONTINUATION_HTTP_DRAIN_VALUE } from './apps/server/src/continuation-http-activation.js';
import {
  continuationWorker,
  exactOrigin,
  lane,
} from './tests/browser/support/playwright-config.js';

const external = process.env['PTCGSIM_CONTINUATION_PREVIEW_URL']?.trim();

/**
 * The rollout drain over HTTP: a Worker in the revoke-only state on 4177,
 * or the managed preview PTCGSIM_CONTINUATION_PREVIEW_URL names once an
 * operator has put it into drain (then no server starts).
 */
export default defineConfig({
  ...lane,
  testMatch: 'continuation-drain.spec.ts',
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/continuation-drain',
  reporter: [['list']],
  use: {
    baseURL: exactOrigin(
      external || 'http://127.0.0.1:4177',
      'PTCGSIM_CONTINUATION_PREVIEW_URL'
    ),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
  ...(external
    ? {}
    : {
        webServer: continuationWorker(4177, {
          BUILD_ID: 'continuation-drain-browser-test',
          CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_DRAIN_VALUE,
        }),
      }),
});
