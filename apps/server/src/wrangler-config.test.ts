import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { experimental_readRawConfig } from 'wrangler';

const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));

describe('the Worker as deployed', () => {
  it('answers a file its assets lack as missing, never with the app page', () => {
    // As the app page, a new build's script asked of an edge that hasn't it
    // yet is kept a year (_headers: /assets/* immutable) and never runs.
    const { rawConfig } = experimental_readRawConfig({ config: configPath });
    expect(rawConfig.assets?.not_found_handling).toBe('none');
  });
});
