import { test } from '@playwright/test';

import {
  assertLowerNonzeroSameLowerThirdGroupAfterSingleLiveCapture,
  assertLowerNonzeroSameLowerThirdGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-same-lower-third-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroSameLowerThirdGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-lower top-BREAK group-after-single oracle pins recursive source, repeat collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroSameLowerThirdGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins top-BREAK same-lower third group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK same-lower third-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroSameLowerThirdGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroSameLowerThirdGroupAfterSingleBreakFixture
  );
});
