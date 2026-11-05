import { defineConfig } from '@playwright/test';

import { builtApp, lane } from './tests/browser/support/playwright-config.js';

const chromeExecutable = process.env['PTCGSIM_CHROME_PATH'];
const diagnosticHeadless = process.env['PTCGSIM_PERFORMANCE_HEADLESS'] === '1';

const stableChrome = {
  browserName: 'chromium' as const,
  ...(chromeExecutable
    ? { launchOptions: { executablePath: chromeExecutable } }
    : { channel: 'chrome' as const }),
};

/**
 * Opt-in physical renderer observation. This is deliberately absent from CI:
 * headful current-stable Chrome and the recorded real GPU are part of the
 * evidence contract. PTCGSIM_PERFORMANCE_HEADLESS=1 exists only to validate
 * the harness and produces diagnostic, never release, evidence.
 */
export default defineConfig({
  ...lane,
  testMatch: 'renderer-spike.spec.ts',
  grep: /@measure/u,
  forbidOnly: true,
  retries: 0,
  repeatEach: 3,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: 'artifacts/performance/renderer-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/performance/renderer-observation.json' }],
    [
      'html',
      {
        open: 'never',
        outputFolder: 'artifacts/performance/renderer-report',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: diagnosticHeadless,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome-1366x768-dpr1',
      metadata: {
        evidenceMode: diagnosticHeadless
          ? 'diagnostic-headless'
          : 'candidate-headful',
      },
      use: {
        ...stableChrome,
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'chrome-1920x1080-dpr2',
      metadata: {
        evidenceMode: diagnosticHeadless
          ? 'diagnostic-headless'
          : 'candidate-headful',
      },
      use: {
        ...stableChrome,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: builtApp(4175),
});
