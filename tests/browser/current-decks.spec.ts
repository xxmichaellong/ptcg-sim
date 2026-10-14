import { expect, test, type Page } from '@playwright/test';

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

const openDeckPicker = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#deckImportButton').click();
  await page.locator('#decklistsButton').click();
  await expect(page.locator('#decklistsContextMenu')).toBeVisible();
};

test('the deck picker leads with current tournament lists and credits Limitless', async ({
  page,
}) => {
  test.setTimeout(60_000);
  let feedRequests = 0;
  await page.route('**/v2/decks/current', async (route) => {
    feedRequests += 1;
    await route.fulfill({ json: FEED });
  });
  await openDeckPicker(page);
  expect(feedRequests).toBe(1);

  const groups = page.locator('.decklists-group');
  await expect(groups.first()).toHaveText('Current Standard');
  await expect(groups.first()).toHaveAttribute('data-current', 'true');
  // The built-in seasons follow.
  await expect(groups.nth(1)).toHaveText('2023-2024 S&V');

  const decks = page.locator('.decklists-context-menu-item');
  await expect(decks).toHaveCount(2);
  await expect(decks.first().locator('.decklists-deck-name')).toHaveText(
    'Dragapult'
  );
  await expect(decks.first().locator('.decklists-deck-finish')).toHaveText(
    '1st of 285'
  );
  const credit = page.locator('.decklists-source a');
  await expect(credit).toHaveText('Limitless');
  await expect(credit).toHaveAttribute('target', '_blank');

  await decks.first().click();
  await expect(page.locator('#decklistsContextMenu')).toBeHidden();
  await expect(page.locator('#mainDeckImportInput')).toHaveValue(
    FEED.groups['Current Standard']['Dragapult — 1st of 285']
  );
});

test('the deck picker keeps its built-in seasons when current lists are unavailable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route('**/v2/decks/current', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } })
  );
  await openDeckPicker(page);
  const groups = page.locator('.decklists-group');
  await expect(groups.first()).toHaveText('2023-2024 S&V');
  await expect(groups).toHaveCount(22);
  await expect(page.locator('.decklists-source')).toHaveCount(0);
});
