import { test } from '@playwright/test';

import {
  assertLowerNonzeroGroupAfterSingleLiveCapture,
  assertLowerNonzeroGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-rotation-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('lower nonzero ordinary group-after-single oracle pins recursive source, collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroGroupAfterSingleOracleIntegrity('ordinary');
});

test('checked-in legacy top R pins the ordinary group rotation after lower divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroGroupRotationAfterSingleOrdinaryFixture
  );
});
