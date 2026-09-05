import { test } from '@playwright/test';

import {
  assertLowerNonzeroTopThirdGroupAfterSingleLiveCapture,
  assertLowerNonzeroTopThirdGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-top-third-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroTopThirdGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('third-top top-BREAK group-after-single oracle pins recursive source, checkpoint-22 collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroTopThirdGroupAfterSingleOracleIntegrity('break');
});

test('checked-in legacy lower R pins top-BREAK top third group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK top third-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroTopThirdGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroTopThirdGroupAfterSingleBreakFixture
  );
});
