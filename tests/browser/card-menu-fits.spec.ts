import { devices, expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';

/**
 * A card's Actions menu, and the submenu it opens, stay on a phone's screen
 * upright or on its side: every row can be reached with a finger, the menu
 * moving up as a submenu opens under its row, and scrolling when its rows
 * are taller than the screen. The same for a card's menu opened from a pile.
 */

test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

interface Point {
  readonly x: number;
  readonly y: number;
}

const openSoloTable = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer-status="ready"]')).toBeAttached();
};

const idle = async (page: Page): Promise<void> => {
  await expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
};

/** A random list on the near seat, and Set up. */
const loadAndSetUp = async (page: Page): Promise<void> => {
  await page
    .locator('[data-load-deck-player][aria-label="Load a deck"]')
    .first()
    .tap();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="true"]')
  ).toBeVisible();
  await page.locator('#deckSurpriseButton').tap();
  await expect(
    page.locator('#nativeDeckBuilderSummaryPanel')
  ).not.toHaveAttribute('data-card-count', '0');
  await page.locator('#deckBackButton').tap();
  await page.locator('#setupButton').tap();
  await expect
    .poll(() => page.locator('[data-in-hand="true"]').count())
    .toBe(7);
  await idle(page);
};

const centre = async (page: Page, selector: string): Promise<Point> => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const touchDrag = async (page: Page, from: Point, to: Point) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let index = 1; index <= 14; index += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * index) / 14,
          y: from.y + ((to.y - from.y) * index) / 14,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await idle(page);
};

const menu = (page: Page) => page.locator('.ptcgsim-legacy-card-context-menu');

/** Notices gone: one lies over the screen's foot for a few seconds. */
const closeToasts = async (page: Page): Promise<void> => {
  await expect(page.locator('.ptcgsim-ui-toast')).toHaveCount(0, {
    timeout: 20_000,
  });
};

/**
 * Every row the menu shows, scrolled to where the menu scrolls it: inside
 * the window, and the row itself under its centre (not cut off, nor under
 * anything else). The rows that aren't.
 */
const unreachableRows = (page: Page) =>
  menu(page).evaluate((element) => {
    const view = element.ownerDocument.defaultView!;
    const failures: string[] = [];
    for (const row of element.querySelectorAll<HTMLElement>(
      '[role="menuitem"]'
    )) {
      if (row.getClientRects().length === 0) continue;
      row.scrollIntoView({ block: 'nearest' });
      const box = row.getBoundingClientRect();
      const inside =
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= view.innerWidth &&
        box.bottom <= view.innerHeight;
      const hit = element.ownerDocument.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      if (!inside || !row.contains(hit)) {
        failures.push(
          `${row.textContent?.trim() ?? ''} at ${Math.round(box.top)}–${Math.round(box.bottom)}`
        );
      }
    }
    element.scrollTop = 0;
    return failures;
  });

/** The open menu, then with Move card… open, every row reachable. */
const expectMenuFits = async (page: Page): Promise<void> => {
  await expect(menu(page)).toBeVisible();
  // Placed once it has scaled in.
  await expect
    .poll(() =>
      menu(page).evaluate((element) =>
        element
          .getAnimations()
          .every((animation) => animation.playState !== 'running')
      )
    )
    .toBe(true);
  expect(await unreachableRows(page)).toEqual([]);
  const move = menu(page).locator('[data-context-action="moveCard"]');
  await move.scrollIntoViewIfNeeded();
  await move.tap();
  await expect(move).toHaveAttribute('aria-expanded', 'true');
  await expect(
    menu(page).locator('[data-context-submenu="moveCard"] [role="menuitem"]')
  ).toHaveCount(5);
  // The submenu opened under its row is in view, and the row above it.
  await expect(
    menu(page).locator('[data-move-choice="deckShuffle"]')
  ).toBeInViewport();
  await expect(move).toBeInViewport();
  await expect
    .poll(async () => (await unreachableRows(page)).join(', '))
    .toBe('');
};

const cardMenusFit = async (page: Page): Promise<void> => {
  await openSoloTable(page);
  await loadAndSetUp(page);

  // A card on the Active spot.
  await touchDrag(
    page,
    await centre(page, '[data-in-hand="true"]'),
    await centre(page, '[data-zone-kind="active"][data-zone-side="local"]')
  );
  await closeToasts(page);
  await page
    .locator('[data-card-role="stackEvolution"][data-card-side="local"]')
    .first()
    .tap({ position: { x: 10, y: 10 } });
  await page.locator('#touchCardActionsButton').tap();
  await expectMenuFits(page);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  // A card in the deck's window.
  const deck = await centre(
    page,
    '[data-zone-kind="deck"][data-zone-side="local"]'
  );
  await page.touchscreen.tap(deck.x, deck.y);
  const browser = page.locator('[data-zone-browser-kind="deck"]');
  await expect(browser).toBeVisible();
  await closeToasts(page);
  await browser.locator('.ptcgsim-zone-card').nth(2).tap();
  await browser.locator('button', { hasText: /^Actions$/u }).tap();
  await expectMenuFits(page);
};

test.describe('an upright phone', () => {
  const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
  test.use(phone);

  test("keeps a card's menus on the screen", async ({ page }) => {
    test.setTimeout(90_000);
    await cardMenusFit(page);
  });
});

test.describe('a phone on its side', () => {
  const { defaultBrowserType: _browser, ...phone } =
    devices['iPhone 13 landscape'];
  test.use(phone);

  test("keeps a card's menus on the screen", async ({ page }) => {
    test.setTimeout(90_000);
    await cardMenusFit(page);
  });
});
