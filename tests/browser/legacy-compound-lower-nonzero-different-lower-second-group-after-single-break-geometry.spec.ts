import { test } from '@playwright/test';

import {
  assertLowerNonzeroDifferentLowerSecondGroupAfterSingleLiveCapture,
  assertLowerNonzeroDifferentLowerSecondGroupAfterSingleOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-different-lower-second-group-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroDifferentLowerSecondGroupAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('same-other-lower top-BREAK group-after-single oracle pins recursive source, successor collisions, and its 24-case partition', async () => {
  await assertLowerNonzeroDifferentLowerSecondGroupAfterSingleOracleIntegrity(
    'break'
  );
});

test('checked-in legacy lower R pins top-BREAK different-lower second group rotation after divergence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK different-lower second-group-after-single checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroDifferentLowerSecondGroupAfterSingleLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroDifferentLowerSecondGroupAfterSingleBreakFixture
  );
});
