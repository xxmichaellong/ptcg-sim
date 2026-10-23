import type { CatalogFormatter, CatalogType, LinguiConfig } from '@lingui/conf';

import { LOCALES, SOURCE_LOCALE } from './apps/web/src/i18n/locales.js';

/**
 * Writes catalogs holding only the fields that describe a message. Lingui's
 * other fields (`origin`, `placeholders`, `extra`) are re-derived from source
 * on every extract, so committing them would churn every catalog. Built field
 * by field, so a field a future Lingui adds never appears in them unasked.
 */
const jsonCatalogFormatter: CatalogFormatter = {
  catalogExtension: '.json',
  parse: (content) => JSON.parse(content) as CatalogType,
  serialize(catalog) {
    const committed: CatalogType = {};
    for (const [id, entry] of Object.entries(catalog)) {
      const { message, context, comments, obsolete, translation } = entry;
      committed[id] = {
        ...(message !== undefined ? { message } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(comments?.length ? { comments } : {}),
        ...(obsolete !== undefined ? { obsolete } : {}),
        translation,
      };
    }
    return `${JSON.stringify(committed, null, 2)}\n`;
  },
};

/**
 * One catalog per language for everything the v2 web app shows (ADR-034).
 * Macros live in the web app and the packages only it bundles; the server's
 * packages (game-core, protocol, room-authority) send codes instead.
 */
const config: LinguiConfig = {
  locales: LOCALES.map(({ locale }) => locale),
  sourceLocale: SOURCE_LOCALE,
  fallbackLocales: { default: SOURCE_LOCALE },
  format: jsonCatalogFormatter,
  runtimeConfigModule: {
    Trans: ['#lingui-react', 'Trans'],
    useLingui: ['#lingui-react', 'useLingui'],
  },
  catalogs: [
    {
      path: '<rootDir>/apps/web/src/locales/{locale}',
      include: [
        '<rootDir>/apps/web/src',
        '<rootDir>/packages/deck-core/src',
        '<rootDir>/packages/renderer-contract/src',
        '<rootDir>/packages/renderer-dom/src',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/dev/**'],
    },
  ],
};

export default config;
