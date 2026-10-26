import { expect, test, type Page } from '@playwright/test';

import { answerOverlayPrompt } from './support/overlay-dialogs.js';
import { ownRoomBudget } from './support/room-budget.js';
import {
  closeActivity,
  dismissWelcome,
  openActivity,
  openDeck,
} from './support/table-shell.js';

const RED = 'https://images.example.test/red-sleeves.png';
const STANDARD = '/v2/assets/cardback.png';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const openTable = async (page: Page) => {
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
};

/** A one-card deck ("… deck", for its card), saved and put on P1. */
const importDeck = async (page: Page, name: string) => {
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: `${name}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['QTY,Name,Type,URL', `1,${name},Pokémon,${STANDARD}?${name}`].join('\n')
    ),
  });
  await expect(
    page.locator('.deck-tray[data-seat="self"] .deck-screen__seat-name')
  ).toHaveText(`${name} deck`);
};

/**
 * A card back belongs to its deck (ADR-033): chosen on a seat holding a
 * saved deck, it is kept with that deck, through a reload, and goes on the
 * table with it; a deck without one is played in the seat's own.
 */
test('a deck keeps its card back and brings it to the table', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  await page.route(RED, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    })
  );
  const sleeve = page.locator(
    '.deck-tray[data-seat="self"] .deck-tray__sleeve img'
  );

  await page.goto('/?renderer=dom');
  await openTable(page);
  await openDeck(page);
  await importDeck(page, 'Charizard');
  const prompt = answerOverlayPrompt(page, RED);
  await page.locator('#changeCardBackButton').click();
  expect((await prompt).message).toBe('Change card back');
  await expect(sleeve).toHaveAttribute('src', RED);

  // Another deck, with no back of its own: the standard one.
  await importDeck(page, 'Lugia');
  await expect(sleeve).toHaveAttribute('src', STANDARD);
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await openActivity(page);
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(1);
  await closeActivity(page);
  await expect(page.locator(`img[src="${RED}"]`)).toHaveCount(0);

  // Saved with the deck: after a reload, putting it on brings its back.
  await page.reload();
  await openTable(page);
  await openDeck(page);
  await page.locator('button[aria-label="Charizard deck: put on P1"]').click();
  await expect(sleeve).toHaveAttribute('src', RED);
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator(`img[src="${RED}"]`).first()).toBeVisible();
});
