import { devices, expect, test, type Page } from '@playwright/test';

/**
 * What opens over what (design/tokens.css, Layers): a preview over the
 * viewer it was read from, a card menu over the window it came from, a menu
 * over the sheet that opened it. Each check asks the browser what is
 * painted on top at a point, not what the stylesheet says.
 */

const LAYERS = [
  '--layer-table',
  '--layer-chrome',
  '--layer-panel',
  '--layer-deck-screen',
  '--layer-sheet',
  '--layer-dialog',
  '--layer-popover',
  '--layer-toast',
  '--layer-tooltip',
  '--layer-drag',
] as const;

const TABLE_LAYERS = [
  '--table-layer-affordances',
  '--table-layer-rail',
  '--table-layer-touch-bar',
  '--table-layer-inspector',
  '--table-layer-banner',
  '--table-layer-viewers',
] as const;

const VIEWER_LAYERS = [
  '--viewer-layer-window',
  '--viewer-layer-browser',
  '--viewer-layer-preview',
  '--viewer-layer-menu',
  '--viewer-layer-editor',
] as const;

/** A Solo table with a random deck set up, by taps or clicks. */
const setUpTable = async (page: Page, touch: boolean): Promise<void> => {
  const press = (selector: string) =>
    touch
      ? page.locator(selector).first().tap()
      : page.locator(selector).first().click();
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await press('[data-load-deck-player][aria-label="Load a deck"]');
  await press('#deckSurpriseButton');
  await expect(
    page.locator('#nativeDeckBuilderSummaryPanel')
  ).not.toHaveAttribute('data-card-count', '0');
  await press('#deckBackButton');
  await press('#setupButton');
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
};

/**
 * Whether, at the centre of `under`'s box, something inside `over` is
 * painted above everything inside `under`.
 */
const paintedAbove = (page: Page, over: string, under: string) =>
  page.evaluate(
    ({ over, under }) => {
      const lower = document.querySelector(under);
      if (!lower) return 'missing lower';
      const box = lower.getBoundingClientRect();
      const stack = document.elementsFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      const top = stack.findIndex(
        (element) => element.closest(over) || element.closest(under)
      );
      if (top < 0) return 'neither';
      return stack[top]!.closest(over) ? 'above' : 'below';
    },
    { over, under }
  );

/** Whether what is painted at the centre of `selector` belongs to it. */
const paintedOnTop = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return Boolean(
      document
        .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        ?.closest(selector)
    );
  }, selector);

test('the layers keep their documented order', async ({ page }) => {
  await page.goto('/');
  const values = await page.evaluate(
    (names) =>
      names.map((group) =>
        group.map((name) =>
          Number(
            getComputedStyle(document.documentElement).getPropertyValue(name)
          )
        )
      ),
    [LAYERS, TABLE_LAYERS, VIEWER_LAYERS] as unknown as string[][]
  );
  for (const group of values) {
    for (const value of group) expect(Number.isFinite(value)).toBe(true);
    expect([...group].sort((a, b) => a - b)).toEqual(group);
    expect(new Set(group).size).toBe(group.length);
  }
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
  test.use(phone);

  test('a card read from "Looking at cards" covers the whole window', async ({
    page,
  }) => {
    await setUpTable(page, true);
    await page.keyboard.press('Alt+3');
    const area = page.locator('[data-legacy-work-area="inspection"]');
    await expect(area).toBeVisible();
    const card = area.locator('[data-work-area-card-id]').first();
    await card.tap();
    const bar = area.locator('.ptcgsim-card-actions');
    await expect(bar).toBeVisible();
    // Tapped again, the card is read.
    await card.dblclick();
    await expect(page.locator('[data-legacy-card-preview]')).toBeVisible();
    // The window's sticky action bar and its card handles used to cut
    // across the card being read.
    expect(
      await paintedAbove(
        page,
        '[data-legacy-card-preview]',
        '[data-legacy-work-area="inspection"] .ptcgsim-card-actions'
      )
    ).toBe('above');
    expect(
      await paintedAbove(
        page,
        '[data-legacy-card-preview]',
        '[data-legacy-work-area="inspection"] .ptcgsim-legacy-work-area-buttons'
      )
    ).toBe('above');
  });

  test("a sheet's menu opens over the sheet", async ({ page }) => {
    await setUpTable(page, true);
    await page.locator('#activityButton').tap();
    await expect(page.locator('#activitySheet')).toBeVisible();
    await page.locator('#activityLogMenuButton').tap();
    const menu = page.locator('.ptcgsim-action-menu');
    await expect(menu).toBeVisible();
    // Behind the sheet, what showed at the menu's centre was the sheet.
    expect(await paintedOnTop(page, '.ptcgsim-action-menu')).toBe(true);
  });
});

test('in a pile viewer, a preview and a card menu open over its bars', async ({
  page,
}) => {
  await setUpTable(page, false);
  const deckId = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'deck'
      )!.id
  );
  await page.locator(`[data-zone-id="${deckId}"]`).focus();
  await page.keyboard.press('Enter');
  const browser = page.locator('[data-legacy-zone-browser]');
  await expect(browser).toBeVisible();
  await browser.locator('[data-overlay-card-id]').nth(1).click();
  const bar = browser.locator('.ptcgsim-card-actions');
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Actions' }).click();
  const menu = page.locator('.ptcgsim-legacy-card-context-menu');
  await expect(menu).toBeVisible();
  expect(await paintedOnTop(page, '.ptcgsim-legacy-card-context-menu')).toBe(
    true
  );
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await browser.locator('[data-overlay-card-id]').nth(1).dblclick();
  await expect(page.locator('[data-legacy-card-preview]')).toBeVisible();
  for (const under of [
    '[data-legacy-zone-browser] .ptcgsim-card-actions',
    '[data-legacy-zone-browser] .ptcgsim-browser-tools',
  ]) {
    expect(await paintedAbove(page, '[data-legacy-card-preview]', under)).toBe(
      'above'
    );
  }
});
