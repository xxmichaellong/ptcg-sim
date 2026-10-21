import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  closeSheet,
  openActivity,
  openDeck,
  openSettings,
} from './support/table-shell.js';

/**
 * Arabic is written right to left (ADR-034): the page's chrome mirrors --
 * a sheet's or the log's heading starts at the right, its close button at
 * the left, a menu's icons at the right -- while the table keeps the world's
 * way round: the rail, the log docked beside the table and the side sheets
 * stay where they are. Back in English, everything is as it was.
 */

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Main Mon,Pokémon,/v2/assets/cardback.png?main-mon',
    '30,Main Energy,Energy,/v2/assets/cardback.png?main-energy',
  ].join('\n')
);

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Not on screen');
  return found;
};

const centreX = async (locator: Locator) => {
  const { x, width } = await box(locator);
  return x + width / 2;
};

const settings = (page: Page) => page.locator('#settings');
const settingsTitle = (page: Page) =>
  settings(page).locator('.ptcgsim-sheet__title');
const settingsClose = (page: Page) =>
  settings(page).locator('.ptcgsim-sheet__close');

const openTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 60_000 });
};

/** The table, read off the screen: these never move with the language. */
const tableSides = async (page: Page) => ({
  menu: await centreX(page.locator('#appMenuButton')),
  log: await centreX(page.locator('#activityButton')),
});

test('Arabic mirrors the chrome around the table, and English puts it back', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const english = await tableSides(page);
  expect(english.menu).toBeLessThan(english.log);

  await openSettings(page);
  // English: the heading at the left, the way out at the right.
  expect(await centreX(settingsTitle(page))).toBeLessThan(
    await centreX(settingsClose(page))
  );
  await page.locator('#languageSelect').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  // The sheet's heading mirrors; the sheet keeps to the right.
  await expect
    .poll(
      async () =>
        (await centreX(settingsTitle(page))) >
        (await centreX(settingsClose(page)))
    )
    .toBe(true);
  const sheet = await box(settings(page));
  expect(sheet.x + sheet.width).toBeGreaterThan(1440 - 40);
  // A switch is on towards the end of the line: the left, now.
  const firstSwitch = settings(page).locator('.ds-switch').first();
  expect(
    await firstSwitch.evaluate((element) => getComputedStyle(element).direction)
  ).toBe('rtl');
  await closeSheet(page);

  // The table does not mirror: it stays left to right, the rail the same
  // way round.
  const table = page.locator('.board-spike-host');
  await expect(table).toHaveAttribute('dir', 'ltr');
  expect(
    await page
      .locator('.ptcgsim-board-surface')
      .evaluate((element) => getComputedStyle(element).direction)
  ).toBe('ltr');
  expect(await tableSides(page)).toEqual(english);

  // The log docks at the right as before, its heading mirrored.
  await openActivity(page);
  const log = page.locator('#activitySheet');
  const logBox = await box(log);
  expect(logBox.x + logBox.width).toBeGreaterThan(1440 - 2);
  expect(
    await log.evaluate((element) => getComputedStyle(element).direction)
  ).toBe('rtl');

  // A card's menu, raised from the table, reads right to left: each row's
  // icon at its right.
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv,
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await chooseMoreAction(page, 'setupBothButton');
  const handCard = page
    .locator('[data-in-hand][data-card-side="local"]')
    .filter({ has: page.locator('img') })
    .first();
  await expect(handCard).toBeVisible();
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
  await handCard.click({ button: 'right' });
  const menu = page.locator('[data-legacy-card-context-menu]');
  await expect(menu).toHaveAttribute('dir', 'rtl');
  const row = menu.locator('.ptcgsim-menu-item').first();
  expect(await centreX(row.locator('.ptcgsim-menu-icon'))).toBeGreaterThan(
    await centreX(row.locator('.ptcgsim-menu-label'))
  );
  await page.keyboard.press('Escape');

  // Back to English: everything left to right again.
  await openSettings(page);
  await page.locator('#languageSelect').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect
    .poll(
      async () =>
        (await centreX(settingsTitle(page))) <
        (await centreX(settingsClose(page)))
    )
    .toBe(true);
});
