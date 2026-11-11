import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  chooseMoreAction,
  closeSheet,
  dismissWelcome,
  openAppMenu,
  openDeck,
} from './support/table-shell.js';

/**
 * ADR-053: a signed-in player's Solo game is kept in their account when it
 * is reset. Saves & replays lists it under Your games, where it is
 * watched on the table, starred, and shared by a link that opens it, as a
 * spectator sees it, in another browser.
 */

const FACE = '/v2/assets/cardback.png';

const openTable = async (page: Page): Promise<void> => {
  await ownRoomBudget(page.context());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
};

const signIn = async (page: Page, name: string): Promise<void> => {
  await openAppMenu(page);
  await page.locator('#settings #signInRow').click();
  const popupOpened = page.waitForEvent('popup');
  await page.locator('#settings #signInWith-test').click();
  const popup = await popupOpened;
  await popup.locator('#testSignInName').fill(name);
  const closed = popup.waitForEvent('close');
  await popup.locator('#testSignInContinue').click();
  await closed;
  await expect(page.locator('#settings #accountRow')).toBeVisible();
};

const someone = (name: string): string =>
  `${name} ${Math.random().toString(36).slice(2, 7)}`;

/** Loads a deck, sets up, flips the coin a few times, then resets. */
const playAGame = async (page: Page): Promise<void> => {
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'replay.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `QTY,Name,Type,URL\n30,Greninja,Pokémon,${FACE}?p\n20,Head Ringer,Trainer,${FACE}?t\n10,Water Energy,Energy,${FACE}?e`
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect(page.locator('#moreActionsButton')).toBeVisible();
  for (let flip = 0; flip < 4; flip += 1) {
    await page.locator('#flipCoinButton').click();
  }
  await chooseMoreAction(page, 'resetButton');
  await expect(page.locator('#setupButton')).toBeVisible();
};

const openYourGames = async (page: Page): Promise<void> => {
  await openAppMenu(page);
  await page.locator('#settings #settingsSavesRow').click();
  await page.locator('#settings #accountReplaysRow').click();
  await expect(page.locator('#settings #settingsAccountReplays')).toBeVisible();
};

test('keeps a signed-in Solo game, watches, stars and shares it', async ({
  page,
  browser,
}) => {
  await openTable(page);
  await signIn(page, someone('Iris'));
  await closeSheet(page);
  await playAGame(page);

  await openYourGames(page);
  const games = page.locator('#settings #settingsAccountReplays');
  const game = games.locator('.account-replay');
  await expect(game).toHaveCount(1, { timeout: 15_000 });
  await expect(game).toContainText('Solo game');
  await expect(game).toContainText(/\d+ moves/u);

  // Starred, it can't be deleted until unstarred.
  await game.locator('[data-action="star"]').click();
  await expect(game.locator('[data-action="star"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(game.locator('[data-action="delete"]')).toHaveCount(0);

  // Its share link, copied.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await game.locator('[data-action="share"]').click();
  await expect(
    page.locator('[data-ptcgsim-overlay="toast"]').filter({
      hasText: 'Link copied',
    })
  ).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(
    /#replay=a_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/u
  );

  // Watched on the table, from the player's own seat.
  await game.locator('.account-replay__watch').click();
  await expect(page.locator('#exitReplay')).toBeVisible({ timeout: 15_000 });
  await page.locator('#setupBothButton').click();
  await page.locator('#exitReplay').click();
  await expect(page.locator('#setupButton')).toBeVisible();

  // Someone else, signed out, opens the link: the game, as a spectator.
  const other = await browser.newContext({ baseURL: page.url() });
  try {
    const watcher = await other.newPage();
    await ownRoomBudget(other);
    await watcher.setViewportSize({ width: 1440, height: 900 });
    await watcher.goto(link);
    await expect(watcher.locator('#exitReplay')).toBeVisible({
      timeout: 30_000,
    });
    // The link left the address once taken.
    expect(new URL(watcher.url()).hash).toBe('');
  } finally {
    await other.close();
  }

  // Unstarred, it can be deleted.
  await openYourGames(page);
  await game.locator('[data-action="star"]').click();
  await game.locator('[data-action="delete"]').click();
  await expect(game).toHaveCount(0);
  await expect(games).toContainText('Games you play signed in show up here.');
});
