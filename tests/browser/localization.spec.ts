import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { closeSheet, openSettings } from './support/table-shell.js';

/**
 * The page's language (ADR-034): the browser's until one is chosen in
 * Settings, applied live to what is already on screen, and kept after a
 * reload. Expected words come from the committed catalogs, so a better
 * translation never breaks this spec.
 */

type Catalog = Record<
  string,
  { message?: string; context?: string; translation: string }
>;

const catalog = (locale: string): Catalog =>
  JSON.parse(
    readFileSync(
      new URL(`../../apps/web/src/locales/${locale}.json`, import.meta.url),
      'utf8'
    )
  ) as Catalog;

/** A message's translation, by its English and context. */
const word = (locale: string, message: string, context?: string): string => {
  const entry = Object.values(catalog(locale)).find(
    (candidate) =>
      candidate.message === message && candidate.context === context
  );
  if (!entry?.translation) throw new Error(`${locale} lacks "${message}"`);
  return entry.translation;
};

const openTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 60_000 });
};

const settingsTitle = (page: Page) =>
  page.locator('#settings').getByRole('heading').first();

const deckZoneName = (page: Page) =>
  page
    .locator('.ptcgsim-zone[data-zone-kind="deck"][data-zone-side="local"]')
    .getAttribute('aria-label');

test('the table speaks the language chosen in Settings, at once and after a reload', async ({
  page,
}) => {
  // Two tables open (before and after the reload), each up to a minute.
  test.setTimeout(150_000);
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const englishDeck = await deckZoneName(page);

  await openSettings(page);
  await expect(settingsTitle(page)).toHaveText('Settings');
  await page.locator('#languageSelect').selectOption('de');

  // What is already on screen changes: the sheet, and the table's names.
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(settingsTitle(page)).toHaveText(word('de', 'Settings'));
  await expect.poll(() => deckZoneName(page)).not.toBe(englishDeck);
  await closeSheet(page);

  // ...and stays after a reload, from the first paint.
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await openSettings(page);
  await expect(settingsTitle(page)).toHaveText(word('de', 'Settings'));

  // Back to the browser's language (English here).
  await page.locator('#languageSelect').selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(settingsTitle(page)).toHaveText('Settings');
  await expect.poll(() => deckZoneName(page)).toBe(englishDeck);
});

test.describe('a browser set to Japanese', () => {
  test.use({ locale: 'ja-JP' });

  test('opens the table in Japanese', async ({ page }) => {
    await openTable(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await openSettings(page);
    await expect(settingsTitle(page)).toHaveText(word('ja', 'Settings'));
    await expect(page.locator('#languageSelect')).toHaveValue('auto');
  });
});
