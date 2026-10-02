import { defineConfig, devices } from '@playwright/test';

const LOCAL_CONTINUATION_PREVIEW_URL = 'http://127.0.0.1:4176';
const externalContinuationPreviewUrl =
  process.env['PTCGSIM_CONTINUATION_PREVIEW_URL']?.trim();
const continuationPreviewUrl =
  externalContinuationPreviewUrl || LOCAL_CONTINUATION_PREVIEW_URL;

const shellSingleQuote = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

const continuationVariables = Object.entries({
  BUILD_ID: 'continuation-browser-test',
  CONTINUATION_HTTP_ACTIVATION: 'ptcgsim-continuation-http-v1:enabled',
  CONTINUATION_KEYRING: JSON.stringify({
    format: 'ptcgsim-continuation-keyring-v1',
    activeKeyId: 'browser-test-key',
    keys: [
      {
        id: 'browser-test-key',
        material: 'HR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0',
      },
    ],
  }),
  CONTINUATION_QUOTA_CONFIGURATION: JSON.stringify({
    format: 'ptcgsim-continuation-quota-configuration-v1',
    shardCount: 4,
    maximumActiveLeasesPerShard: 4,
  }),
})
  .map(([name, value]) => `--var ${shellSingleQuote(`${name}:${value}`)}`)
  .join(' ');

/**
 * Explicitly activated continuation journey. Test-only key material is passed
 * on the local command line and never added to the deployable Worker config.
 * A separately provisioned managed preview can be exercised by setting
 * PTCGSIM_CONTINUATION_PREVIEW_URL; in that mode Playwright starts no server.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'continuation-full-stack.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: 'test-results/continuation',
  reporter: process.env['CI']
    ? [
        ['github'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/continuation',
          },
        ],
      ]
    : [
        ['list'],
        [
          'html',
          {
            open: 'never',
            outputFolder: 'playwright-report/continuation',
          },
        ],
      ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: continuationPreviewUrl,
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
  ...(externalContinuationPreviewUrl
    ? {}
    : {
        webServer: {
          command: `corepack pnpm --filter @ptcgsim/web run build && corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 4176 ${continuationVariables}`,
          url: `${LOCAL_CONTINUATION_PREVIEW_URL}/v2/health`,
          reuseExistingServer: false,
          timeout: 90_000,
          stdout: 'ignore' as const,
          stderr: 'pipe' as const,
        },
      }),
});
