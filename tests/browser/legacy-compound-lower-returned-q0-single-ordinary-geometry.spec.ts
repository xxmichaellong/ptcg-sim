import { test } from '@playwright/test';

import { captureLegacySourceCompoundLowerReturnedQ0SingleOrdinaryFixture } from './support/legacy-source-board.js';
import {
  assertLowerReturnedQ0LiveCapture,
  assertLowerReturnedQ0OracleIntegrity,
} from './support/legacy-compound-lower-returned-q0-single-assertions.js';

test('lower returned-q0 ordinary oracle pins direct source, dependencies, and its 24-case partition', async () => {
  await assertLowerReturnedQ0OracleIntegrity('ordinary');
});

test('checked-in legacy lower Alt-R pins the ordinary returned-q0 matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower returned-q0 ordinary checkpoint is Chromium-specific.'
  );
  await assertLowerReturnedQ0LiveCapture(
    page,
    testInfo,
    'ordinary',
    captureLegacySourceCompoundLowerReturnedQ0SingleOrdinaryFixture
  );
});
