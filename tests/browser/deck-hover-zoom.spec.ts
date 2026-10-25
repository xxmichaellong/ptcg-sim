import { expect, test } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

test.beforeEach(async ({ context, page }) => {
  await ownRoomBudget(context);
  await routeCardCatalog(page);
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await openDeck(page);
  await page.locator('#deckNewButton').click();
  await page.locator('#nativeDeckBuilderSearchInput').fill('t:dragon');
  await expect(page.locator('.card-result').first()).toContainText('Dragapult');
});

for (const shown of [false, true]) {
  test(`filtering away a ${shown ? 'shown' : 'pending'} hovered result clears its zoom with the pointer still`, async ({
    page,
  }) => {
    const card = page.locator('.card-result').first();
    const source = await card.elementHandle();
    await card.hover();
    if (shown) await expect(page.locator('.deck-zoom')).toBeVisible();
    // Hovering does not take focus out of Search. Real typing can remove
    // the card without generating pointerleave on its detached button.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('zzzz');
    await expect(page.locator('.card-result')).toHaveCount(0);
    expect(await source!.evaluate((node) => node.isConnected)).toBe(false);
    // Let the original 140ms show/release delay pass before asserting.
    await page.waitForTimeout(200);
    await expect(page.locator('.deck-zoom')).toHaveCount(0);
    await page.locator('#nativeDeckBuilderSearchInput').fill('judge');
    await page.locator('.card-result').first().hover();
    await expect(page.locator('.deck-zoom')).toBeVisible();
  });
}

test('Undo removes a hovered deck row and its shown zoom', async ({ page }) => {
  await page.locator('.card-result').first().click();
  const row = page.locator('[data-deck-card] .deck-row__card').first();
  const source = await row.elementHandle();
  await row.hover();
  await expect(page.locator('.deck-zoom')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-deck-card]')).toHaveCount(0);
  expect(await source!.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.locator('.deck-zoom')).toHaveCount(0);
});
