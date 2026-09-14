import {
  MAXIMUM_CONTINUATION_QUOTA_LEASES_PER_SHARD,
  MAXIMUM_CONTINUATION_QUOTA_SHARDS,
  type ContinuationQuotaShardPolicy,
} from './continuation-quota.js';

export const CONTINUATION_QUOTA_CONFIGURATION_FORMAT =
  'ptcgsim-continuation-quota-configuration-v1' as const;
export const MAXIMUM_CONTINUATION_QUOTA_CONFIGURATION_CODE_UNITS = 256;

export interface ContinuationQuotaConfiguration {
  readonly format: typeof CONTINUATION_QUOTA_CONFIGURATION_FORMAT;
  readonly shardCount: number;
  readonly maximumActiveLeasesPerShard: number;
  readonly maximumActiveLeases: number;
  readonly shardPolicy: ContinuationQuotaShardPolicy;
}

export type ContinuationQuotaConfigurationFailure =
  | 'missing'
  | 'oversized'
  | 'malformed'
  | 'unsupported_format'
  | 'invalid_configuration';

/** Safe to report: this error never includes configuration contents. */
export class ContinuationQuotaConfigurationError extends Error {
  constructor(readonly failure: ContinuationQuotaConfigurationFailure) {
    super('Continuation quota configuration is invalid');
    this.name = 'ContinuationQuotaConfigurationError';
  }
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

export const readContinuationQuotaConfiguration = (
  configuration: unknown
): ContinuationQuotaConfiguration => {
  if (typeof configuration !== 'string' || configuration.length === 0) {
    throw new ContinuationQuotaConfigurationError('missing');
  }
  if (
    configuration.length > MAXIMUM_CONTINUATION_QUOTA_CONFIGURATION_CODE_UNITS
  ) {
    throw new ContinuationQuotaConfigurationError('oversized');
  }
  let value: unknown;
  try {
    value = JSON.parse(configuration) as unknown;
  } catch {
    throw new ContinuationQuotaConfigurationError('malformed');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['format', 'maximumActiveLeasesPerShard', 'shardCount'])
  ) {
    throw new ContinuationQuotaConfigurationError('invalid_configuration');
  }
  if (
    Reflect.get(value, 'format') !== CONTINUATION_QUOTA_CONFIGURATION_FORMAT
  ) {
    throw new ContinuationQuotaConfigurationError('unsupported_format');
  }
  const shardCount = Reflect.get(value, 'shardCount');
  const maximumActiveLeasesPerShard = Reflect.get(
    value,
    'maximumActiveLeasesPerShard'
  );
  if (
    typeof shardCount !== 'number' ||
    !Number.isSafeInteger(shardCount) ||
    shardCount < 1 ||
    shardCount > MAXIMUM_CONTINUATION_QUOTA_SHARDS ||
    typeof maximumActiveLeasesPerShard !== 'number' ||
    !Number.isSafeInteger(maximumActiveLeasesPerShard) ||
    maximumActiveLeasesPerShard < 1 ||
    maximumActiveLeasesPerShard > MAXIMUM_CONTINUATION_QUOTA_LEASES_PER_SHARD
  ) {
    throw new ContinuationQuotaConfigurationError('invalid_configuration');
  }
  const maximumActiveLeases = shardCount * maximumActiveLeasesPerShard;
  if (!Number.isSafeInteger(maximumActiveLeases)) {
    throw new ContinuationQuotaConfigurationError('invalid_configuration');
  }
  return Object.freeze({
    format: CONTINUATION_QUOTA_CONFIGURATION_FORMAT,
    shardCount,
    maximumActiveLeasesPerShard,
    maximumActiveLeases,
    shardPolicy: Object.freeze({
      maximumActiveLeases: maximumActiveLeasesPerShard,
    }),
  });
};
