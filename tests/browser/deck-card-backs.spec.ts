import { expect, test, type Page } from '@playwright/test';

import {
  routeCardBackImport,
  STORED_CARD_BACK,
} from './support/card-back-import.js';
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
/** The standard back as it is drawn (ADR-041). */
const STANDARD_BACK = /^\/v2\/assets\/backs\/standard\.[0-9a-f]{10}\.webp$/u;

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
 * table with it; a deck without one is played in the seat's own. A pasted
 * address is made a back of our own (ADR-041): the page never loads it.
 */
test('a deck keeps its card back and brings it to the table', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  const imported = await routeCardBackImport(page);
  const outside: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://images.example.test/'))
      outside.push(request.url());
  });
  const sleeve = page.locator(
    '.deck-tray[data-seat="self"] .deck-tray__sleeve img'
  );

  await page.goto('/');
  await openTable(page);
  await openDeck(page);
  await importDeck(page, 'Charizard');
  const prompt = answerOverlayPrompt(page, RED);
  await page.locator('#changeCardBackButton').click();
  expect((await prompt).message).toBe('Change card back');
  await expect(sleeve).toHaveAttribute('src', STORED_CARD_BACK);
  expect(imported).toEqual([RED]);
  const stored = (await sleeve.getAttribute('src'))!;

  // Another deck, with no back of its own: the standard one.
  await importDeck(page, 'Lugia');
  await expect(sleeve).toHaveAttribute('src', STANDARD_BACK);
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await openActivity(page);
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(1);
  await closeActivity(page);
  await expect(page.locator(`img[src="${stored}"]`)).toHaveCount(0);

  // Saved with the deck: after a reload, putting it on brings its back.
  await page.reload();
  await openTable(page);
  await openDeck(page);
  await page.locator('button[aria-label="Charizard deck: put on P1"]').click();
  await expect(sleeve).toHaveAttribute('src', stored);
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator(`img[src="${stored}"]`).first()).toBeVisible();
  // The outside address was never loaded by the page.
  expect(outside).toEqual([]);
});
