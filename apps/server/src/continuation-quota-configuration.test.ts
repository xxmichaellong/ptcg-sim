import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
  MAXIMUM_CONTINUATION_QUOTA_CONFIGURATION_CODE_UNITS,
  ContinuationQuotaConfigurationError,
  readContinuationQuotaConfiguration,
} from './continuation-quota-configuration.js';
import {
  MAXIMUM_CONTINUATION_QUOTA_LEASES_PER_SHARD,
  MAXIMUM_CONTINUATION_QUOTA_SHARDS,
} from './continuation-quota.js';

const configuration = (
  shardCount = 64,
  maximumActiveLeasesPerShard = 128
): string =>
  JSON.stringify({
    format: CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
    shardCount,
    maximumActiveLeasesPerShard,
  });

describe('continuation quota configuration', () => {
  it('returns one frozen exact policy and computed hard ceiling', () => {
    const parsed = readContinuationQuotaConfiguration(configuration());
    expect(parsed).toEqual({
      format: CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
      shardCount: 64,
      maximumActiveLeasesPerShard: 128,
      maximumActiveLeases: 8_192,
      shardPolicy: { maximumActiveLeases: 128 },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.shardPolicy)).toBe(true);
  });

  it.each([
    { value: undefined, failure: 'missing' },
    { value: '', failure: 'missing' },
    {
      value: 'x'.repeat(
        MAXIMUM_CONTINUATION_QUOTA_CONFIGURATION_CODE_UNITS + 1
      ),
      failure: 'oversized',
    },
    { value: '{', failure: 'malformed' },
    { value: 'null', failure: 'invalid_configuration' },
    {
      value: JSON.stringify({
        format: 'ptcgsim-continuation-quota-configuration-v2',
        shardCount: 64,
        maximumActiveLeasesPerShard: 128,
      }),
      failure: 'unsupported_format',
    },
    {
      value: JSON.stringify({
        format: CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
        shardCount: 64,
        maximumActiveLeasesPerShard: 128,
        extra: true,
      }),
      failure: 'invalid_configuration',
    },
    { value: configuration(0), failure: 'invalid_configuration' },
    {
      value: configuration(MAXIMUM_CONTINUATION_QUOTA_SHARDS + 1),
      failure: 'invalid_configuration',
    },
    { value: configuration(1.5), failure: 'invalid_configuration' },
    { value: configuration(1, 0), failure: 'invalid_configuration' },
    {
      value: configuration(1, MAXIMUM_CONTINUATION_QUOTA_LEASES_PER_SHARD + 1),
      failure: 'invalid_configuration',
    },
    { value: configuration(1, 1.5), failure: 'invalid_configuration' },
  ])('fails closed for $failure configuration', ({ value, failure }) => {
    let caught: unknown;
    try {
      readContinuationQuotaConfiguration(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContinuationQuotaConfigurationError);
    expect(caught).toMatchObject({ failure });
  });

  it('never includes malformed configuration contents in its error', () => {
    const sentinel = 'quota-config-that-must-not-be-reported';
    const error = (() => {
      try {
        return readContinuationQuotaConfiguration(sentinel);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ContinuationQuotaConfigurationError);
    expect(String(error)).not.toContain(sentinel);
    expect(JSON.stringify(error)).not.toContain(sentinel);
  });
});
