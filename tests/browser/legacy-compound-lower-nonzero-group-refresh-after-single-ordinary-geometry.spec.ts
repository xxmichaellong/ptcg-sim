import { test } from '@playwright/test';

import {
  assertLowerNonzeroGroupRefreshLiveCapture,
  assertLowerNonzeroGroupRefreshOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-refresh-after-single-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleOrdinaryFixture } from './support/legacy-source-board.js';

test('lower nonzero ordinary refresh-after-single oracle pins recursive source and its 24-case partition', async () => {
  await assertLowerNonzeroGroupRefreshOracleIntegrity('ordinary');
});

test('checked-in legacy refresh reconstructs ordinary lower-divergent groups', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary refresh checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroGroupRefreshLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroGroupRefreshAfterSingleOrdinaryFixture
  );
});
