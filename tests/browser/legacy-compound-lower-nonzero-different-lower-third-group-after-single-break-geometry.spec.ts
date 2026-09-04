import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerThirdGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerThirdGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-third-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerThirdGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-other-lower top-BREAK group-after-single oracle pins recursive source, successor collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerThirdGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins top-BREAK different-lower third group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK different-lower third-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerThirdGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerThirdGroupAfterSingleBreakFixture
  );
});
