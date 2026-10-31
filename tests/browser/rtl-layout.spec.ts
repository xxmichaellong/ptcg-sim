import { expect, test, type Locator, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import {
  chooseMoreAction,
  closeActivity,
  closeSheet,
  openActivity,
  openDeck,
  openSettings,
} from './support/table-shell.js';

/**
 * Arabic is written right to left (ADR-034): the page's chrome mirrors --
 * a sheet's or the log's heading starts at the right, its close button at
 * the left, a menu's icons at the right, the log docks at the left with the
 * side sheets, and the deck screen's zoom opens to a card's left -- while
 * the table keeps the world's way round: laid out as ever, it moves over
 * beside the log, and plays the same. Back in English, everything is as it
 * was.
 */

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Main Mon,Pokémon,/v2/assets/cardback.png?main-mon',
    '30,Main Energy,Energy,/v2/assets/cardback.png?main-energy',
  ].join('\n')
);

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Not on screen');
  return found;
};

const centreX = async (locator: Locator) => {
  const { x, width } = await box(locator);
  return x + width / 2;
};

const settings = (page: Page) => page.locator('#settings');
/**
 * Whether the sheet's heading lies left of its way out: both read in one
 * frame, as the sheet may still be sliding in.
 */
const settingsTitleLeftOfClose = (page: Page): Promise<boolean> =>
  settings(page).evaluate((sheet) => {
    const centre = (selector: string): number => {
      const rect = sheet.querySelector(selector)!.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    return centre('.ptcgsim-sheet__title') < centre('.ptcgsim-sheet__close');
  });

const openTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 60_000 });
};

/** The table, read off the screen: these never move with the language. */
const tableSides = async (page: Page) => ({
  menu: await centreX(page.locator('#appMenuButton')),
  log: await centreX(page.locator('#activityButton')),
});

/** Where the docked log rests once it has slid all the way in. */
const restingLog = async (page: Page, edge: 'left' | 'right') => {
  const log = page.locator('#activitySheet');
  await expect
    .poll(async () => {
      const { x, width } = await box(log);
      return Math.round(edge === 'left' ? x : x + width);
    })
    .toBe(edge === 'left' ? 0 : 1440);
  return box(log);
};

/** The table's sides once the log has finished sliding in or out. */
const settledSides = async (page: Page) => {
  let last = await tableSides(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(150);
      const next = await tableSides(page);
      const still = next.menu === last.menu && next.log === last.log;
      last = next;
      return still;
    })
    .toBe(true);
  return last;
};

test('Arabic mirrors the chrome around the table, and English puts it back', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const english = await tableSides(page);
  // The app bar, in the table's top-right corner: the log, then the menu.
  expect(english.log).toBeLessThan(english.menu);
  // With the log docked at the right, the table lays itself out beside it.
  await openActivity(page);
  const englishLog = await restingLog(page, 'right');
  const englishDocked = await settledSides(page);
  expect(englishDocked).not.toEqual(english);
  await closeActivity(page);
  expect(await settledSides(page)).toEqual(english);

  await openSettings(page);
  // English: the heading at the left, the way out at the right.
  expect(await settingsTitleLeftOfClose(page)).toBe(true);
  await page.locator('#languageSelect').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  // The sheet's heading mirrors, and the sheet opens at the left now, where
  // the log docks.
  await expect.poll(() => settingsTitleLeftOfClose(page)).toBe(false);
  await expect.poll(async () => (await box(settings(page))).x).toBeLessThan(40);
  // A switch is on towards the end of the line: the left, now.
  const firstSwitch = settings(page).locator('.ds-switch').first();
  expect(
    await firstSwitch.evaluate((element) => getComputedStyle(element).direction)
  ).toBe('rtl');
  await closeSheet(page);

  // The table does not mirror: it stays left to right, the rail and the
  // app bar in its corner the same way round.
  const table = page.locator('.board-spike-host');
  await expect(table).toHaveAttribute('dir', 'ltr');
  expect(
    await page
      .locator('.ptcgsim-board-surface')
      .evaluate((element) => getComputedStyle(element).direction)
  ).toBe('ltr');
  expect(await tableSides(page)).toEqual(english);

  // The log docks at the left, its heading mirrored, and the table, laid
  // out just as it is beside the log in English, moves over beside it.
  await openActivity(page);
  const log = page.locator('#activitySheet');
  const logBox = await restingLog(page, 'left');
  expect(logBox.width).toBeCloseTo(englishLog.width, 0);
  expect(
    await log.evaluate((element) => getComputedStyle(element).direction)
  ).toBe('rtl');
  const arabicDocked = await settledSides(page);
  expect(arabicDocked.menu - englishDocked.menu).toBeCloseTo(
    1440 - englishLog.x,
    0
  );
  expect(arabicDocked.log - englishDocked.log).toBeCloseTo(
    1440 - englishLog.x,
    0
  );

  // A card's menu, raised from the table, reads right to left: each row's
  // icon at its right.
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv,
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await chooseMoreAction(page, 'setupBothButton');
  const handCard = page
    .locator('[data-in-hand][data-card-side="local"]')
    .filter({ has: page.locator('img') })
    .first();
  await expect(handCard).toBeVisible();
  await expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
  await handCard.click({ button: 'right' });
  const menu = page.locator('[data-legacy-card-context-menu]');
  await expect(menu).toHaveAttribute('dir', 'rtl');
  const row = menu.locator('.ptcgsim-menu-item').first();
  expect(await centreX(row.locator('.ptcgsim-menu-icon'))).toBeGreaterThan(
    await centreX(row.locator('.ptcgsim-menu-label'))
  );
  await page.keyboard.press('Escape');

  // Moved over beside the log, the table still plays where it is painted:
  // a card carried from the hand lands on the bench it is dropped on.
  const handCount = () =>
    page.locator('[data-in-hand][data-card-side="local"]').count();
  const inHand = await handCount();
  const bench = await box(
    page.locator(
      '.ptcgsim-zone[data-zone-kind="bench"][data-zone-side="local"]'
    )
  );
  expect(bench.x).toBeGreaterThan(logBox.x + logBox.width);
  const grip = await box(handCard);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(bench.x + bench.width / 2, bench.y + bench.height / 2, {
    steps: 14,
  });
  await expect(
    page.locator(
      '.ptcgsim-zone[data-zone-kind="bench"][data-zone-side="local"][data-drop-target="true"]'
    )
  ).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(handCount).toBe(inHand - 1);
  await expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
  const benched = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const bench = scene.zones.find(
      (zone) => zone.kind === 'bench' && zone.side === 'local'
    )!;
    return scene.cards.filter(
      (card) =>
        card.role === 'stackEvolution' &&
        card.bounds.y + card.bounds.height / 2 > bench.bounds.y &&
        card.bounds.y + card.bounds.height / 2 <
          bench.bounds.y + bench.bounds.height
    ).length;
  });
  expect(benched).toBe(1);

  // Back to English: everything left to right again.
  await openSettings(page);
  await page.locator('#languageSelect').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect.poll(() => settingsTitleLeftOfClose(page)).toBe(true);
});

