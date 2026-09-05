import { test } from '@playwright/test';

import {
  assertLowerNonzeroTopThenOtherLowerGroupAfterSingleLiveCapture,
  assertLowerNonzeroTopThenOtherLowerGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroTopThenOtherLowerGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('top-then-other-lower top-BREAK oracle pins recursive source, exact successor collision, and its 24-case partition', async () => {
  await assertLowerNonzeroTopThenOtherLowerGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins top-BREAK top-then-other-lower group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK top-then-other-lower checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroTopThenOtherLowerGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroTopThenOtherLowerGroupAfterSingleBreakFixture
  );
});
