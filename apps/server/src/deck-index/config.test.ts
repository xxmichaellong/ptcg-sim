import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { experimental_readRawConfig } from 'wrangler';

const configPath = fileURLToPath(
  new URL('../../wrangler.jsonc', import.meta.url)
);

describe('the deck index as deployed', () => {
  it('ships off for production and the preview, until the account is on Workers Paid', () => {
    // A deploy that forgets --var DECK_INDEX_SOURCE:off must not crawl: on
    // the Free plan the crawl's rows took every Durable Object down.
    const { rawConfig } = experimental_readRawConfig({ config: configPath });
    expect(rawConfig.vars?.['DECK_INDEX_SOURCE']).toBe('off');
    expect(rawConfig.env?.['preview']?.vars?.['DECK_INDEX_SOURCE']).toBe('off');
  });
});
