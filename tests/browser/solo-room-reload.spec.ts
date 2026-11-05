import { expect, test, type Page } from '@playwright/test';

import { idle, logLines, zoneCount } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * The Solo table is a room (ADR-044): a reload sits back down at the same
 * game, with its log, and another tab makes a table of its own rather than
 * sharing it.
 */

const ready = (page: Page) =>
  expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });

const roomCode = (page: Page) =>
  page.evaluate(() => {
    const raw = sessionStorage.getItem('ptcgsim.solo-room.v1');
    return raw ? (JSON.parse(raw) as { roomCode: string }).roomCode : null;
  });

const setUpTable = async (page: Page) => {
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '30,Ember ex,Pokémon,/v2/assets/cardback.png?ember',
        '20,Iono,Trainer,/v2/assets/cardback.png?iono',
        '10,Fire Energy,Energy,/v2/assets/cardback.png?energy',
      ].join('\n')
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(7);
  await idle(page);
};

test('a reload sits back down at the same Solo game; another tab gets its own', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(context);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  await dismissWelcome(page);
  await setUpTable(page);
  const room = await roomCode(page);
  expect(room).toMatch(/^[A-Z0-9]{12}$/u);
  const prizes = await zoneCount(page, 'local', 'prizes');
  expect(prizes).toBe(6);
  const told = await logLines(page);
  expect(told.length).toBeGreaterThan(0);
  // Kept as it changes, a moment later.
  await page.waitForTimeout(600);

  await page.reload();
  await ready(page);
  // The same room, the same hand, the same prizes and deck.
  expect(await roomCode(page)).toBe(room);
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(7);
  expect(await zoneCount(page, 'local', 'prizes')).toBe(6);
  expect(await zoneCount(page, 'local', 'deck')).toBe(47);
  // And its log, as it was.
  await expect.poll(() => logLines(page)).toEqual(told);

  // A second tab, while this one sits at the room, makes a table of its own.
  const other = await context.newPage();
  await other.setViewportSize({ width: 1280, height: 800 });
  await other.goto('/');
  await ready(other);
  const otherRoom = await roomCode(other);
  expect(otherRoom).not.toBe(room);
  expect(otherRoom).toMatch(/^[A-Z0-9]{12}$/u);
  await expect.poll(() => zoneCount(other, 'local', 'hand')).toBe(0);
  // The first tab's game is untouched.
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(7);
  await other.close();

  // And its own reload still finds its own game.
  await page.reload();
  await ready(page);
  expect(await roomCode(page)).toBe(room);
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(7);
});
