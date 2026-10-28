import { expect, test } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

test.beforeEach(async ({ page, context }) => {
  await ownRoomBudget(context);
  await routeCardCatalog(page);
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  await page.locator('#deckNewButton').click();
});

for (const closeWith of ['Escape', 'submit'] as const) {
  test(`custom cards return keyboard focus after ${closeWith}, and the next Escape leaves the deck`, async ({
    page,
  }) => {
    const custom = page.locator('#nativeDeckBuilderAddCustomCard');
    await custom.focus();
    await page.keyboard.press('Enter');
    const modal = page.locator('#nativeDeckBuilderCustomCardModal');
    await expect(page.locator('#nativeCustomCardName')).toBeFocused();
    if (closeWith === 'submit') {
      await page.locator('#nativeCustomCardName').fill('Proxy');
      await page
        .locator('#nativeCustomCardImageUrl')
        .fill(new URL('/v2/assets/cardback.png', page.url()).href);
      await expect(page.locator('#nativeCustomCardPreviewImage')).toBeVisible();
      await page.locator('#nativeCustomCardSubmit').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).toBeHidden();
    await expect(custom).toBeFocused();
    // A tooltip opened by script focus would consume this next Escape.
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ptcgsim-deck-layer')).toHaveAttribute(
      'data-open',
      'false'
    );
  });
}

test.describe('a German phone', () => {
  test.use({
    locale: 'de',
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  });

  test('keeps both translated custom-card actions fully reachable', async ({
    page,
  }) => {
    await page.locator('#nativeDeckBuilderAddCustomCard').click();
    const actions = page.locator('.native-deck-builder-modal-actions');
    await actions.scrollIntoViewIfNeeded();
    for (const id of ['nativeCustomCardCancel', 'nativeCustomCardSubmit']) {
      const button = page.locator(`#${id}`);
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await page.locator('#nativeCustomCardCancel').click();
    await expect(page.locator('#nativeDeckBuilderAddCustomCard')).toBeFocused();
  });
});
