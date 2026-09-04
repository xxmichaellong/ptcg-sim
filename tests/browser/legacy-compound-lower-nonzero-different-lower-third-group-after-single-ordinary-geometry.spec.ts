import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerThirdGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerThirdGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-third-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerThirdGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('same-other-lower ordinary group-after-single oracle pins recursive source, successor collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerThirdGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary different-lower third group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary different-lower third-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerThirdGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerThirdGroupAfterSingleOrdinaryFixture
  );
});
