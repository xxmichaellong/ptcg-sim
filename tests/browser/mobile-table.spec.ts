import { devices, expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  appMenu,
  appMenuOpener,
  chooseMenuItem,
} from './support/table-shell.js';

/**
 * Phones and touch screens are first-class (ADR-030): an upright phone gets
 * the portrait table, the rail's targets are a finger's size and stay clear
 * of the Stadium and the log, a tapped card offers Read and Actions, and
 * everything else opens from the bottom. A tablet keeps the landscape table
 * and the deck screen's two columns.
 */

test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

const CARD_ASPECT_RATIO = 0.716;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** The local half's zones as the scene places them. */
const localZones = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const zone = (kind: string, side = 'local') =>
      scene.zones.find(
        (candidate) => candidate.kind === kind && candidate.side === side
      )?.bounds;
    return {
      bench: zone('bench'),
      deck: zone('deck'),
      discard: zone('discard'),
      stadium: zone('stadium', 'shared'),
    };
  });

const openSoloTable = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer-status="ready"]')).toBeAttached();
};

/** The deck pile's `+` opens the deck screen; a random list goes in. */
const loadRandomDeck = async (page: Page): Promise<void> => {
  const plus = page.locator(
    '[data-load-deck-player][aria-label="Load a deck"]'
  );
  await expect(plus).toBeVisible();
  await plus.tap();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="true"]')
  ).toBeVisible();
  await page.locator('#deckSurpriseButton').tap();
  await expect(
    page.locator('#nativeDeckBuilderSummaryPanel')
  ).not.toHaveAttribute('data-card-count', '0');
  await page.locator('#deckBackButton').tap();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator('#setupButton')).toBeVisible();
};

const setUp = async (page: Page): Promise<void> => {
  await page.locator('#setupButton').tap();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
            (zone) => zone.side === 'local' && zone.kind === 'hand'
          )?.count
      )
    )
    .toBe(7);
  await expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
};

/** A tapped card's Read and Actions, as a right-click and a double-click. */
const tapFlow = async (page: Page): Promise<void> => {
  const card = page.locator('[data-in-hand="true"]').first();
  await card.tap({ position: { x: 20, y: 20 } });
  const bar = page.locator('[data-touch-card-bar]');
  await expect(bar).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport.width);
  expect(barBox.y).toBeGreaterThanOrEqual(0);

  await page.locator('#touchCardActionsButton').tap();
  const menu = page.locator('.ptcgsim-legacy-card-context-menu');
  await expect(menu).toBeVisible();
  // A finger has no keys: the menu's key hints are hidden.
  const hints = await menu
    .locator('[data-menu-hint]')
    .evaluateAll((items) =>
      items.map((item) => getComputedStyle(item, '::after').content)
    );
  expect(hints.length).toBeGreaterThan(0);
  for (const hint of hints) expect(hint).toBe('none');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  if (!(await bar.isVisible())) {
    await card.tap({ position: { x: 20, y: 20 } });
  }
  await page.locator('#touchReadCardButton').tap();
  await expect(page.locator('[data-preview-kind="card"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-preview-kind="card"]')).toHaveCount(0);
};

const expectNoSideScroll = async (page: Page): Promise<void> => {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
};

test.describe('an upright phone', () => {
  const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
  test.use(phone);

  test('plays on a portrait table with finger-sized controls', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openSoloTable(page);
    await expectNoSideScroll(page);

    // The portrait mat: the piles sit side by side above the hand, not
    // stacked down the side.
    const empty = await localZones(page);
    expect(Math.abs(empty.deck!.y - empty.discard!.y)).toBeLessThan(1);
    expect(empty.discard!.x).toBeGreaterThan(empty.deck!.x);
    expect(empty.bench!.width).toBeGreaterThan(empty.bench!.height);
    // Bench cards are read at a size a phone can show: ~43px wide in
    // Safari's 390x664 visible area, where the landscape mat squeezed into
    // portrait gave ~10px.
    expect(empty.bench!.height * CARD_ASPECT_RATIO).toBeGreaterThanOrEqual(40);

    await loadRandomDeck(page);
    await setUp(page);

    // Both hands' count pills sit inside the window, not off its edges.
    const pills = page.locator('.table-hand-pill');
    await expect(pills).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const box = (await pills.nth(index).boundingBox())!;
      const size = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }

    // The rail: 44px targets inside the window, clear of the Stadium and
    // of the log's button; what does not fit waits in More.
    const viewport = page.viewportSize()!;
    const placed = await localZones(page);
    const activity = (await page.locator('#activityButton').boundingBox())!;
    const buttons = page.locator(
      '[data-table-rail] .ptcgsim-table-rail__actions .ptcgsim-rail-button'
    );
    const count = await buttons.count();
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count; index += 1) {
      const box = (await buttons.nth(index).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(overlaps(box, placed.stadium!)).toBe(false);
      expect(overlaps(box, activity)).toBe(false);
    }
    // Attack and Pass the turn are on the rail or in More.
    const onRail = await buttons.evaluateAll((elements) =>
      elements.map(
        (element) =>
          element.getAttribute('aria-label') ??
          element.textContent?.trim() ??
          ''
      )
    );
    await page.locator('#moreActionsButton').tap();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    const inMore = await page
      .getByRole('menuitem')
      .evaluateAll((elements) =>
        elements.map((element) => element.textContent?.trim() ?? '')
      );
    for (const action of ['Attack', 'Pass the turn']) {
      expect(
        [...onRail, ...inMore].some((label) => label.startsWith(action)),
        action
      ).toBe(true);
    }
    await page.keyboard.press('Escape');

    await tapFlow(page);

    // The log rises from the bottom, dark like the rest of the table.
    await page.locator('#activityButton').tap();
    const log = page.locator('#activitySheet');
    await expect(log).toHaveAttribute('data-variant', 'bottom');
    await expect(page.locator('#chatbox')).not.toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)'
    );
    await page.keyboard.press('Escape');
    await expect(log).toHaveCount(0);

    await chooseMenuItem(page, 'settingsButton');
    await expect(page.locator('#settings')).toHaveAttribute(
      'data-variant',
      'bottom'
    );
    await page.keyboard.press('Escape');
    await expectNoSideScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe('a tablet held sideways', () => {
  const { defaultBrowserType: _browser, ...tablet } =
    devices['iPad (gen 7) landscape'];
  test.use(tablet);

  test('keeps the landscape table, the deck screen, and the same taps', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openSoloTable(page);
    await expectNoSideScroll(page);
    const viewport = page.viewportSize()!;

    // The app menu fits the window.
    await (await appMenuOpener(page)).tap();
    const menu = appMenu(page);
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press('Escape');

    // The deck screen opens on the decks, ready for a paste.
    const plus = page.locator(
      '[data-load-deck-player][aria-label="Load a deck"]'
    );
    await plus.tap();
    const layer = page.locator('.ptcgsim-deck-layer[data-open="true"]');
    await expect(layer).toBeVisible();
    await expect(page.locator('#deckPasteInput')).toBeVisible();
    await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
    await page.locator('#deckSurpriseButton').tap();
    await expect(
      page.locator('#nativeDeckBuilderSummaryPanel')
    ).not.toHaveAttribute('data-card-count', '0');
    await page.locator('#deckBackButton').tap();
    await expect(page.locator('#setupButton')).toBeVisible();

    await setUp(page);
    await tapFlow(page);
    await expectNoSideScroll(page);
    expect(errors).toEqual([]);
  });
});
