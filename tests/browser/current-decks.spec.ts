import { expect, test, type Page } from '@playwright/test';

import { openDeck } from './support/table-shell.js';

/**
 * The deck picker's current tournament lists. The server's feed is stubbed
 * here (its Limitless refresh is covered by the Worker runtime tests), so
 * this checks what a player sees: the current group first, each deck with
 * its finish, a credit to Limitless, and the built-in seasons when the feed
 * is unavailable.
 */

const FEED = {
  source: 'Limitless TCG',
  sourceUrl: 'https://play.limitlesstcg.com',
  fetchedAt: '2026-10-14T06:17:00.000Z',
  groups: {
    'Current Standard': {
      'Dragapult — 1st of 285': [
        'Pokémon (4)',
        '4 Dreepy TWM 128',
        '',
        'Energy (56)',
        '56 Psychic Energy MEE 13',
      ].join('\n'),
      'Gardevoir — 2nd of 236': [
        'Pokémon (4)',
        '4 Ralts SVI 84',
        '',
        'Energy (56)',
        '56 Psychic Energy MEE 13',
      ].join('\n'),
    },
  },
};

const openDeckScreen = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
};

test('the deck screen leads with current tournament lists and credits Limitless', async ({
  page,
}) => {
  test.setTimeout(60_000);
  let feedRequests = 0;
  await page.route('**/v2/decks/current', async (route) => {
    feedRequests += 1;
    await route.fulfill({ json: FEED });
  });
  await openDeckScreen(page);
  const meta = page.getByRole('list', { name: 'Current Standard' });
  await expect(meta.getByRole('listitem')).toHaveCount(2);
  expect(feedRequests).toBe(1);
  const first = meta.getByRole('listitem').first();
  await expect(first.locator('.deck-tile__name')).toHaveText('Dragapult');
  await expect(first.locator('.deck-tile__meta')).toHaveText('1st of 285');
  const credit = page.locator('.deck-section-note a');
  await expect(credit).toHaveText('Limitless');
  await expect(credit).toHaveAttribute('target', '_blank');

  // Choosing a list puts it on the seat at once, without saving it.
  await first
    .getByRole('button', { name: /Dragapult — 1st of 285: try it/u })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await expect(page.locator('#nativeDeckBuilderTargetMain')).toContainText(
    'Dragapult — 1st of 285'
  );
  await expect(first.getByRole('button', { name: /try it/u })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('the deck screen keeps its classic decks when current lists are unavailable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route('**/v2/decks/current', (route) =>
    route.fulfill({ json: { available: false } })
  );
  await openDeckScreen(page);
  await expect(page.getByText('No tournament decks right now.')).toBeVisible();
  const seasons = page.locator('#deckClassicSeason option');
  await expect(seasons).toHaveCount(22);
  await expect(seasons.first()).toHaveText('2023-2024 S&V');
  await expect(page.locator('.deck-section-note')).toHaveCount(0);
});
