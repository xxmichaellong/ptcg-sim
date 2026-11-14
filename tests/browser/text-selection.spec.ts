import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  closeSheet,
  dismissWelcome,
  openSettings,
} from './support/table-shell.js';

/**
 * A game, not a page: a double tap or a double click on the table's
 * chrome selects no words (a double tap once selected a whole menu's
 * items); a field still selects what is typed in it.
 */

const selected = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? '');

test('a double click on the bar or a panel selects no words; a field still does', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);

  // The bar's Solo, pressed already: a double click does nothing else.
  await page.locator('.ptcgsim-app-bar #p1Button').dblclick();
  expect(await selected(page)).toBe('');

  await openSettings(page, 'table');
  const heading = page.locator('#settings h2, #settings h3').first();
  await heading.dblclick();
  expect(await selected(page)).toBe('');
  const label = page.locator('#settings').getByText('Dark mode', {
    exact: true,
  });
  await label.click({ clickCount: 3 });
  expect(await selected(page)).toBe('');
  await closeSheet(page);
  await expect(page.locator('#settings')).toHaveCount(0);

  // The palette's field: what is typed selects as ever.
  await page.keyboard.press('Control+k');
  const field = page
    .locator('[role="dialog"] input, [role="combobox"]')
    .first();
  await field.fill('settings');
  await field.dblclick();
  expect(await selected(page)).toBe('settings');
});
