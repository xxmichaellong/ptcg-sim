import { expect, test } from '@playwright/test';

import {
  fillPile,
  ids,
  openPile,
  picked,
  preparePileContext,
  revision,
} from './support/public-pile.js';

test.beforeEach(async ({ context, page }) => {
  await preparePileContext(context, page);
});

for (const locale of ['ru', 'ar']) {
  test.describe(`320px ${locale} phone`, () => {
    test.use({
      viewport: { width: 320, height: 740 },
      locale,
      isMobile: true,
      hasTouch: true,
    });
    test('keeps both same-pile actions in reach and closes with one Escape', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const { cardIds } = await fillPile(page, 'lostZone');
      const browser = await openPile(page, 'lostZone');
      await picked(page, cardIds.at(-1)!).tap();
      const bottom = browser.locator('[data-card-action="pile-bottom"]');
      await expect(bottom).toBeEnabled();
      for (const button of await browser
        .locator('.ptcgsim-card-actions button')
        .all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
      const before = await revision(page);
      await bottom.tap();
      await expect.poll(() => revision(page)).toBe(before + 1);
      await expect
        .poll(() => ids(page, 'lostZone'))
        .toEqual([cardIds.at(-1), ...cardIds.slice(0, -1)]);
      await page.keyboard.press('Escape');
      await expect(browser).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
