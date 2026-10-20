import { defineConfig, devices } from '@playwright/test';

const LOCAL_PRODUCTION_PREVIEW_URL = 'http://127.0.0.1:4174';
const externalProductionPreviewUrl = process.env['PTCGSIM_PREVIEW_URL']?.trim();
const productionPreviewUrl =
  externalProductionPreviewUrl || LOCAL_PRODUCTION_PREVIEW_URL;

export default defineConfig({
  // Maps Lingui's macros to English stand-ins for the app code specs load
  // in Node (tests/browser/support/lingui-macro.ts, ADR-034).
  tsconfig: './tsconfig.playwright.json',
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
    baseURL: productionPreviewUrl,
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
  ...(externalProductionPreviewUrl
    ? {}
    : {
        webServer: {
          command:
            'corepack pnpm --filter @ptcgsim/web run build && corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 4174 --var CARD_CATALOG_SOURCE:off',
          url: `${LOCAL_PRODUCTION_PREVIEW_URL}/v2/health`,
          reuseExistingServer: false,
          timeout: 90_000,
          stdout: 'ignore' as const,
          stderr: 'pipe' as const,
        },
      }),
});
