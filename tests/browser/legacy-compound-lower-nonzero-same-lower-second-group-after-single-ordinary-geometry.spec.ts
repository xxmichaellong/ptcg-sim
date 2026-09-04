import { test } from '@playwright/test';

import {
  assertLowerNonzeroSameLowerSecondGroupAfterSingleLiveCapture,
  assertLowerNonzeroSameLowerSecondGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-same-lower-second-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('same-lower ordinary group-after-single oracle pins recursive source, repeat collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroSameLowerSecondGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary same-lower second group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary same-lower second-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroSameLowerSecondGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleOrdinaryFixture
  );
});
