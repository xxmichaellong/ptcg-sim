import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerSecondGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerSecondGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-second-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerSecondGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('same-other-lower ordinary group-after-single oracle pins recursive source, successor collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerSecondGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary different-lower second group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary different-lower second-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerSecondGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerSecondGroupAfterSingleOrdinaryFixture
  );
});
