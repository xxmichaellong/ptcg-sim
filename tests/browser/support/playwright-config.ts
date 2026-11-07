import {
  devices,
  type PlaywrightTestConfig,
  type ReporterDescription,
} from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What the root playwright.*.config.ts files share. */

export const CI = Boolean(process.env['CI']);

/** One spec at a time, from tests/browser. */
export const lane = {
  // Maps Lingui's macros to English stand-ins for the app code specs load
  // in Node (support/lingui-macro.ts, ADR-034).
  tsconfig: './tsconfig.playwright.json',
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: CI,
  workers: 1,
} satisfies PlaywrightTestConfig;

/** GitHub annotations on CI, the list locally, and an HTML report. */
export const reporter = (
  outputFolder = 'playwright-report',
  ...more: ReporterDescription[]
): ReporterDescription[] => [
  CI ? ['github'] : ['list'],
  ['html', { open: 'never', outputFolder }],
  ...more,
];

/** Chromium at 1280×720, on SwiftShader, or PTCGSIM_CHROMIUM_PATH. */
export const chromium = {
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    // Kept, so a spec's phone device can't move it to that phone's browser.
    browserName: 'chromium' as const,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      executablePath: process.env['PTCGSIM_CHROMIUM_PATH'],
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
};

const shellSingleQuote = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The built app and the Worker on one Wrangler origin, with these bindings
 * passed on the command line, never in the deployable configuration.
 */
export const builtApp = (
  port: number,
  bindings: Readonly<Record<string, string>> = {},
  wranglerFlags = ''
) => ({
  command: [
    'corepack pnpm --filter @ptcgsim/web run build &&',
    `corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port ${port}`,
    wranglerFlags,
    ...Object.entries({
      ...bindings,
      CARD_CATALOG_SOURCE: 'off',
      DECK_INDEX_SOURCE: 'off',
    }).map(([name, value]) => `--var ${shellSingleQuote(`${name}:${value}`)}`),
  ]
    .filter(Boolean)
    .join(' '),
  url: `http://127.0.0.1:${port}/v2/health`,
  reuseExistingServer: false,
  timeout: 90_000,
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
});

/** The Vite app on 4173 over the Worker on 8787, as `dev:v2` serves it. */
export const devServers = [
  {
    ...builtApp(8787),
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
  {
    command:
      'corepack pnpm --filter @ptcgsim/web dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !CI,
    timeout: 30_000,
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
  },
];

/**
 * Test-only continuation bindings: a fixed key and a four-by-four quota.
 * Each run's Worker also starts from empty Durable Object storage, since
 * the specs use a fixed room code whose continuation ledger (and its
 * per-player creation limit) would otherwise carry over between runs.
 */
export const continuationWorker = (
  port: number,
  bindings: {
    readonly BUILD_ID: string;
    readonly CONTINUATION_HTTP_ACTIVATION: string;
  }
) =>
  builtApp(
    port,
    {
      ...bindings,
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
    },
    `--persist-to ${join(tmpdir(), `ptcgsim-continuation-${port}-${process.pid}-${Date.now()}`)}`
  );

/** An HTTPS origin, or HTTP on loopback only; the variable named if not. */
export const exactOrigin = (value: string, variable: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} must be an HTTP(S) origin`);
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    throw new Error(`${variable} must be an HTTP(S) origin`);
  }
  const loopback = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']).has(
    parsed.hostname
  );
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new Error(
      `${variable} requires HTTPS; HTTP is allowed only for loopback rehearsal`
    );
  }
  return parsed.origin;
};
