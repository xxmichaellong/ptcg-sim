import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('different-lower BREAK group-after-single oracle pins recursive source, signed deltas, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins BREAK different-lower group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero BREAK different-lower group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerGroupAfterSingleBreakFixture
  );
});
