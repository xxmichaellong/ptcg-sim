import { defineConfig } from '@playwright/test';

import { CONTINUATION_HTTP_DRAIN_VALUE } from './apps/server/src/continuation-http-activation.js';

const LOCAL_CONTINUATION_DRAIN_URL = 'http://127.0.0.1:4177';
const externalContinuationPreviewUrl =
  process.env['PTCGSIM_CONTINUATION_PREVIEW_URL']?.trim();

const exactOrigin = (value: string, variable: string): string => {
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
  const loopbackHost = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']).has(
    parsed.hostname
  );
  if (parsed.protocol !== 'https:' && !loopbackHost) {
    throw new Error(
      `${variable} requires HTTPS; HTTP is allowed only for loopback rehearsal`
    );
  }
  return parsed.origin;
};

const continuationDrainUrl = exactOrigin(
  externalContinuationPreviewUrl || LOCAL_CONTINUATION_DRAIN_URL,
  'PTCGSIM_CONTINUATION_PREVIEW_URL'
);

const shellSingleQuote = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

const continuationVariables = Object.entries({
  BUILD_ID: 'continuation-drain-browser-test',
  CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_DRAIN_VALUE,
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
 * Exact rollout-drain HTTP proof. It can target a managed preview explicitly;
 * the local lane injects only deterministic test bindings on Wrangler's
 * command line and never changes the deployable configuration.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'continuation-drain.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/continuation-drain',
  reporter: [['list']],
  use: {
    baseURL: continuationDrainUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
  ...(externalContinuationPreviewUrl
    ? {}
    : {
        webServer: {
          command: `corepack pnpm --filter @ptcgsim/web run build && corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 4177 ${continuationVariables}`,
          url: `${LOCAL_CONTINUATION_DRAIN_URL}/v2/health`,
          reuseExistingServer: false,
          timeout: 90_000,
          stdout: 'ignore' as const,
          stderr: 'pipe' as const,
        },
      }),
});
