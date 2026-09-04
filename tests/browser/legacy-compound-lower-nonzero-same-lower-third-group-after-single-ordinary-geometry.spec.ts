import { test } from '@playwright/test';

import {
  assertLowerNonzeroSameLowerThirdGroupAfterSingleLiveCapture,
  assertLowerNonzeroSameLowerThirdGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-same-lower-third-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroSameLowerThirdGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('same-lower ordinary group-after-single oracle pins recursive source, repeat collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroSameLowerThirdGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary same-lower third group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary same-lower third-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroSameLowerThirdGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroSameLowerThirdGroupAfterSingleOrdinaryFixture
  );
});
