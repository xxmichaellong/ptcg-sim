import { expect, test } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { useFlatTable } from './support/table-shell.js';

const cases = [
  { locale: 'en', width: 320, height: 740 },
  { locale: 'ar', width: 320, height: 740 },
  { locale: 'fil', width: 320, height: 740 },
  { locale: 'en', width: 812, height: 375 },
  { locale: 'de', width: 812, height: 375 },
];

test.use({ hasTouch: true, isMobile: true });

for (const { locale, width, height } of cases) {
  test(`${locale} ${width}: the tutorial keeps filtered commands tappable and closes outside`, async ({
    context,
    page,
  }) => {
    await ownRoomBudget(context);
    await useFlatTable(page);
    await page.setViewportSize({ width, height });
    await page.addInitScript((language) => {
      localStorage.setItem('ptcgsim.language.v1', JSON.stringify({ language }));
    }, locale);
    await page.goto('/?tutorial=commands&renderer=dom');
    const coach = page.locator('.tutorial-coach[data-tutorial-step]');
    await expect(coach).toHaveAttribute(
      'data-tutorial-step',
      'commands:palette',
      { timeout: 20_000 }
    );
    await page.locator('#commandsButton').tap();
    await expect(coach).toHaveAttribute(
      'data-tutorial-step',
      'commands:palette-draw'
    );
    const palette = page.locator('[data-command-palette]');
    const search = palette.locator('input[role="combobox"]');
    await expect(search).toBeFocused();
    // Filtering makes the palette shorter. The coach must leave its first row.
    await search.fill('draw');
    await palette.locator('[role="option"]').first().tap({ timeout: 5_000 });
    await expect(coach).toHaveAttribute(
      'data-tutorial-step',
      'commands:palette-close'
    );
    await expect(palette).toBeVisible();
    // Preserve the palette's existing one-step-back Escape behavior.
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(palette).toBeVisible();
    await page.touchscreen.tap(4, height / 2);
    await expect(palette).toHaveCount(0);
    await expect(page.locator('[data-tutorial-done="commands"]')).toBeVisible();
  });
}
