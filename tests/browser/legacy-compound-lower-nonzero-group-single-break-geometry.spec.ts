import { test } from '@playwright/test';

import { captureLegacySourceCompoundLowerNonzeroGroupSingleBreakFixture } from './support/legacy-source-board.js';
import {
  assertLowerNonzeroLiveCapture,
  assertLowerNonzeroOracleIntegrity,
} from './support/legacy-compound-lower-nonzero-group-single-assertions.js';

test('lower nonzero top-BREAK oracle pins direct source, dependencies, and its 24-case partition', async () => {
  await assertLowerNonzeroOracleIntegrity('break');
});

test('checked-in legacy lower Alt-R pins the top-BREAK q1/q2/q3 matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-nonzero top-BREAK checkpoint is Chromium-specific.'
  );
  await assertLowerNonzeroLiveCapture(
    page,
    testInfo,
    'break',
    captureLegacySourceCompoundLowerNonzeroGroupSingleBreakFixture
  );
});
