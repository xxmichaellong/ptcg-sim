import { expect, test, type Locator, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  chooseMoreAction,
  openDeck,
  useFlatTable,
} from './support/table-shell.js';

/**
 * The optional Lost Zone (ADR-030 §7, ADR-039): off by default, it comes
 * onto the table the moment a card goes there -- where a shown one lies,
 * beside the prizes, never at the end of the piles under the discard pile
 * -- and putting away one holding the player's cards asks first.
 */

test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

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
  ).toHaveCount(1, { timeout: 20_000 });

const setUpBoth = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
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
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '4'
  );
  await idle(page);
};

const zone = (page: Page, kind: string, side: 'local' | 'opponent') =>
  page.locator(
    `.ptcgsim-zone[data-zone-kind="${kind}"][data-zone-side="${side}"]`
  );

const box = async (locator: Locator) => (await locator.boundingBox())!;

const centre = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** The Lost Zone lies beside the prizes, not under the discard pile. */
const besidePrizes = async (
  page: Page,
  side: 'local' | 'opponent',
  label: string
): Promise<void> => {
  const lost = centre(await box(zone(page, 'lostZone', side)));
  const prizes = centre(await box(zone(page, 'prizes', side)));
  const discard = centre(await box(zone(page, 'discard', side)));
  expect(
    Math.abs(lost.x - prizes.x),
    `${label}: nearer the prizes than the discard pile`
  ).toBeLessThan(Math.abs(lost.x - discard.x));
};

/** Moves the first card of the near hand to the Lost Zone with `l`. */
const lostZoneByKey = async (page: Page): Promise<void> => {
  const card = page
    .locator('.ptcgsim-card[data-in-hand][data-card-side="local"]')
    .first();
  await card.click();
  await page.keyboard.press('l');
  await idle(page);
};

const lostZoneEntry = async (page: Page): Promise<Locator> => {
  await page.locator('#tableExtrasButton').click();
  const entry = page.locator('#lostZoneToggle');
  await expect(entry).toBeVisible();
  return entry;
};

/** Hides the Lost Zone from the +, confirming it holds the player's cards. */
const hideWithConfirmation = async (page: Page, cards: number) => {
  const entry = await lostZoneEntry(page);
  await expect(entry).toContainText(`${String(cards)} card`);
  await entry.click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog.getByText('Hide the Lost Zone?')).toBeVisible();
  await expect(dialog).toContainText(`You have ${String(cards)} card`);
  await dialog.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(zone(page, 'lostZone', 'local')).toHaveCount(0);
  // Its entry is off, still counting the cards, and brings it back.
  const off = await lostZoneEntry(page);
  await expect(off).toContainText('Lost Zone, off');
  await expect(off).toContainText(`${String(cards)} card`);
  await page.keyboard.press('Escape');
};

test.describe('a desktop table', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('takes the Lost Zone onto the tilted table beside the prizes when a card goes there', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setUpBoth(page);
    // Off by default: no Lost Zone on either half.
    await expect(
      page.locator('.ptcgsim-zone[data-zone-kind="lostZone"]')
    ).toHaveCount(0);
    await lostZoneByKey(page);
    await expect(zone(page, 'lostZone', 'local')).toHaveCount(1);
    await besidePrizes(page, 'local', '1440x900 tilted');
    await hideWithConfirmation(page, 1);
  });

  test.describe('flat', () => {
    test.beforeEach(async ({ page }) => {
      await useFlatTable(page);
    });

    test('takes the Lost Zone onto the flat table beside the prizes, by key and by drag', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await setUpBoth(page);
      await lostZoneByKey(page);
      await besidePrizes(page, 'local', '1440x900 flat');
      // A second card dragged onto it lands there and it stays put.
      const before = await box(zone(page, 'lostZone', 'local'));
      const card = page
        .locator('.ptcgsim-card[data-in-hand][data-card-side="local"]')
        .first();
      const from = centre(await box(card));
      const to = centre(before);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, from.y - 30, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await idle(page);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
                (candidate) =>
                  candidate.kind === 'lostZone' && candidate.side === 'local'
              )?.count
          )
        )
        .toBe(2);
      expect(await box(zone(page, 'lostZone', 'local'))).toEqual(before);
      await hideWithConfirmation(page, 2);
    });
  });
});

test.describe('a short desktop window', () => {
  test.use({ viewport: { width: 1280, height: 568 } });
  test.beforeEach(async ({ page }) => {
    await useFlatTable(page);
  });

  test('takes the Lost Zone beside the prizes', async ({ page }) => {
    test.setTimeout(120_000);
    await setUpBoth(page);
    await lostZoneByKey(page);
    await besidePrizes(page, 'local', '1280x568 flat');
  });
});

test.describe('an upright phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('takes the Lost Zone into its place in the pile row', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setUpBoth(page);
    const card = page
      .locator('.ptcgsim-card[data-in-hand][data-card-side="local"]')
      .first();
    await card.tap();
    await page.keyboard.press('l');
    await idle(page);
    // The portrait mat keeps it in the row of piles, beside the discard
    // pile, not under it.
    const lost = await box(zone(page, 'lostZone', 'local'));
    const discard = await box(zone(page, 'discard', 'local'));
    expect(Math.abs(centre(lost).y - centre(discard).y)).toBeLessThan(
      discard.height / 2
    );
    expect(
      lost.x >= discard.x + discard.width - 1 ||
        lost.x + lost.width <= discard.x + 1
    ).toBe(true);
  });
});
