import { expect, test, type Page } from '@playwright/test';

import { chooseMoreAction, openDeck } from './support/table-shell.js';

/**
 * The command palette (ADR-035): ` or Ctrl+K opens it over a Solo table;
 * a search finds an action, a number typed after it is its count, a card
 * is found by name and then told what to do, a setting is changed from its
 * choices, a dangerous command asks twice, and Escape steps back.
 */

const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/table/coin-heads.webp?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/table/coin-tails.webp?${prefix}-energy`,
    ].join('\n')
  );

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);

const palette = (page: Page) => page.locator('[data-command-palette]');
const field = (page: Page) => page.locator('.ptcgsim-command-palette__field');
const rows = (page: Page) => palette(page).locator('[role="option"]');
const selectedRow = (page: Page) =>
  palette(page).locator('[role="option"][aria-selected="true"]');

const openSoloTable = async (page: Page, setUp = true): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  if (!setUp) return;
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Main'),
  });
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'alt.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Alt'),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '2'
  );
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '4'
  );
  await idle(page);
};

/** How many cards the bottom seat holds. */
const handSize = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const hand = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'hand'
    )!;
    return hand.count;
  });

test('` opens the palette; "draw 3" draws three, and typing never reaches the table', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const before = await handSize(page);

  await page.keyboard.press('Backquote');
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  // With nothing typed, the table's next steps lead.
  await expect(rows(page).first()).toBeVisible();

  await page.keyboard.type('draw 3');
  await expect(selectedRow(page)).toContainText('Draw 3 cards');
  // The 3 typed was not the table's "draw 3" key.
  expect(await handSize(page)).toBe(before);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => handSize(page)).toBe(before + 3);

  // Ctrl+K opens it too, and ` closes it.
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Backquote');
  await expect(palette(page)).toHaveCount(0);

  // Asked for, the count is typed into the field.
  await page.keyboard.press('Backquote');
  await page.keyboard.type('draw cards');
  await expect(selectedRow(page)).toContainText('Draw cards');
  await page.keyboard.press('Enter');
  await expect(field(page)).toHaveAttribute('inputmode', 'numeric');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => handSize(page)).toBe(before + 5);
  expect(errors).toEqual([]);
});

test('a card is found by name and told what to do', async ({ page }) => {
  test.setTimeout(120_000);
  await openSoloTable(page);
  const benchCount = () =>
    page.evaluate(() => {
      const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
      const bench = scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'bench'
      )!;
      return scene.cards.filter(
        (card) =>
          !card.concealed &&
          card.role === 'stackEvolution' &&
          card.bounds.y >= bench.bounds.y - 1 &&
          card.bounds.y + card.bounds.height <=
            bench.bounds.y + bench.bounds.height + 1
      ).length;
    });
  // Make sure a Pokémon is in the hand.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const names = await page.evaluate(() =>
      window
        .__PTCG_RENDERER_SPIKE__!.scene.cards.filter(
          (card) => card.side === 'local' && !card.concealed
        )
        .map((card) => card.label)
    );
    if (names.includes('Main Mon')) break;
    await page.mouse.click(700, 330);
    await page.keyboard.press('2');
    await idle(page);
  }
  const before = await benchCount();
  await page.keyboard.press('Backquote');
  await page.keyboard.type('main mon');
  await expect(selectedRow(page)).toContainText('Main Mon');
  await expect(selectedRow(page)).toContainText('Your hand');
  await page.keyboard.press('Enter');
  // The card's own screen: its name in the field, its actions listed.
  await expect(
    palette(page).locator('.ptcgsim-command-palette__crumb').last()
  ).toHaveText('Main Mon');
  await page.keyboard.type('bench');
  await expect(selectedRow(page)).toContainText('To bench');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(benchCount).toBe(before + 1);
});

test('a setting is chosen from its choices, and Escape steps back one at a time', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSoloTable(page, false);
  await page.keyboard.press('Backquote');
  await page.keyboard.type('table view');
  await expect(selectedRow(page)).toContainText('Table view');
  await page.keyboard.press('Enter');
  await expect(
    palette(page).locator('.ptcgsim-command-palette__crumb')
  ).toHaveText('Table view');
  await page.keyboard.type('flat');
  await expect(selectedRow(page)).toContainText('Flat');
  // Escape: the search, then the screen, then the palette.
  await page.keyboard.press('Escape');
  await expect(field(page)).toHaveValue('');
  await expect(
    palette(page).locator('.ptcgsim-command-palette__crumb')
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(
    palette(page).locator('.ptcgsim-command-palette__crumb')
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  // Found from the root: "Table view › Flat" in one go.
  await page.keyboard.press('Backquote');
  await page.keyboard.type('flat');
  await expect(selectedRow(page)).toContainText('Flat');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.locator('.ptcgsim-board-surface[data-table-view="flat"]')
  ).toHaveCount(1);
});

test('a dangerous command asks for a second Enter', async ({ page }) => {
  test.setTimeout(120_000);
  await openSoloTable(page);
  expect(await handSize(page)).toBeGreaterThan(0);
  await page.keyboard.press('Backquote');
  await page.keyboard.type('reset both');
  await expect(selectedRow(page)).toContainText('Reset both sides');
  await page.keyboard.press('Enter');
  await expect(selectedRow(page)).toHaveAttribute('data-armed', '');
  await expect(selectedRow(page)).toContainText('Press Enter again');
  expect(await handSize(page)).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => handSize(page)).toBe(0);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the app bar’s Commands opens it across the width', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
      timeout: 30_000,
    });
    // On a phone the app bar keeps Commands beside the log and the menu.
    await page.locator('.ptcgsim-app-bar #commandsButton').tap();
    await expect(palette(page)).toBeVisible();
    const box = (await palette(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(360);
    // No key hints where there are no keys.
    await expect(palette(page).locator('kbd')).toHaveCount(0);
    // Asked for a line, the field keeps room beside its breadcrumb, and a
    // button answers where the keyboard has no Enter.
    await field(page).fill('say');
    await rows(page).first().tap();
    await expect(
      palette(page).locator('.ptcgsim-command-palette__crumb')
    ).toBeVisible();
    expect((await field(page).boundingBox())!.width).toBeGreaterThan(100);
    await expect(
      palette(page).locator('.ptcgsim-command-palette__submit')
    ).toBeVisible();
  });

  test('a title too long for the row gives way to its seat', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openSoloTable(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator('.ptcgsim-app-bar #commandsButton').tap();
    await field(page).fill('shuffle hand to bottom');
    const row = rows(page).first();
    await expect(row.locator('.ptcgsim-command__title')).toHaveText(
      'Shuffle hand to bottom of deck and draw…'
    );
    // The title's end gives way; the seat stays whole.
    const seat = row.locator('.ptcgsim-command__detail');
    await expect(seat).toHaveText('Blue');
    const fit = await row.evaluate((element) => {
      const title = element.querySelector('.ptcgsim-command__title')!;
      const detail = element.querySelector('.ptcgsim-command__detail')!;
      return {
        titleCut: title.scrollWidth > title.clientWidth,
        seatWhole: detail.clientWidth >= detail.scrollWidth,
      };
    });
    expect(fit).toEqual({ titleCut: true, seatWhole: true });
  });
});
