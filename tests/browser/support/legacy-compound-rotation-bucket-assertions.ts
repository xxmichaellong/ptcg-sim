import { expect } from '@playwright/test';

import {
  legacyCompoundRotationCaseBuckets,
  type LegacyCompoundRotationCaseBucket,
  type LegacySourceCompoundRotationFixture,
} from './legacy-source-board.js';

type LegacyCompoundRotationAllowedBuckets =
  | readonly ['ordinaryGroupCases', 'breakGroupCases']
  | readonly [
      Exclude<
        LegacyCompoundRotationCaseBucket,
        'ordinaryGroupCases' | 'breakGroupCases'
      >,
    ];

/**
 * Proves that a compound capture cannot leak into any bucket other than the
 * explicitly allowed target. The source-board bucket tuple is exhaustive, so
 * adding a future bucket automatically extends every existing isolation check.
 * Positive target IDs and contents remain the responsibility of each suite.
 */
export const expectLegacyCompoundRotationBucketIsolation = (
  capture: LegacySourceCompoundRotationFixture,
  ...allowedBuckets: LegacyCompoundRotationAllowedBuckets
): void => {
  const runtimeBuckets = allowedBuckets as readonly string[];
  const declaredBuckets = new Set<string>(legacyCompoundRotationCaseBuckets);
  const [firstBucket, secondBucket] = runtimeBuckets;
  const isCanonicalPair =
    runtimeBuckets.length === 2 &&
    firstBucket === 'ordinaryGroupCases' &&
    secondBucket === 'breakGroupCases';
  const isNoncanonicalSingleton =
    runtimeBuckets.length === 1 &&
    typeof firstBucket === 'string' &&
    firstBucket !== 'ordinaryGroupCases' &&
    firstBucket !== 'breakGroupCases' &&
    declaredBuckets.has(firstBucket);
  if (!isCanonicalPair && !isNoncanonicalSingleton) {
    throw new Error(
      'Legacy compound isolation requires one noncanonical bucket or the ordered ordinary/BREAK pair'
    );
  }

  const allowed = new Set<LegacyCompoundRotationCaseBucket>(allowedBuckets);

  for (const bucket of legacyCompoundRotationCaseBuckets) {
    if (!allowed.has(bucket)) {
      expect(capture[bucket], `${bucket} must be empty`).toEqual([]);
    }
  }
};
