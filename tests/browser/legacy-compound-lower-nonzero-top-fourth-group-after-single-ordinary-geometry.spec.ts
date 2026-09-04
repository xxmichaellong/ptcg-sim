import { test } from '@playwright/test';

import {
  assertLowerNonzeroTopFourthGroupAfterSingleLiveCapture,
  assertLowerNonzeroTopFourthGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-top-fourth-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroTopFourthGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('fourth-top ordinary oracle pins recursive source, checkpoint-28 periodicity, checkpoint-18 history, and its partition', async () => {
  await assertLowerNonzeroTopFourthGroupAfterSingleOracleIntegrity('ordinary');
});

test('checked-in legacy lower R pins ordinary top fourth group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary top fourth-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroTopFourthGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroTopFourthGroupAfterSingleOrdinaryFixture
  );
});
