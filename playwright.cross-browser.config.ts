import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'remote-room-solo-full-stack.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/cross-browser',
  reporter: process.env['CI']
    ? [
        ['github'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/cross-browser',
          },
        ],
      ]
    : [
        ['list'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/cross-browser',
          },
        ],
      ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          executablePath: process.env['PTCGSIM_FIREFOX_PATH'],
        },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: {
          executablePath: process.env['PTCGSIM_WEBKIT_PATH'],
        },
      },
    },
  ],
  webServer: [
    {
      command:
        'corepack pnpm --filter @ptcgsim/web run build && corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 8787',
      url: 'http://127.0.0.1:8787/v2/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command:
        'corepack pnpm --filter @ptcgsim/web dev --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
