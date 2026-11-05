import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { NAMED_DECK } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * Whose deck the deck screen works on (ADR-033 §13, §17): the seats are one
 * segmented control, the chosen seat's segment raised and tinted in its
 * colour with its seat on a chip of that colour, and no ring or line; that
 * colour washes down the page below; the other segment flat, its seat named
 * in its colour; the editor naming the seat by the deck's name and edging
 * its deck in the colour.
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
    const wash = getComputedStyle(body, '::before');
    const line = getComputedStyle(body, '::after');
    // A seat's colour as its chosen segment is tinted with it, and as the
    // page under the bar is washed with it.
    const mix = (token: string, share: number, base: string): string => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `color-mix(in oklab, var(${token}) ${String(share)}%, ${base})`;
      screen.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    // By night a larger share: the warm surface greys a third of it.
    const tintShare =
      document.documentElement.dataset.theme === 'night' ? 46 : 30;
    const tint = (token: string): string =>
      mix(token, tintShare, 'var(--color-surface-3)');
    const washOf = (token: string): string => mix(token, 12, 'transparent');
    // A seat's colour as words: toward the theme's ink.
    const ink = (token: string): string => {
      const probe = document.createElement('span');
      probe.style.color = `color-mix(in oklab, var(${token}) 74%, var(--color-text))`;
      screen.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    // Nothing painted, whatever colour a fade left it at.
    const clear = (value: string): string =>
      /^rgba\([^)]*,\s*0\)$/u.test(value) ? 'transparent' : value;
    const tray = (id: string) => {
      const node = document.getElementById(id)!.closest('.deck-tray')!;
      const style = getComputedStyle(node);
      const tag = getComputedStyle(
        node.querySelector('.deck-screen__seat-tag')!
      );
      return {
        active: node.getAttribute('data-active') === 'true',
        opacity: Number(style.opacity),
        background: clear(style.backgroundColor),
        border: style.borderTopWidth,
        shadow: style.boxShadow,
        tag: tag.color,
        chip: clear(tag.backgroundColor),
      };
    };
    return {
      you: colour('--color-you'),
      opponent: colour('--color-opponent'),
      chipInk: colour('--deck-seat-chip-ink'),
      youTint: tint('--color-you'),
      opponentTint: tint('--color-opponent'),
      youWash: washOf('--color-you'),
      opponentWash: washOf('--color-opponent'),
      youInk: ink('--color-you'),
      opponentInk: ink('--color-opponent'),
      wash: wash.backgroundColor,
      line: line.content,
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

    // P1 chosen: its segment raised and tinted in its colour, its seat on
    // a chip of that colour, the page washed with it below; P2's flat, its
    // seat named in its colour. No ring, no border, no line under the bar.
    await expect
      .poll(async () => {
        const paint = await seatPaint(page);
        return (
          paint.wash === paint.youWash &&
          paint.main.background === paint.youTint &&
          paint.main.chip === paint.you
        );
      })
      .toBe(true);
    let paint = await seatPaint(page);
    expect(paint.line).toBe('none');
    expect(paint.main).toMatchObject({
      active: true,
      opacity: 1,
      border: '0px',
      tag: paint.chipInk,
    });
    expect(paint.main.shadow).not.toContain(paint.you);
    expect(paint.alt).toMatchObject({
      active: false,
      opacity: 1,
      border: '0px',
      shadow: 'none',
      background: 'transparent',
      chip: 'transparent',
      tag: paint.opponentInk,
    });

    // Switched to P2: all of it follows, once each part has eased there
    // (the line and the tabs ease apart, and may land a frame apart).
    await page.locator('#nativeDeckBuilderTargetAlt').click();
    await expect
      .poll(async () => {
        const next = await seatPaint(page);
        return (
          next.wash === next.opponentWash &&
          next.alt.background === next.opponentTint &&
          next.alt.chip === next.opponent &&
          next.main.background === 'transparent' &&
          next.main.chip === 'transparent'
        );
      })
      .toBe(true);
    paint = await seatPaint(page);
    expect(paint.alt).toMatchObject({ active: true, tag: paint.chipInk });
    expect(paint.main).toMatchObject({ active: false, tag: paint.youInk });

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
