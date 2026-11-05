import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { NAMED_DECK } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * Whose deck the deck screen works on (ADR-033 §13): the chosen seat's
 * segment of the seats' switch filled in its colour, its tag white on it,
 * a line of that colour over the screen below; the other segment unfilled,
 * its tag in its own colour; the editor naming the seat by the deck's name
 * and edging its deck in the colour.
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
    // A seat's colour as its chosen segment is filled with it.
    const fill = (token: string): string => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `color-mix(in oklab, var(${token}) 86%, black)`;
      screen.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    const tray = (id: string) => {
      const node = document.getElementById(id)!.closest('.deck-tray')!;
      const style = getComputedStyle(node);
      const tag = node.querySelector('.deck-screen__seat-tag')!;
      return {
        active: node.getAttribute('data-active') === 'true',
        opacity: Number(style.opacity),
        background: style.backgroundColor,
        tag: getComputedStyle(tag).backgroundColor,
      };
    };
    return {
      you: colour('--color-you'),
      opponent: colour('--color-opponent'),
      youFill: fill('--color-you'),
      opponentFill: fill('--color-opponent'),
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

    // P1 chosen: its segment filled in its colour, its tag white on it, its
    // colour along the top of the screen; P2's unfilled, its tag red.
    await expect
      .poll(async () => {
        const paint = await seatPaint(page);
        return (
          paint.band === paint.you && paint.main.background === paint.youFill
        );
      })
      .toBe(true);
    let paint = await seatPaint(page);
    expect(paint.bandHeight).toBe('3px');
    expect(paint.main).toMatchObject({
      active: true,
      opacity: 1,
      tag: 'rgb(255, 255, 255)',
    });
    expect(paint.alt).toMatchObject({
      active: false,
      opacity: 1,
      background: 'rgba(0, 0, 0, 0)',
      tag: paint.opponent,
    });

    // Switched to P2: all of it follows, once each part has eased there
    // (the line and the segments ease apart, and may land a frame apart).
    await page.locator('#nativeDeckBuilderTargetAlt').click();
    await expect
      .poll(async () => {
        const next = await seatPaint(page);
        return (
          next.band === next.opponent &&
          next.alt.background === next.opponentFill &&
          next.main.background === 'rgba(0, 0, 0, 0)' &&
          next.main.tag === next.you
        );
      })
      .toBe(true);
    paint = await seatPaint(page);
    expect(paint.alt).toMatchObject({
      active: true,
      tag: 'rgb(255, 255, 255)',
    });
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
      const you = (await seatPaint(page)).you;
      await expect
        .poll(() =>
          page
            .locator('.deck-editor__pane--deck')
            .evaluate((node) => getComputedStyle(node).borderTopColor)
        )
        .toBe(you);
    }
  });
