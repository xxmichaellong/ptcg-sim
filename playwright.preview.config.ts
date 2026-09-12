import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'production-topology.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/production-topology',
  reporter: process.env['CI']
    ? [
        ['github'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/production-topology',
          },
        ],
      ]
    : [
        ['list'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/production-topology',
          },
        ],
      ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env['PTCGSIM_CHROMIUM_PATH'],
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command:
      'corepack pnpm --filter @ptcgsim/web run build && corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/v2/health',
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
