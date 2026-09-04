import { test } from '@playwright/test';

import {
  assertLowerNonzeroGroupAfterSingleLiveCapture,
  assertLowerNonzeroGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-rotation-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('lower nonzero top-BREAK group-after-single oracle pins recursive source, collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroGroupAfterSingleOracleIntegrity('break');
});

test('checked-in legacy top R pins the top-BREAK group rotation after lower divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleBreakFixture
  );
});
