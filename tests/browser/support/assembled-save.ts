import { expect, type Page } from '@playwright/test';
import { chooseTableView, closeBoardView } from './board-view.js';
import { openDeck } from './table-shell.js';

/** Install and assemble a custom print through production UI only. */
export const assembleSavedPrint = async (page: Page) => {
  const quote = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = Array.from({ length: 4 }, (_, part) =>
    [
      1,
      `Saved piece ${part + 1}`,
      'Pokémon',
      '/v2/assets/cardback.png',
      JSON.stringify({
        readingQuarterTurns: 0,
        finish: 'rainbow',
        foilRegion: 'full',
        join: { key: 'saved-artwork', columns: 2, rows: 2, part },
      }),
    ]
      .map(quote)
      .join(',')
  );
  await chooseTableView(page, 'table');
  await closeBoardView(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'assembled-save.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['QTY,Name,Type,URL,Presentation', ...rows].join('\n')),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '4'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  for (let part = 1; part <= 4; part++) {
    const pile = page.locator('[data-legacy-zone-browser]');
    if (!(await pile.isVisible()))
      await page
        .locator('.ptcgsim-card[data-card-primary-action="openZone"]')
        .first()
        .dblclick();
    await pile
      .getByRole('button', { name: `Saved piece ${part}`, exact: true })
      .click();
    if (part === 1) await page.keyboard.press('b');
    else {
      await pile.getByRole('button', { name: 'Actions', exact: true }).click();
      await page
        .getByRole('menuitem', { name: 'Assemble / attach to a card…' })
        .click();
      await page
        .locator('.ptcgsim-card[data-card-role="stackEvolution"]')
        .first()
        .click();
    }
    await expect(
      page.locator('.ptcgsim-card[data-card-role="stackEvolution"]')
    ).toHaveCount(part);
  }
  await page.keyboard.press('Escape');
  await expectSavedPrint(page);
};

export const expectSavedPrint = async (page: Page) => {
  await expect(
    page.locator('.ptcgsim-card[data-card-composition="joined"]')
  ).toHaveCount(4);
  await expect(
    page.locator(
      '.ptcgsim-card[data-card-composition="joined"] [data-finish="rainbow"][data-foil-region="full"]'
    )
  ).toHaveCount(4);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-motion',
    'idle'
  );
};
