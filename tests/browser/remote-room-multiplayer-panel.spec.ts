import { expect, test } from '@playwright/test';

import {
  closeDeck,
  closeSheet,
  openDeck,
  openPlayOnline,
  openSettings,
} from './support/table-shell.js';

/**
 * Play online opens over a live Solo table (ADR-030; v1's Multiplayer tab
 * was a sidebar panel over the same table): reading it never disturbs the
 * game. v2 used to swap routes, which tore the board down and built it
 * again -- visible as a flash on every click. This pins the table in place
 * while the panel is read, and pins the park to the moment the panel is
 * acted on.
 */
test('reading Play online leaves a live Solo table mounted', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('/?room-lobby=1&renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(page.locator('#playOnlineSheet')).toBeVisible();
  await page.locator('#nameInput').fill('Blue');
  // Putting Play online away goes to the Solo table, as v1's Solo tab did.
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();

  // Mark the live board. A remount replaces the element and loses the mark.
  const mark = async (): Promise<void> => {
    await page.locator('.ptcgsim-board-surface').evaluate((surface) => {
      surface.setAttribute('data-mounted-mark', 'table');
    });
  };
  const marked = (): Promise<number> =>
    page.locator('.ptcgsim-board-surface[data-mounted-mark="table"]').count();
  await mark();
  expect(await marked()).toBe(1);

  await openPlayOnline(page);
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#playOnlineSheet #p2Box')).toBeVisible();
  // The table is untouched: same element, same renderer, no flash.
  expect(await marked()).toBe(1);
  await expect(page.locator('#roomIdInput')).toBeEnabled();
  // The lobby's state is kept while the panel is read.
  await expect(page.locator('#nameInput')).toHaveValue('Blue');

  // Back to the table, and still the same one.
  await closeSheet(page);
  await expect(page.locator('#playOnlineSheet')).toHaveCount(0);
  expect(await marked()).toBe(1);

  // Deck and Settings keep it mounted too, as they always have.
  await openDeck(page);
  await expect(page.locator('#deckImport')).toBeVisible();
  await closeDeck(page);
  await openSettings(page);
  expect(await marked()).toBe(1);
  await closeSheet(page);

  // Acting on the panel is the real transition: generating a room parks the
  // Solo table and hands the screen to the lobby, as v1's tab did.
  await openPlayOnline(page);
  await page.locator('#generateIdButton').click();
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(page.locator('#playOnlineSheet #p2Box')).toBeVisible();
  await expect(page.locator('#roomIdInput')).not.toHaveValue('');

  expect(errors).toEqual([]);
});
