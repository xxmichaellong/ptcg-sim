import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { NAMED_DECK } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * Whose deck the deck screen works on (ADR-033 §13, 2026-10-30): the
 * chosen seat's tray pulled out in its colour, its neck running into a band
 * of that colour over the screen below; the other tray quieter; the editor
 * naming the seat by the deck's name and edging its sheet in the colour.
 */

const openDeckScreen = async (page: Page, width: number, height: number) => {
  await ownRoomBudget(page.context());
  await routeCardCatalog(page);
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'Main.csv',
    mimeType: 'text/csv',
    buffer: NAMED_DECK,
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
};

/** What the screen shows of the seat: the band, the trays, the colours. */
const seatPaint = (page: Page) =>
  page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.deck-screen')!;
    const colour = (token: string): string => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      screen.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const body = document.querySelector('.deck-screen__body')!;
    const band = getComputedStyle(body, '::after');
    const tray = (id: string) => {
      const node = document.getElementById(id)!.closest('.deck-tray')!;
      const style = getComputedStyle(node);
      return {
        active: node.getAttribute('data-active') === 'true',
        opacity: Number(style.opacity),
        background: style.backgroundColor,
        neck: getComputedStyle(node, '::after').content,
      };
    };
    return {
      you: colour('--color-you'),
      opponent: colour('--color-opponent'),
      band: band.backgroundColor,
      bandHeight: band.height,
      main: tray('nativeDeckBuilderTargetMain'),
      alt: tray('nativeDeckBuilderTargetAlt'),
    };
  });

for (const [name, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
] as const)
  test(`the chosen seat is unmistakable, and follows a switch: ${name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openDeckScreen(page, width, height);

    // P1 chosen: its tray pulled out in its colour, its neck into the band.
    await expect
      .poll(async () => {
        const paint = await seatPaint(page);
        return paint.band === paint.you;
      })
      .toBe(true);
    let paint = await seatPaint(page);
    expect(paint.bandHeight).toBe('3px');
    expect(paint.main).toMatchObject({ active: true, opacity: 1 });
    expect(paint.main.neck).not.toBe('none');
    expect(paint.alt.active).toBe(false);
    expect(paint.alt.neck).toBe('none');
    expect(paint.alt.opacity).toBeLessThan(0.8);
    expect(paint.main.background).not.toBe(paint.alt.background);

    // Switched to P2: all of it follows.
    await page.locator('#nativeDeckBuilderTargetAlt').click();
    await expect
      .poll(async () => {
        const next = await seatPaint(page);
        return next.band === next.opponent;
      })
      .toBe(true);
    paint = await seatPaint(page);
    expect(paint.alt).toMatchObject({ active: true, opacity: 1 });
    expect(paint.alt.neck).not.toBe('none');
    expect(paint.main.active).toBe(false);

    // Back on P1, its deck in the editor: the seat by the name, the sheet
    // edged in its colour.
    await page.locator('#nativeDeckBuilderTargetMain').click();
    await page
      .locator('.deck-tile[data-current="true"] .deck-tile__choose')
      .first()
      .dblclick();
    const chip = page.locator('.deck-editor__name .deck-editor__seat');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('P1');
    await expect(page.locator('.deck-editor')).toHaveAttribute(
      'data-on-seat',
      'self'
    );
    if (name === 'desktop') {
      const sheet = await page
        .locator('.deck-editor__pane--deck')
        .evaluate((node) => getComputedStyle(node).borderTopColor);
      expect(sheet).toBe((await seatPaint(page)).you);
    }
  });
