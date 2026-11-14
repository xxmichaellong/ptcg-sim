import { expect, test } from '@playwright/test';
import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

const FEED = {
  source: 'Limitless TCG',
  sourceUrl: 'https://play.limitlesstcg.com',
  fetchedAt: '2026-11-06T00:00:00Z',
  groups: {
    'Current Standard': {
      'Dreepy — 1st of 32':
        'Pokémon (4)\n4 Dreepy TWM 128\n\nEnergy (56)\n56 Psychic Energy MEE 13',
    },
  },
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`quick view inspects without saving and saves only a changed copy (${viewport.width}px)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await ownRoomBudget(page.context());
    await routeCardCatalog(page);
    await page.route('**/v2/decks/current', (route) =>
      route.fulfill({ json: FEED })
    );
    await page.goto('/');
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
      timeout: 30_000,
    });
    await openDeck(page);
    const list = page
      .getByRole('list', { name: 'Current Standard' })
      .getByRole('listitem')
      .first();
    await list.locator('[data-view-deck]').click();
    const preview = page.getByRole('dialog', {
      name: 'Dreepy — 1st of 32',
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(preview.locator('.deck-quick-view__summary')).toContainText(
      '60/60'
    );
    await expect(preview.locator('.deck-quick-view__grid li')).toHaveCount(2);
    await preview
      .getByRole('button', { name: 'Dreepy, 4 in deck', exact: true })
      .click();
    const details = page.locator('#nativeDeckBuilderCardPreviewScrim');
    await expect(details).toBeVisible();
    await expect(
      details.getByRole('button', { name: /Add one|Remove one|Make cover/u })
    ).toHaveCount(0);
    await details.locator('.ptcgsim-sheet__close').click();
    await expect(details).toBeHidden();
    await expect(preview).toBeVisible();
    await preview
      .getByRole('button', { name: 'Dreepy, 4 in deck', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(
      page.getByRole('list', { name: 'Your decks', exact: true })
    ).toHaveCount(0);
    // Edit alone neither saves the list nor replaces P1's deck.
    await list.getByRole('button', { name: /^Edit /u }).click();
    await expect(page.locator('#deckNameInput')).toBeVisible();
    await page.locator('#deckEditorBackButton').click();
    await expect(
      page.getByRole('list', { name: 'Your decks', exact: true })
    ).toHaveCount(0);
    // An actual edit saves one copy, and reopening it never duplicates it.
    await list.getByRole('button', { name: /^Edit /u }).click();
    await page.locator('#deckNameInput').fill('My Dreepy');
    await page.locator('#deckNameInput').press('Enter');
    await page.locator('#deckEditorBackButton').click();
    const yours = page.getByRole('list', { name: 'Your decks', exact: true });
    await expect(yours.getByRole('listitem')).toHaveCount(1);
    await yours.locator('[data-view-deck]').click();
    const savedPreview = page.getByRole('dialog', {
      name: 'My Dreepy',
      exact: true,
    });
    await savedPreview
      .getByRole('button', { name: 'Use on P1', exact: true })
      .click();
    await expect(savedPreview).toHaveCount(0);
    await expect(
      page.locator('#nativeDeckBuilderTargetMain .deck-screen__seat-name')
    ).toHaveText('My Dreepy');
    await page.reload();
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
      timeout: 30_000,
    });
    await openDeck(page);
    await expect(
      page
        .getByRole('list', { name: 'Your decks', exact: true })
        .getByRole('listitem')
    ).toHaveCount(1);
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`partial quick views keep missing lines through Edit and Use (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await ownRoomBudget(page.context());
    await routeCardCatalog(page);
    await page.route('https://limitlesstcg.com/api/dm/import', (route) =>
      route.fulfill({ json: { cards: [] } })
    );
    await page.route('**/v2/decks/current', (route) =>
      route.fulfill({
        json: {
          ...FEED,
          groups: {
            'Current Standard': {
              'Partial deck': '4 Dreepy TWM 128\n2 Nothing At All',
            },
          },
        },
      })
    );
    await page.goto('/');
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
      timeout: 30_000,
    });
    await openDeck(page);
    const eye = page
      .getByRole('list', { name: 'Current Standard' })
      .locator('[data-view-deck]')
      .first();
    const preview = page.getByRole('dialog', {
      name: 'Partial deck',
      exact: true,
    });
    await eye.click();
    await expect(preview.locator('.deck-missing')).toContainText(
      '1 line not found'
    );
    await expect(preview.locator('.deck-missing')).toContainText(
      '2 Nothing At All'
    );
    await preview
      .getByRole('button', { name: 'Edit deck', exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.deck-editor .deck-missing')).toContainText(
      'Nothing At All'
    );
    await page.locator('#deckEditorBackButton').click();
    await expect(
      page.getByRole('list', { name: 'Your decks', exact: true })
    ).toHaveCount(0);
    await eye.click();
    await preview
      .getByRole('button', { name: 'Use on P1', exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    await expect(
      page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '4');
    await expect(
      page.locator('.ptcgsim-ui-toast').filter({ hasText: '1 line not found' })
    ).toContainText('4 cards · 1 line not found');
    const yours = page.getByRole('list', { name: 'Your decks', exact: true });
    await expect(yours.getByRole('listitem')).toHaveCount(1);
    await expect(yours.getByRole('listitem')).toHaveAttribute(
      'data-unsaved',
      'true'
    );
    await expect(yours).toContainText('Not saved');
  });
}
