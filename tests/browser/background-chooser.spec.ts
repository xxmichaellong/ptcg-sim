import { expect, test, type Page } from '@playwright/test';

import { closeSheet, openSettings } from './support/table-shell.js';

/**
 * The background chooser (Settings, Table; ADR-013): tiles for the desk,
 * nothing and the wallpapers, and a picture of the player's own -- picked
 * or dropped, re-encoded and kept on this device -- which is still there
 * after a reload. Nothing is typed.
 */

/** A 64×48 PNG drawn in the page, as a camera roll's picture would be. */
const pictureBytes = async (page: Page): Promise<Buffer> =>
  Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'rgb(200 40 90)';
      context.fillRect(0, 0, 64, 48);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      return [...new Uint8Array(await blob!.arrayBuffer())];
    })
  );

const openTable = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
};

test('a wallpaper, nothing, then a picture of the player’s own, kept across a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  const room = page.locator('[data-app-route="remote-room"]');
  await expect(room).toHaveAttribute('data-room-background', 'default');
  await openSettings(page);
  const desk = page.locator('#background-desk');
  await expect(desk).toBeChecked();
  // No Custom tile until there is a picture.
  await expect(page.locator('#background-custom')).toHaveCount(0);

  // A tile is its radio, laid over the whole preview.
  await page.locator('#background-wallpaper1').click();
  await expect(room).toHaveAttribute('data-room-background', 'image');
  await expect(room).toHaveCSS(
    'background-image',
    /\/v2\/assets\/background1\.jpg/u
  );
  await page.locator('#background-none').click();
  await expect(room).toHaveAttribute('data-room-background', 'blank');

  await page.locator('#backgroundFileInput').setInputFiles({
    name: 'table.png',
    mimeType: 'image/png',
    buffer: await pictureBytes(page),
  });
  await expect(page.locator('#background-custom')).toBeChecked();
  await expect(room).toHaveAttribute('data-room-background', 'image');
  await expect(room).toHaveCSS('background-image', /^url\("blob:/u);
  await closeSheet(page);

  // Remembered on this device: the picture comes back from IndexedDB.
  await page.reload();
  await openTable(page);
  await expect(room).toHaveCSS('background-image', /^url\("blob:/u);
  await openSettings(page);
  await expect(page.locator('#background-custom')).toBeChecked();
  await page.locator('#background-desk').click();
  await expect(room).toHaveAttribute('data-room-background', 'default');
  // The picture stays to go back to.
  await expect(page.locator('#background-custom')).toHaveCount(1);
});

test('a picture dropped on the chooser is taken', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  await openSettings(page);
  const bytes = [...(await pictureBytes(page))];
  const transfer = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' })
    );
    return transfer;
  }, bytes);
  const chooser = page.locator('.background-chooser');
  await chooser.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(chooser).toHaveAttribute('data-dragging', 'true');
  await chooser.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('#background-custom')).toBeChecked();
  await expect(chooser).not.toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('[data-app-route="remote-room"]')).toHaveCSS(
    'background-image',
    /^url\("blob:/u
  );
});