/**
 * Builds a deck of one card in `language`, shows it as images and rests the
 * mouse on its tile: is the zoom after it (its right) or before it?
 */
const deckZoomSide = async (
  page: Page,
  language: 'en' | 'ar'
): Promise<'right' | 'left'> => {
  await routeCardCatalog(page);
  await page.addInitScript((chosen) => {
    localStorage.setItem(
      'ptcgsim.language.v1',
      JSON.stringify({ language: chosen })
    );
  }, language);
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    language === 'ar' ? 'rtl' : 'ltr'
  );
  await openDeck(page);
  await page.locator('#deckNewButton').click();
  await page.locator('#nativeDeckBuilderSearchInput').fill('t:dragon');
  await page
    .locator('.card-search__grid li')
    .first()
    .getByRole('button')
    .first()
    .click();
  await page.locator('#deckView-images').check({ force: true });
  const tile = page
    .locator('#nativeDeckBuilderCardsPanel .deck-row__card')
    .first();
  await expect(tile).toBeVisible();
  const zoom = page.locator('.deck-zoom');
  await tile.hover();
  await expect(zoom).toBeVisible();
  const card = await box(tile);
  const shown = await box(zoom);
  // There is room on both sides: the zoom takes the one the line reads
  // towards.
  expect(card.x).toBeGreaterThan(shown.width + 40);
  expect(1440 - (card.x + card.width)).toBeGreaterThan(shown.width + 40);
  return shown.x > card.x ? 'right' : 'left';
};

test("the deck screen's zoom opens to a card's right in English", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(await deckZoomSide(page, 'en')).toBe('right');
});

test("the deck screen's zoom opens to a card's left in Arabic", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(await deckZoomSide(page, 'ar')).toBe('left');
});

test("the deck finder's magnifier sits as far from the field's start in Arabic as in English", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const startGap = async (language: 'en' | 'ar'): Promise<number> => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await context.newPage();
      await routeCardCatalog(page);
      await page.addInitScript((chosen) => {
        localStorage.setItem(
          'ptcgsim.language.v1',
          JSON.stringify({ language: chosen })
        );
      }, language);
      await openTable(page);
      await openDeck(page);
      const field = await box(page.locator('.deck-paste'));
      const icon = await box(page.locator('.deck-paste__icon'));
      return language === 'ar'
        ? field.x + field.width - (icon.x + icon.width)
        : icon.x - field.x;
    } finally {
      await context.close();
    }
  };
  const english = await startGap('en');
  expect(english).toBeGreaterThan(4);
  expect(Math.abs((await startGap('ar')) - english)).toBeLessThan(1);
});
