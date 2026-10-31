import { expect, test, type Locator, type Page } from '@playwright/test';

import { openCardBackChooser } from './support/card-back-chooser.js';
import {
  routeCardBackImport,
  STORED_CARD_BACK,
} from './support/card-back-import.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/** Twice as wide as tall, left red and right blue: one to place in a card. */
const WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAFUlEQVR4nGP4b6MBR3I2/+GIgXoSAI98K8FHMsIBAAAAAElFTkSuQmCC',
  'base64'
);
const LINK = 'https://images.example.test/linked-sleeves.png';
const STANDARD_BACK = /^\/v2\/assets\/backs\/standard\.[0-9a-f]{10}\.webp$/u;
const CRIMSON_BACK = /^\/v2\/assets\/backs\/crimson\.[0-9a-f]{10}\.webp$/u;

const sleeve = (page: Page): Locator =>
  page.locator('.deck-tray[data-seat="self"] .deck-tray__sleeve img');

const openDeckScreen = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
};

/** Tabs until `target` has the focus. */
const tabTo = async (page: Page, target: Locator): Promise<void> => {
  for (let count = 0; count < 40; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
};

/**
 * The card-back chooser (ADR-041 stage 2): a grid of backs with the
 * standard one first, a sleeve designer, and a picture of the player's own
 * from a file or a link -- never a typed word. Whatever is chosen is a
 * reference; a linked picture is fetched through the app, never the page.
 */
test('chooses a back by keyboard, designs one, and goes back to the standard back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  await openDeckScreen(page);
  await expect(sleeve(page)).toHaveAttribute('src', STANDARD_BACK);

  // Opened from the keyboard, the chooser starts on the standard back.
  await page.locator('#changeCardBackButton').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Card back', exact: true });
  await expect(dialog.locator('#cardBackMode-backs')).toBeFocused();
  const standard = dialog.locator('#standardCardBackChoice');
  await expect(standard).toBeChecked();
  await expect(standard.locator('xpath=..')).toContainText('Standard back');
  // Arrow keys move through the grid; the large preview follows.
  await tabTo(page, standard);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('input[value="preset:crimson"]')).toBeChecked();
  await expect(dialog.locator('.card-back-chooser__card')).toHaveAttribute(
    'src',
    CRIMSON_BACK
  );
  // Enter on a back uses it.
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(sleeve(page)).toHaveAttribute('src', CRIMSON_BACK);

  // A sleeve designed from the lists, drawn as the table draws it.
  await openCardBackChooser(page);
  await dialog.locator('#cardBackMode-design').check();
  await dialog
    .locator('.card-back-design__group')
    .filter({ hasText: 'Colour' })
    .getByRole('radio', { name: 'Crimson' })
    .check();
  await dialog.getByRole('radio', { name: 'Dots' }).check();
  await dialog.getByRole('radio', { name: 'Star' }).check();
  const designed = (await dialog
    .locator('.card-back-chooser__card')
    .getAttribute('src'))!;
  expect(designed).toMatch(/^data:image\/svg\+xml,/u);
  await dialog.locator('#useCardBackButton').click();
  await expect(dialog).toHaveCount(0);
  await expect(sleeve(page)).toHaveAttribute('src', designed);

  // The design is kept to hand under Yours; the standard back is one tap.
  await openCardBackChooser(page);
  await dialog.locator('#cardBackMode-backs').check();
  await expect(
    dialog.locator('.card-back-grid input[value^="design:1.crimson.dots."]')
  ).toHaveCount(1);
  await dialog.locator('#standardCardBackChoice').check();
  await dialog.locator('#useCardBackButton').click();
  await expect(dialog).toHaveCount(0);
  await expect(sleeve(page)).toHaveAttribute('src', STANDARD_BACK);
});

