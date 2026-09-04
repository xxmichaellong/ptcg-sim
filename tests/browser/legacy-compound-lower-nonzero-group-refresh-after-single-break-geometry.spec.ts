import { test } from '@playwright/test';

import {
  assertLowerNonzeroGroupRefreshLiveCapture,
  assertLowerNonzeroGroupRefreshOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-refresh-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleBreakFixture } from './support/legacy-source-board.js';

test('lower nonzero top-BREAK refresh-after-single oracle pins recursive source and its 24-case partition', async () => {
  await assertLowerNonzeroGroupRefreshOracleIntegrity('break');
});

test('checked-in legacy refresh pins top-BREAK normalization and q3 collapse', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK refresh checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroGroupRefreshLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleBreakFixture
  );
});
