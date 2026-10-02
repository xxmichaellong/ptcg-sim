import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

import { CONTINUATION_HTTP_DRAIN_VALUE } from './src/continuation-http-activation.js';
import { continuationTestKeyring } from './runtime-tests/continuation-test-keyring.js';
import { continuationTestQuotaConfiguration } from './runtime-tests/continuation-test-quota-configuration.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          CONTINUATION_HTTP_ACTIVATION: CONTINUATION_HTTP_DRAIN_VALUE,
          CONTINUATION_KEYRING: continuationTestKeyring,
          CONTINUATION_QUOTA_CONFIGURATION: continuationTestQuotaConfiguration,
        },
      },
    }),
  ],
  test: {
    include: ['runtime-tests/continuation-drain-runtime.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    restoreMocks: true,
  },
});
