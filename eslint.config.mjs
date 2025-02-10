import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettier,
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.js'],
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
      'no-unused-vars': 'warn',
      'no-console': 'warn',
      'prettier/prettier': [
        'warn',
        {
          endOfLine: 'auto',
        },
      ],
    },
  },
];
