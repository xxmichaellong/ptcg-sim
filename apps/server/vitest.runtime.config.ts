import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

import { continuationTestKeyring } from './runtime-tests/continuation-test-keyring.js';
import { continuationTestQuotaConfiguration } from './runtime-tests/continuation-test-quota-configuration.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          CONTINUATION_KEYRING: continuationTestKeyring,
          CONTINUATION_QUOTA_CONFIGURATION: continuationTestQuotaConfiguration,
        },
      },
    }),
  ],
  test: {
    include: ['runtime-tests/**/*.test.ts'],
    exclude: [
      'runtime-tests/continuation-http-runtime.test.ts',
      'runtime-tests/continuation-drain-runtime.test.ts',
    ],
    passWithNoTests: false,
    reporters: ['default'],
    restoreMocks: true,
  },
});
