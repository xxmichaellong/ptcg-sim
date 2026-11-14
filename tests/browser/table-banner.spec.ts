import { expect, test } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';

/**
 * A banner the table keeps until it is resolved (here, a Solo room that
 * couldn't be made) sits centred under the app bar, as wide as its words
 * need up to the window's width less a gutter: on a phone it reads in full
 * lines, not a word a line in half the window.
 */
test('a banner reads in lines as wide as the window lets it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  await page.route('**/v2/rooms', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{}',
        })
      : route.continue()
  );
  for (const [width, height] of [
    [390, 844],
    [320, 740],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const banner = page.locator('.ptcgsim-table-banner');
    await expect(banner).toContainText('Couldn', { timeout: 30_000 });
    const at = `${String(width)}x${String(height)}`;
    const box = (await banner.boundingBox())!;
    expect(box.x, at).toBeGreaterThanOrEqual(15.5);
    expect(box.x + box.width, at).toBeLessThanOrEqual(width - 15.5);
    expect(Math.abs(box.x + box.width / 2 - width / 2), at).toBeLessThan(1);
    // The message's lines, by where each one starts.
    const lines = await banner
      .locator('.ptcgsim-table-banner__text')
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top))
        ).size;
      });
    expect(lines, at).toBeLessThanOrEqual(width < 400 ? 2 : 1);
  }
});
