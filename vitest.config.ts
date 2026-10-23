import { fileURLToPath } from 'node:url';

import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The web app's Lingui macros compile in tests as in the app (ADR-034).
  plugins: [
    lingui({
      configPath: fileURLToPath(new URL('./lingui.config.ts', import.meta.url)),
      macroTransform: true,
    }),
  ],
  test: {
    coverage: {
      enabled: false,
      provider: 'v8',
    },
    include: [
      'apps/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      'apps/server/runtime-tests/**',
      'tests/browser/**',
    ],
    passWithNoTests: false,
    setupFiles: ['apps/web/src/i18n/test-setup.ts'],
    reporters: ['default'],
    restoreMocks: true,
  },
});
