import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, openToolbar } from './support/table-shell.js';

/**
 * Every icon-only control names itself in a tooltip on a mouse's hover (or
 * a keyboard's focus), with its key where it has one. The tooltip never
 * takes the control's id or name, never lies over an open menu, and never
 * opens for a finger's tap.
 */

const openSoloTable = async (page: Page): Promise<void> => {
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer-status="ready"]')).toBeAttached();
  await dismissWelcome(page);
};

/** The tooltip showing now (not one fading out). */
const tooltip = (page: Page) =>
  page.locator('[data-ptcgsim-overlay="tooltip"]:not([data-ending-style])');

/**
 * Rests the mouse on `target` from somewhere neutral, nothing focused (a
 * focused control shows its own tooltip); the tooltip it gets.
 */
const hover = async (page: Page, selector: string) => {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(2, 2);
  await expect(tooltip(page)).toHaveCount(0);
  await page.locator(selector).hover();
  return tooltip(page);
};

test('icon controls name themselves, with their keys, on hover', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSoloTable(page);

  // The hand's Sort, at the end of its count pill (which shows the count
  // alone, PX-046).
  const sort = '.table-hand-pill--local .table-hand-pill__sort';
  await expect(page.locator('.table-hand-pill--local')).toHaveText('0Sort');
  expect(
    await page
      .locator('.table-hand-pill--local .table-hand-pill__count')
      .evaluate((count) => getComputedStyle(count, '::before').content)
  ).toBe('none');
  await expect(await hover(page, sort)).toHaveText(
    'Sort hand in decklist order'
  );
  await page.locator(sort).click();
  await expect(page.locator('#sortHandCheckbox')).toBeChecked();
  await expect(await hover(page, sort)).toHaveText('Stop sorting hand');

  // A zone affordance: the empty deck's `+`.
  await expect(
    await hover(page, '[data-load-deck-player][aria-label="Load a deck"]')
  ).toHaveText('Load a deck');

  // The rail's ends: the app toolbar (with a key) and the log.
  await openToolbar(page);
  await expect(await hover(page, '#shortcutsButton')).toHaveText(
    'Keyboard shortcuts ?'
  );
  await expect(
    tooltip(page).locator('kbd.ptcgsim-ui-tooltip__hint')
  ).toHaveText('?');
  await expect(await hover(page, '#activityButton')).toHaveText('Log');

  // A menu's button: named while closed, quiet while its menu is open.
  const more = await hover(page, '#appMoreButton');
  await expect(more).toHaveText('More options');
  await page.locator('#appMoreButton').click();
  await expect(
    page.locator('[role="menu"][aria-labelledby="appMoreButton"]')
  ).toBeVisible();
  await expect(tooltip(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(
    page.locator('[role="menu"][aria-labelledby="appMoreButton"]')
  ).toHaveCount(0);

  // The table's own `+` for the optional pieces.
  await expect(await hover(page, '#tableExtrasButton')).toHaveText(
    'Lost Zone, VSTAR and GX markers'
  );
  await expect(page.locator('#tableExtrasButton')).toHaveAttribute(
    'aria-label',
    'Add to the table'
  );
  await expect(page.locator('#tableExtrasButton')).not.toHaveAttribute(
    'title',
    /./
  );
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a tap never opens a tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openSoloTable(page);
    const sort = page.locator('.table-hand-pill--local .table-hand-pill__sort');
    await sort.tap();
    await expect(page.locator('#sortHandCheckbox')).toBeChecked();
    await page.locator('#activityButton').tap();
    await expect(page.locator('#activitySheet')).toBeVisible();
    // Longer than the tooltip delay: nothing has opened.
    await page.waitForTimeout(800);
    await expect(tooltip(page)).toHaveCount(0);
  });
});
