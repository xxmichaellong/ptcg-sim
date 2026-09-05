import { test } from '@playwright/test';

import {
  assertLowerNonzeroFollowupLiveCapture,
  assertLowerNonzeroFollowupOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-single-followup-assertions.js';
import { captureLegacySourceCompoundLowerNonzeroGroupSingleFollowupOrdinaryFixture } from './support/legacy-source-board.js';

test('lower nonzero ordinary follow-up oracle pins recursive source, its predecessor, and the 24-case partition', async () => {
  await assertLowerNonzeroFollowupOracleIntegrity('ordinary');
});

test('checked-in legacy lower Alt-R pins the ordinary same-card q1/q2/q3 follow-up matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary follow-up checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroFollowupLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroGroupSingleFollowupOrdinaryFixture
  );
});
