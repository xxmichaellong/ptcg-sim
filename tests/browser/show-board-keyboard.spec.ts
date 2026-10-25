import { expect, test } from '@playwright/test';

import {
  fillPile,
  openPile,
  picked,
  preparePileContext,
  revision,
} from './support/public-pile.js';

test.beforeEach(async ({ context, page }) => {
  await preparePileContext(context, page);
});

test('Show board keeps keyboard focus on Back, then two Escapes return and close the pile', async ({
  page,
}) => {
  const { cardIds } = await fillPile(page, 'discard');
  const browser = await openPile(page, 'discard');
  await picked(page, cardIds[0]!).click();
  await expect(browser.locator('[data-card-action="pile-top"]')).toBeEnabled();
  const back = browser.locator('.ptcgsim-show-board-button');
  // Let entrance motion finish before measuring a stable toolbar position.
  await expect(browser).toHaveCSS('opacity', '1');
  const before = (await back.boundingBox())!;
  await back.click();
  await expect(back).toHaveText('Back to Discard pile');
  await expect
    .poll(async () => Math.abs((await back.boundingBox())!.y - before.y))
    .toBeLessThan(0.5);
  const after = (await back.boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);

  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(back).toBeFocused();
  }
  for (const target of [
    '[data-zone-close]',
    '[data-zone-action="zoom"]',
    '[data-overlay-card-id]',
    '[data-card-action="pile-top"]',
  ]) {
    // Native focus must reject the controls hidden by Show board, too.
    await browser
      .locator(target)
      .first()
      .evaluate((node: HTMLElement) => {
        node.focus();
      });
    await expect(back).toBeFocused();
  }

  await page.keyboard.press('Escape');
  await expect(browser).not.toHaveClass(/is-showing-board/);
  await expect(back).toBeFocused();
  // Restoring Board's tooltip must not consume the second Escape.
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
});

test('Show board removes work-area cards and bulk actions from the keyboard until Back', async ({
  page,
}) => {
  await fillPile(page, 'discard');
  // The room fixture loaded four cards. Undo the five later arrangement
  // commands, leaving them in Deck for the real keyboard inspection action.
  for (let count = 0; count < 5; count += 1) {
    const before = await revision(page);
    await page.locator('#undoButton').click();
    await expect.poll(() => revision(page)).toBe(before + 1);
  }
  await page
    .locator('.ptcgsim-board-surface')
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  const area = page.locator('[data-legacy-work-area="inspection"]');
  await expect(area.locator('[data-work-area-card-id]')).toHaveCount(3);
  await area.locator('[data-work-area-card-id]').first().click();
  const back = area.locator('.ptcgsim-show-board-button');
  await back.click();
  await expect(back).toHaveText('Back to Looking at cards');
  const before = await revision(page);
  const hiddenControls = area.locator(
    '[data-work-area-card-id], [data-work-area-action], .ptcgsim-card-actions button:not(:disabled)'
  );
  for (const control of await hiddenControls.all()) {
    await control.evaluate((node: HTMLElement) => node.focus());
    await expect(back).toBeFocused();
  }
  for (let count = 0; count < 8; count += 1) {
    await page.keyboard.press('Tab');
    const inHiddenControl = await page.evaluate(() =>
      Boolean(
        document.activeElement?.closest(
          '.is-showing-board .ptcgsim-legacy-work-area-cards, .is-showing-board .ptcgsim-legacy-work-area-buttons, .is-showing-board .ptcgsim-card-actions'
        )
      )
    );
    expect(inHiddenControl).toBe(false);
  }
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(area).not.toHaveClass(/is-showing-board/);
  await expect(area.locator('[data-work-area-card-id]')).toHaveCount(3);
  expect(await revision(page)).toBe(before);
  await area.locator('[data-work-area-action="toHand"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(area).toHaveCount(0);
});