test('makes a back of an uploaded picture placed in the card, and of a link fetched through the app', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  const imported = await routeCardBackImport(page, WIDE_PNG);
  const outside: string[] = [];
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://images.example.test/'))
      outside.push(request.url());
    if (request.method() === 'POST' && request.url().endsWith('/v2/images'))
      uploads.push(request.headers()['content-type'] ?? '');
  });
  await openDeckScreen(page);

  // Not a picture: said plainly, nothing to use.
  const dialog = await openCardBackChooser(page);
  await dialog.locator('#cardBackMode-picture').check();
  const use = dialog.locator('#useCardBackButton');
  await expect(use).toBeDisabled();
  await dialog.locator('#cardBackFileInput').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a picture'),
  });
  await expect(dialog.getByRole('alert')).toHaveText(
    "That file isn't a picture."
  );
  await expect(use).toBeDisabled();

  // A wide picture is shown in a card's shape and moved within it.
  await dialog.locator('#cardBackFileInput').setInputFiles({
    name: 'wide.png',
    mimeType: 'image/png',
    buffer: WIDE_PNG,
  });
  const crop = dialog.locator('.card-back-crop');
  await expect(crop).toHaveAttribute('data-movable', '');
  await expect(crop.locator('img')).toHaveCSS('object-position', '50% 50%');
  await crop.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(crop.locator('img')).toHaveCSS('object-position', '45% 50%');
  const box = (await crop.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 1.5, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  // Dragged right far enough, the picture's left edge meets the card's.
  await expect(crop.locator('img')).toHaveCSS('object-position', '0% 50%');
  await use.click();
  await expect(dialog).toHaveCount(0);
  await expect(sleeve(page)).toHaveAttribute('src', STORED_CARD_BACK);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/^image\/(webp|jpeg)$/u);
  const uploaded = (await sleeve(page).getAttribute('src'))!;

  // A link: fetched through the app, shown, then used.
  await openCardBackChooser(page);
  await dialog.locator('#cardBackMode-picture').check();
  await dialog.locator('#cardBackLinkInput').fill(LINK);
  await dialog.getByRole('button', { name: 'Get', exact: true }).click();
  await expect(crop.locator('img')).toBeVisible();
  expect(imported).toEqual([LINK]);
  await use.click();
  await expect(dialog).toHaveCount(0);
  await expect(sleeve(page)).toHaveAttribute('src', STORED_CARD_BACK);
  expect(uploads).toHaveLength(2);

  // Both are kept to hand under Yours.
  await openCardBackChooser(page);
  await expect(
    dialog.locator(`.card-back-grid img[src="${uploaded}"]`)
  ).toHaveCount(1);
  await expect(
    dialog.locator('.card-back-grid input[value^="img:"]')
  ).toHaveCount(2);
  await dialog.locator('[data-dialog-action="cancel"]').click();
  await expect(dialog).toHaveCount(0);
  // The page itself never asked the link's host.
  expect(outside).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('every choice is a 44px target, the chooser fits, and a tap picks a back', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ownRoomBudget(page.context());
    await openDeckScreen(page);
    const dialog = await openCardBackChooser(page);
    const panel = (await dialog.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);

    const atLeast44 = async (targets: Locator): Promise<void> => {
      const count = await targets.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const box = (await targets.nth(index).boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      }
    };
    await atLeast44(dialog.locator('.card-back-tile'));
    await dialog.locator('#cardBackMode-design').tap();
    await atLeast44(dialog.locator('.card-back-design__choice'));
    await dialog.locator('#cardBackMode-backs').tap();

    await dialog
      .locator('.card-back-tile')
      .filter({ has: page.locator('input[value="preset:crimson"]') })
      .tap();
    await expect(dialog.locator('input[value="preset:crimson"]')).toBeChecked();
    await dialog.locator('#useCardBackButton').tap();
    await expect(dialog).toHaveCount(0);
    await expect(sleeve(page)).toHaveAttribute('src', CRIMSON_BACK);
  });
});
