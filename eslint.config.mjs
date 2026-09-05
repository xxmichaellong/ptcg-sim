import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const v2TypeScriptFiles = [
  'apps/**/*.{ts,tsx}',
  'packages/**/*.{ts,tsx}',
  'tests/**/*.{ts,tsx}',
  '*.config.ts',
];

const scopeToV2TypeScript = (config) => ({
  ...config,
  files: v2TypeScriptFiles,
});

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/*.tsbuildinfo',
      'apps/server/worker-configuration.d.ts',
      'artifacts/**',
      'client/**',
      // Wrangler writes generated bundles here whenever `wrangler dev` runs,
      // which the browser gate now does. They are git-ignored build output.
      '**/.wrangler/**',
      'playwright-report/**',
      'server/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map(scopeToV2TypeScript),
  prettier,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: v2TypeScriptFiles,
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['apps/server/runtime-tests/**/*.d.ts'],
    rules: {
      // Empty declaration-merging interfaces are meaningful ambient hooks.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
