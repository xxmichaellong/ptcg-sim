import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { NAMED_DECK } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * Whose deck the deck screen works on (ADR-033 §13, §19): a slot per seat
 * in the bar, the chosen one raised on the panel, underlined in its seat's
 * colour and its seat on a chip of that colour; the other flat, no line,
 * its seat named in its colour and its art lying back; that colour a faint
 * glow down the page below; the editor naming the seat by the deck's name
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

/** What the screen shows of the seat: the glow, the slots, the colours. */
const seatPaint = (page: Page) =>
  page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.deck-screen')!;
    const probe = (property: 'color' | 'backgroundColor', value: string) => {
      const node = document.createElement('span');
      node.style[property] = value;
      screen.querySelector('.deck-screen__bar')!.append(node);
      const style = getComputedStyle(node);
      const computed =
        property === 'color' ? style.color : style.backgroundColor;
      node.remove();
      return computed;
    };
    const colour = (token: string): string => probe('color', `var(${token})`);
    const body = document.querySelector('.deck-screen__body')!;
    const glow = getComputedStyle(body, '::before');
    const line = getComputedStyle(body, '::after');
    const glowOf = (token: string): string =>
      probe(
        'backgroundColor',
        `color-mix(in oklab, var(${token}) 7%, transparent)`
      );
    // A seat's colour as words: toward the theme's ink.
    const ink = (token: string): string =>
      probe(
        'color',
        `color-mix(in oklab, var(${token}) 74%, var(--color-text))`
      );
    // Nothing painted, whatever colour a fade left it at.
    const clear = (value: string): string =>
      /^rgba\([^)]*,\s*0\)$/u.test(value) ? 'transparent' : value;
    const tray = (id: string) => {
      const node = document.getElementById(id)!.closest('.deck-tray')!;
      const style = getComputedStyle(node);
      const underline = getComputedStyle(node, '::after');
      const tag = getComputedStyle(
        node.querySelector('.deck-screen__seat-tag')!
      );
      const art = node.querySelector('.deck-box');
      return {
        active: node.getAttribute('data-active') === 'true',
        background: clear(style.backgroundColor),
        border: style.borderTopWidth,
        borderColour: style.borderTopColor,
        underline: Number(underline.opacity),
        underlineColour: underline.backgroundColor,
        tag: tag.color,
        chip: clear(tag.backgroundColor),
        art: art ? Number(getComputedStyle(art).opacity) : null,
      };
    };
    return {
      you: colour('--color-you'),
      opponent: colour('--color-opponent'),
      chipInk: colour('--deck-seat-chip-ink'),
      youGlow: glowOf('--color-you'),
      opponentGlow: glowOf('--color-opponent'),
      youInk: ink('--color-you'),
      opponentInk: ink('--color-opponent'),
      header: getComputedStyle(document.querySelector('.deck-screen__bar')!)
        .backgroundColor,
      page: getComputedStyle(screen).backgroundColor,
      glow: glow.backgroundColor,
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

    // Both seats have distinct tints. The selected seat has the stronger
    // fill, a border and underline in its colour, and a matching chip.
    await expect
      .poll(async () => {
        const paint = await seatPaint(page);
        return (
          paint.glow === paint.youGlow &&
          paint.main.background !== 'transparent' &&
          paint.alt.background !== 'transparent' &&
          paint.main.background !== paint.alt.background &&
          paint.main.underline === 1 &&
          paint.main.chip === paint.you &&
          paint.alt.underline === 0
        );
      })
      .toBe(true);
    let paint = await seatPaint(page);
    expect(paint.line).toBe('none');
    expect(paint.header).not.toBe(paint.page);
    expect(paint.main).toMatchObject({
      active: true,
      border: '1px',
      underlineColour: paint.you,
      borderColour: paint.you,
      tag: paint.chipInk,
    });
    expect(paint.alt).toMatchObject({
      active: false,
      border: '1px',
      chip: 'transparent',
      tag: paint.opponentInk,
    });

    // Switched to P2: all of it follows, once each part has eased there;
    // P1's deck, now the other seat's, lies back.
    await page.locator('#nativeDeckBuilderTargetAlt').click();
    await expect
      .poll(async () => {
        const next = await seatPaint(page);
        return (
          next.glow === next.opponentGlow &&
          next.alt.background !== paint.alt.background &&
          next.alt.underline === 1 &&
          next.alt.chip === next.opponent &&
          next.main.background !== paint.main.background &&
          next.main.underline === 0 &&
          next.main.chip === 'transparent'
        );
      })
      .toBe(true);
    paint = await seatPaint(page);
    expect(paint.alt).toMatchObject({
      active: true,
      tag: paint.chipInk,
      underlineColour: paint.opponent,
      borderColour: paint.opponent,
    });
    expect(paint.main).toMatchObject({ active: false, tag: paint.youInk });
    if (name === 'desktop') {
      await expect
        .poll(async () => (await seatPaint(page)).main.art)
        .toBeLessThan(0.7);
    }

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
