import { test } from '@playwright/test';

import {
  assertLowerNonzeroSameLowerGroupAfterSingleLiveCapture,
  assertLowerNonzeroSameLowerGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-same-lower-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroSameLowerGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-lower top-BREAK group-after-single oracle pins recursive source, initiator deltas, and its 24-case partition', async () => {
  await assertLowerNonzeroSameLowerGroupAfterSingleOracleIntegrity('break');
});

test('checked-in legacy lower R pins top-BREAK same-lower group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK same-lower group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroSameLowerGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroSameLowerGroupAfterSingleBreakFixture
  );
});
