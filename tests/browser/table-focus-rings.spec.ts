import { expect, test } from '@playwright/test';

import {
  CONTROLS,
  expectRingShows,
  LOOKS,
  openTable,
} from './support/focus-rings.js';

// The table's focus rings, as support/focus-rings.ts says they must show:
// every look by night, and by day the classic look, the only one whose
// colours change by day (table-art.css), and the parchment desk, the
// nearest to 3:1 under the day lamp.
const NIGHT = true;
const DAY = false;
const when = (darkMode: boolean) => (darkMode ? 'night' : 'day');

// A test a look, each in a room of its own: a pass over every look in one
// test outlasts any sensible timeout on a slow runner.
for (const [art, darkMode] of [
  ...LOOKS.map((look) => [look, NIGHT] as const),
  ['classic', DAY] as const,
]) {
  test(`rings the keyboard’s place on the ${art} table by ${when(darkMode)} at 3:1`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Flat, the controls lie square to the screen shots.
    await openTable(page, art, darkMode, {}, 'flat');
    for (const control of CONTROLS) await expectRingShows(page, control);
    // Sorted, the Sort sits sunk in its socket.
    const sort = page.locator('.table-hand-pill__sort input').first();
    await sort.click();
    await expect(sort).toBeChecked();
    await expectRingShows(page, {
      name: 'hand sort, sorted',
      focus: '.table-hand-pill__sort input',
      ring: '..',
    });
  });
}

// One half on the tilted table: the rail sits past the mat's edge, over the
// desk.
for (const [art, darkMode] of [
  ['classic', NIGHT],
  ['parchment', NIGHT],
  ['cream', NIGHT],
  ['charcoal', NIGHT],
  ['classic', DAY],
  ['parchment', DAY],
] as const) {
  test(`rings the keyboard’s place past the mat’s edge, one half on the tilted ${art} table by ${when(darkMode)}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openTable(page, art, darkMode, { show: 'mine', lostZone: true });
    await expectRingShows(page, CONTROLS[0]!);
  });
}
