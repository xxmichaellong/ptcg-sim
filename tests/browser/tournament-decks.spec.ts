import { expect, test, type Page } from '@playwright/test';

import { openDeck } from './support/table-shell.js';

/**
 * Tournament decks on the deck screen (ADR-037): a deck's name typed in the
 * finder lists that deck's best finishes, and any finish's list goes on the
 * seat; a tournament opens to its standings, and any player's list goes on
 * the seat. The server's index is stubbed here (its Limitless crawl is
 * covered by the Worker's own tests), so this checks what a player sees and
 * does.
 */

const LIST = [
  'Pokémon: 4',
  '4 Dreepy TWM 128',
  '',
  'Energy: 56',
  '56 Psychic Energy MEE 13',
].join('\n');

const TOURNAMENT = {
  id: '6ad8a7d1115c12b73a5a8e4b',
  name: 'ASRcristiano # 197',
  date: '2026-10-21T19:00:00.000Z',
  players: 67,
  format: 'STANDARD',
};
const ARCHETYPE = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: ['dragapult', 'dusknoir'],
};

const stubIndex = async (page: Page): Promise<string[]> => {
  const asked: string[] = [];
  await page.route('**/v2/decks/search**', async (route) => {
    asked.push(new URL(route.request().url()).search);
    await route.fulfill({
      json: {
        available: true,
        updatedAt: '2026-10-22T06:00:00.000Z',
        results: [
          {
            archetype: ARCHETYPE,
            lists: 812,
            top8s: 64,
            best: [
              {
                tournament: TOURNAMENT,
                player: { id: 'redthegoat', name: 'REDTHEGOAT' },
                placing: 1,
                record: { wins: 8, losses: 2, ties: 0 },
              },
            ],
          },
        ],
      },
    });
  });
  await page.route('**/v2/tournaments?**', (route) =>
    route.fulfill({
      json: {
        tournaments: [{ ...TOURNAMENT, organizer: 'League', hasLists: true }],
        nextCursor: null,
      },
    })
  );
  await page.route(`**/v2/tournaments/${TOURNAMENT.id}`, (route) =>
    route.fulfill({
      json: {
        tournament: {
          ...TOURNAMENT,
          organizer: 'League',
          hasLists: true,
          url: `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/standings`,
        },
        standings: [
          {
            player: { id: 'redthegoat', name: 'REDTHEGOAT' },
            placing: 1,
            record: { wins: 8, losses: 2, ties: 0 },
            dropped: false,
            archetype: ARCHETYPE,
            hasList: true,
          },
          {
            player: { id: 'nolist', name: 'No List' },
            placing: 2,
            record: { wins: 7, losses: 3, ties: 0 },
            dropped: false,
            archetype: null,
            hasList: false,
          },
        ],
      },
    })
  );
  await page.route('**/v2/tournaments/*/players/*/list', (route) =>
    route.fulfill({
      json: {
        text: LIST,
        archetype: ARCHETYPE,
        player: { id: 'redthegoat', name: 'REDTHEGOAT' },
        tournament: TOURNAMENT,
        url: `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/player/redthegoat/decklist`,
      },
    })
  );
  return asked;
};

const openDeckScreen = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
};

test("a deck's name finds its tournament finishes, and a finish's list goes on the seat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const asked = await stubIndex(page);
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('dragapult');
  const results = page.getByRole('region', { name: 'Tournament decks' });
  await expect(results.getByText('Dragapult Dusknoir')).toBeVisible();
  // Typing rests before it asks: one request for the whole word.
  expect(asked).toEqual(['?q=dragapult']);
  await expect(
    results.getByRole('link', { name: 'Limitless TCG' })
  ).toHaveAttribute('target', '_blank');
  // A name is one line: Enter doesn't turn it into a list.
  await page.locator('#deckPasteInput').press('Enter');
  await expect(page.locator('#deckPasteInput')).toHaveValue('dragapult');
  await expect(page.locator('#deckPasteImportButton')).toHaveCount(0);

  await results
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st of 67, REDTHEGOAT: try it',
    })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  const tray = page.locator('#nativeDeckBuilderTargetMain');
  await expect(tray).toHaveAccessibleName(/Dragapult Dusknoir — 1st of 67/u);
  await expect(tray.locator('.deck-tray__finish')).toHaveText('1st of 67');
});

test("a tournament opens to its standings, and any player's list goes on the seat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  await openDeckScreen(page);
  // The shelf asks for its events as it comes near the screen.
  await page.locator('#deckTournamentsTitle').scrollIntoViewIfNeeded();
  const events = page.getByRole('list', { name: 'Tournaments' });
  await events.getByRole('button', { name: /ASRcristiano # 197/u }).click();
  const standings = page.getByRole('list', { name: 'Standings' });
  await expect(standings.getByRole('listitem')).toHaveCount(2);
  await expect(standings.getByRole('listitem').nth(1)).toContainText('No list');
  await expect(
    page.getByRole('link', { name: /Limitless/u }).first()
  ).toHaveAttribute(
    'href',
    `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/standings`
  );
  await standings
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st, REDTHEGOAT: try it',
    })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  // Back to the shelves, the finder as it was.
  await page.locator('#deckSubviewBackButton').click();
  await expect(page.locator('#deckPasteInput')).toBeVisible();
});

test('deck search says quietly when it is offline', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/v2/decks/search**', (route) =>
    route.fulfill({ status: 500, body: 'no' })
  );
  await page.route('**/v2/tournaments?**', (route) =>
    route.fulfill({ json: { tournaments: [], nextCursor: null } })
  );
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('gardevoir');
  await expect(
    page
      .getByRole('region', { name: 'Tournament decks' })
      .getByText('Deck search is offline')
  ).toBeVisible();
  // A list pasted into the same field imports as ever.
  await page.locator('#deckPasteInput').fill(LIST);
  await page.locator('#deckPasteImportButton').click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
});
