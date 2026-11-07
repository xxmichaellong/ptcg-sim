import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import {
  dismissWelcome,
  openSettings,
  openDeck,
} from './support/table-shell.js';
import { openCardBackChooser } from './support/card-back-chooser.js';
for (const shape of ['coin', 'card'] as const)
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`${shape} designer remains reachable at ${size.width}px`, async ({
      page,
    }) => {
      await ownRoomBudget(page.context());
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
        timeout: 30_000,
      });
      await dismissWelcome(page);
      if (shape === 'coin') {
        await openSettings(page, 'cards');
        await page.locator('#editCoinButton').click();
      } else {
        await openDeck(page);
        await openCardBackChooser(page);
      }
      const dialog = page.getByRole('dialog', {
        name: shape === 'coin' ? 'Coin' : 'Card back',
        exact: true,
      });
      await dialog.locator('#cardBackMode-design').check();
      await expect(dialog).toHaveCSS('opacity', '1');
      await dialog.evaluate((node) => {
        node.scrollTop = 0;
        node.parentElement!.scrollTop = 0;
      });
      const title = dialog.locator('.ptcgsim-ui-dialog__title');
      await expect
        .poll(async () => (await title.boundingBox())?.y)
        .toBeGreaterThanOrEqual(0);
      const cancel = dialog.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeInViewport();
      await cancel.click();
      await expect(dialog).toHaveCount(0);
    });
  }
