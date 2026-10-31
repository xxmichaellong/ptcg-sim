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

test.describe('a phone turned on its side and back', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  test("keeps a pile card's Move menu beside its button", async ({ page }) => {
    await fillPile(page, 'discard');
    const browser = await openPile(page, 'discard');
    await browser.locator('[data-overlay-card-id]').first().tap();
    const move = browser.locator('[data-card-action="move"]');
    await move.tap();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // On the screen and just above Move (it opens upward), soon after each
    // turn: the pile's window slides to its new place, Move with it, and
    // the menu goes along rather than staying behind for a second.
    const besideMove = () =>
      page.evaluate(() => {
        const popup = [...document.querySelectorAll('[role="menu"]')].find(
          (element) => !element.hasAttribute('data-ending-style')
        );
        const button = document.querySelector('[data-card-action="move"]');
        if (!popup || !button) return false;
        const box = popup.getBoundingClientRect();
        const anchor = button.getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight &&
          Math.abs(anchor.top - box.bottom) <= 12
        );
      });
    for (const [width, height] of [
      [844, 390],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(besideMove, { timeout: 600, intervals: [50] })
        .toBe(true);
    }
  });
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
