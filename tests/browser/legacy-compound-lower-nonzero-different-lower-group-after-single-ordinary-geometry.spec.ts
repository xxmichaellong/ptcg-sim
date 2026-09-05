import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('different-lower ordinary group-after-single oracle pins recursive source, initiator deltas, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerGroupAfterSingleOracleIntegrity(
    'ordinary'
  );
});

test('checked-in legacy lower R pins ordinary different-lower group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary different-lower group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleOrdinaryFixture
  );
});
