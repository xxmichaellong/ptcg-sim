import { test } from '@playwright/test';

import {
  assertLowerNonzeroTopSecondGroupAfterSingleLiveCapture,
  assertLowerNonzeroTopSecondGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-top-second-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroTopSecondGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-top top-BREAK group-after-single oracle pins recursive source, successor collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroTopSecondGroupAfterSingleOracleIntegrity('break');
});

test('checked-in legacy lower R pins top-BREAK top second group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK top second-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroTopSecondGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroTopSecondGroupAfterSingleBreakFixture
  );
});
