import { test } from '@playwright/test';

import { captureLegacySourceCompoundLowerNonzeroGroupSingleOrdinaryFixture } from './support/legacy-source-board.js';
import {
  assertLowerNonzeroLiveCapture,
  assertLowerNonzeroOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-single-assertions.js';

test('lower nonzero ordinary oracle pins direct source, dependencies, and its 24-case partition', async () => {
  await assertLowerNonzeroOracleIntegrity('ordinary');
});

test('checked-in legacy lower Alt-R pins the ordinary q1/q2/q3 matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero ordinary checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroLiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerNonzeroGroupSingleOrdinaryFixture
  );
});
