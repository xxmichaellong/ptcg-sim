import { test } from '@playwright/test';

import {
  assertLowerNonzeroSameLowerSecondGroupAfterSingleLiveCapture,
  assertLowerNonzeroSameLowerSecondGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-same-lower-second-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-lower top-BREAK group-after-single oracle pins recursive source, repeat collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroSameLowerSecondGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins top-BREAK same-lower second group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK same-lower second-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroSameLowerSecondGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroSameLowerSecondGroupAfterSingleBreakFixture
  );
});
