import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { joinByCode, roomCodeOf } from './support/room-code.js';
import {
  closeSheet,
  dismissWelcome,
  openPlayOnline,
  openSettings,
} from './support/table-shell.js';

test('a coin uses the sleeve designer, survives reload, and shows to the other player', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(page.context());
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  await openSettings(page, 'cards');
  await page.locator('#editCoinButton').click();
  const editor = page.getByRole('dialog', { name: 'Coin', exact: true });
  await expect(editor).toBeVisible();
  await editor.locator('#cardBackMode-design').check();
  await editor
    .getByRole('radio', { name: 'Gold', exact: true })
    .first()
    .check();
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await closeSheet(page);
  const heads = page.locator(
    '[data-table-coin="local"] .table-coin__face--heads img'
  );
  await expect(heads).toHaveAttribute('src', /^data:image\/svg/u);
  await expect
    .poll(async () =>
      decodeURIComponent((await heads.getAttribute('src')) ?? '')
    )
    .toContain('<image');
  const selected = await heads.getAttribute('src');
  await page.reload();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(heads).toHaveAttribute('src', selected!);
  await dismissWelcome(page);
  await openPlayOnline(page);
  await page.locator('#nameInput').fill('Blue');
  await page.locator('#generateIdButton').click();
  const code = await roomCodeOf(page);
  const guest = await browser.newContext();
  try {
    await ownRoomBudget(guest);
    const other = await guest.newPage();
    await other.goto(`/?room=${code}`);
    await expect(other.locator('#playOnlineSheet')).toBeVisible({
      timeout: 30_000,
    });
    await joinByCode(other, code, { name: 'Red' });
    await expect(
      other.locator('[data-table-coin="opponent"] .table-coin__face--heads img')
    ).toHaveAttribute('src', selected!);
    await expect(
      other.locator('[data-table-coin="local"] .table-coin__face--heads img')
    ).toHaveAttribute('src', '/v2/assets/table/coin-heads.webp');
  } finally {
    await guest.close();
  }
});

test('the coin menu accepts and crops an uploaded image, then restores Standard', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  await page.locator('#flipCoinButton').click({ button: 'right' });
  await page.locator('[data-edit-coin]').click();
  const editor = page.getByRole('dialog', { name: 'Coin', exact: true });
  await editor.locator('#cardBackMode-picture').check();
  await editor.locator('#cardBackFileInput').setInputFiles({
    name: 'coin.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#3060a0"/><circle cx="900" cy="300" r="240" fill="#e0be60"/></svg>'
    ),
  });
  const crop = editor.locator('.card-back-crop');
  await expect(crop.locator('img')).toBeVisible();
  await crop.focus();
  await page.keyboard.press('ArrowRight');
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const heads = page.locator(
    '[data-table-coin="local"] .table-coin__face--heads img'
  );
  await expect(heads).toHaveAttribute('src', /^\/v2\/images\/[0-9a-f]{64}$/u);
  await expect
    .poll(() =>
      heads.evaluate((img) => [
        (img as HTMLImageElement).naturalWidth,
        (img as HTMLImageElement).naturalHeight,
      ])
    )
    .toEqual([600, 600]);
  await page.locator('#flipCoinButton').click({ button: 'right' });
  await page.locator('[data-edit-coin]').click();
  await editor.locator('#standardCardBackChoice').check();
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(heads).toHaveAttribute(
    'src',
    '/v2/assets/table/coin-heads.webp'
  );
});
