import { expect, test } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

for (const phone of [
  { locale: 'en', width: 568, height: 320 },
  { locale: 'es', width: 568, height: 320 },
  { locale: 'ar', width: 568, height: 320 },
  { locale: 'ru', width: 812, height: 375 },
]) {
  test.describe(`${phone.locale} landscape ${phone.width}×${phone.height}`, () => {
    test.use({
      locale: phone.locale,
      viewport: { width: phone.width, height: phone.height },
      isMobile: true,
      hasTouch: true,
    });

    test('can reach card results, filters and the name on a short screen', async ({
      context,
      page,
    }) => {
      await ownRoomBudget(context);
      await routeCardCatalog(page);
      await page.goto('/?renderer=dom');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await openDeck(page);
      await page.locator('#deckNewButton').click();
      const name = page.locator('#deckNameInput');
      await name.fill('Pidgey');
      await name.press('Enter');

      // A short window can scroll its editor; a zero-height clipped pane
      // cannot bring its cards into view or receive a finger's tap.
      const card = page.locator('.card-search__grid .card-result').first();
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport({ ratio: 0.5 });
      await card.tap();
      await expect(
        page.locator('.deck-editor__tabs button').nth(1)
      ).toContainText('1');
      const more = page.locator('.card-search__more');
      await more.tap();
      await expect(page.locator('.card-search__advanced')).toBeVisible();
      await page.locator('.card-search__advanced-actions button').nth(1).tap();
      await expect(page.locator('.card-search__advanced')).toBeHidden();
      const deckTab = page.locator('.deck-editor__tabs button').nth(1);
      await deckTab.tap();
      await expect(
        page.locator('.deck-panel .deck-check__count strong')
      ).toHaveText('1');
      await expect(page.locator('.deck-editor__pane--deck')).toBeInViewport();
      await name.fill('Landscape deck');
      await name.press('Enter');
      await expect(name).toHaveValue('Landscape deck');
      await expect(name).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      await expect(page.locator('.ptcgsim-deck-layer')).toHaveAttribute(
        'data-open',
        'false'
      );
    });
  });
}
