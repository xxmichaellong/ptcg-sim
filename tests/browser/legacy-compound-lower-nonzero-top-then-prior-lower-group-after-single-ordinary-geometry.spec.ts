import { test } from '@playwright/test';

import {
  assertLowerNonzeroTopThenPriorLowerGroupAfterSingleLiveCapture,
  assertLowerNonzeroTopThenPriorLowerGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroTopThenPriorLowerGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('top-then-prior-lower ordinary oracle pins recursive source, exact successor collision, and its 24-case partition', async () => {
  await assertLowerNonzeroTopThenPriorLowerGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary top-then-prior-lower group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary top-then-prior-lower checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroTopThenPriorLowerGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroTopThenPriorLowerGroupAfterSingleOrdinaryFixture
  );
});
