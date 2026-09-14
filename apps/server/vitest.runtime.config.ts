import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

import { continuationTestKeyring } from './runtime-tests/continuation-test-keyring.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          CONTINUATION_KEYRING: continuationTestKeyring,
        },
      },
    }),
  ],
  test: {
    include: ['runtime-tests/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    restoreMocks: true,
  },
});
