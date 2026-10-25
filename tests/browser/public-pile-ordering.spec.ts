import { expect, test } from '@playwright/test';

import {
  fillPile,
  ids,
  openPile,
  picked,
  pile,
  preparePileContext,
  revision,
} from './support/public-pile.js';

test.beforeEach(async ({ context, page }) => {
  await preparePileContext(context, page);
});

test('orders individual discard copies through the keyboard, preserves markers, and undoes exactly', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { cardIds } = await fillPile(page, 'discard');
  const originalCards = (await pile(page, 'discard')).cards;
  const browser = await openPile(page, 'discard');
  await expect(browser.locator('[data-overlay-card-id]')).toHaveCount(3);
  await expect(browser.locator('.ptcgsim-zone-copy-badge')).toHaveText('×2');
  const sort = browser.locator('[data-zone-action="sortZone"]');
  await sort.check();
  await picked(page, cardIds[0]!).focus();
  await page.keyboard.press('Enter');
  const top = browser.locator('[data-card-action="pile-top"]');
  const before = await revision(page);
  await top.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect
    .poll(() => ids(page, 'discard'))
    .toEqual([...cardIds.slice(1), cardIds[0]]);
  await expect(sort).not.toBeChecked();
  expect((await pile(page, 'discard')).cards.at(-1)).toEqual(originalCards[0]);
  await expect(browser.locator('[data-overlay-card-id]')).toHaveCount(3);
  await expect(
    browser.locator(`[data-overlay-card-id="${cardIds[1]}"]`)
  ).toHaveCount(1);
  await expect(browser.locator('[data-card-action="pile-top"]')).toBeDisabled();
  await expect(
    browser.locator('[data-card-action="pile-bottom"]')
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await page.locator('#undoButton').click();
  await expect.poll(() => ids(page, 'discard')).toEqual(cardIds);
  expect((await pile(page, 'discard')).cards).toEqual(originalCards);
  expect(errors).toEqual([]);
});
