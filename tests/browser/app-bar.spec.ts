import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  openActivity,
  openDeck,
} from './support/table-shell.js';

/**
 * The app bar (ADR-036): the app's controls in the table's top-right
 * corner, the corner the table keeps clear, and the turn's actions on the
 * seam at its right end. Every zone's hover name is centred, but for an
 * empty deck's, which gives its `+` the middle.
 */

const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/table/coin-heads.webp?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/table/coin-tails.webp?${prefix}-energy`,
    ].join('\n')
  );

const openTable = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer-status="ready"]')).toBeAttached();
};

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1, { timeout: 20_000 });

const setUpBoth = async (page: Page): Promise<void> => {
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

const box = async (locator: Locator) => (await locator.boundingBox())!;

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

/** Every card and zone the table paints, by its box on screen. */
const tableBoxes = (page: Page) =>
  page
    .locator('.ptcgsim-card, .ptcgsim-zone, .table-hand-pill')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            what:
              (node as HTMLElement).dataset.cardId ??
              (node as HTMLElement).dataset.zoneId ??
              node.className,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((rect) => rect.width > 0 && rect.height > 0)
    );

test('the app bar keeps the top-right corner, clear of every card, and the turn sits at the seam', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  const bar = page.locator('.ptcgsim-app-bar');
  await expect(bar).toBeVisible();
  // The deck and where to play, the palette, the log and Settings, the menu.
  await expect(bar.locator('button[id]')).toHaveCount(6);
  expect(
    await bar
      .locator('button[id]')
      .evaluateAll((nodes) => nodes.map((node) => node.id))
  ).toEqual([
    'deckImportButton',
    'p2Button',
    'commandsButton',
    'activityButton',
    'settingsButton',
    'appMenuButton',
  ]);
  const barBox = await box(bar);
  // 8px in from the corner, and no wider than the corner the table keeps.
  expect(Math.round(barBox.y)).toBe(8);
  expect(Math.round(1440 - barBox.x - barBox.width)).toBe(8);
  expect(barBox.width).toBeLessThanOrEqual(242.5);

  await setUpBoth(page);
  for (const rect of await tableBoxes(page)) {
    expect(overlaps(rect, barBox), rect.what).toBe(false);
  }

  // The turn's actions on the seam, past the Stadium, short of the deck.
  const actions = page.locator('#boardButtonContainer');
  await expect(actions).toHaveAttribute('data-align', 'end');
  const turn = await box(page.locator('#boardButtonContainer #turnButton'));
  const stadium = await box(
    page.locator('.ptcgsim-zone[data-zone-kind="stadium"]')
  );
  const deck = await box(
    page.locator('.ptcgsim-zone[data-zone-kind="deck"][data-zone-side="local"]')
  );
  expect(turn.x).toBeGreaterThan(stadium.x + stadium.width);
  const lastButton = await box(
    page.locator('#boardButtonContainer > button').last()
  );
  expect(lastButton.x + lastButton.width).toBeLessThanOrEqual(deck.x);

  // The keys live in the menu now.
  await page.locator('#appMenuButton').click();
  await expect(
    page.locator(
      '[role="menu"][aria-labelledby="appMenuButton"] #shortcutsButton'
    )
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('keeps the palette, the log and the menu in the corner, clear of every card', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTable(page);
    const bar = page.locator('.ptcgsim-app-bar');
    expect(
      await bar
        .locator('button[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id))
    ).toEqual(['commandsButton', 'activityButton', 'appMenuButton']);
    await setUpBoth(page);
    const barBox = await box(bar);
    for (const rect of await tableBoxes(page)) {
      expect(overlaps(rect, barBox), rect.what).toBe(false);
    }
    // The deck and Settings lead the menu.
    await page.locator('#appMenuButton').tap();
    const menu = page.locator('[role="menu"][aria-labelledby="appMenuButton"]');
    await expect(menu.locator('#deckImportButton')).toBeVisible();
    await expect(menu.locator('#settingsButton')).toBeVisible();
  });
});

test('a zone’s hover name is centred, but an empty deck’s sits under its +', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  const label = (zone: Locator) =>
    zone.evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return {
        top: style.top,
        bottom: style.bottom,
        display: style.display,
        alignItems: style.alignItems,
      };
    });
  // A pile and a play spot alike: across the middle.
  for (const kind of ['discard', 'active', 'bench', 'prizes']) {
    const zone = page.locator(
      `.ptcgsim-zone[data-zone-kind="${kind}"][data-zone-side="local"]`
    );
    expect(await label(zone), kind).toMatchObject({
      top: '0px',
      bottom: '0px',
      display: 'flex',
      alignItems: 'center',
    });
  }
  // The empty deck shows its +, so its name sits under it.
  await expect(
    page.locator('[data-load-deck-player][aria-label="Load a deck"]')
  ).toBeVisible();
  const deck = page.locator(
    '.ptcgsim-zone[data-zone-kind="deck"][data-zone-side="local"]'
  );
  expect(await label(deck)).toMatchObject({ bottom: '6px', display: 'block' });
  // Once the seat has cards there is no +, and the name is centred again.
  await setUpBoth(page);
  const discard = page.locator(
    '.ptcgsim-zone[data-zone-kind="discard"][data-zone-side="local"]'
  );
  expect(await label(discard)).toMatchObject({ display: 'flex' });
  await expect(page.locator('.board-spike-host')).not.toHaveAttribute(
    'data-load-deck-sides',
    /./u
  );
});

/** The far player's VSTAR and GX markers, wherever the table keeps them. */
const farMarkers = (page: Page) =>
  page.locator(
    '.legacy-once-per-game-button[data-player-side="opponent"], .table-markers[data-player-side="opponent"] .table-marker'
  );

/** Both markers on the table, showing `show`, from the next page load. */
const showMarkers = (page: Page, show: 'both' | 'theirs') =>
  page.evaluate((choice) => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ show: choice, vstarMarker: true, gxMarker: true })
    );
  }, show);

/** Neither of the far markers under the bar, nor on the far hand. */
const expectFarMarkersClear = async (page: Page, at: string) => {
  const markers = farMarkers(page);
  await expect(markers).toHaveCount(2);
  const barBox = await box(page.locator('.ptcgsim-app-bar'));
  const hand = await box(
    page.locator(
      '.ptcgsim-zone[data-zone-kind="hand"][data-zone-side="opponent"]'
    )
  );
  for (const marker of await markers.all()) {
    const rect = await box(marker);
    expect(overlaps(rect, barBox), `${at}: under the bar`).toBe(false);
    expect(overlaps(rect, hand), `${at}: on the hand`).toBe(false);
  }
};

test('the far player’s markers lie clear of the bar, past it by the hand where the prizes have no room', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // Their half alone, then both halves beside the docked log.
  await showMarkers(page, 'theirs');
  await openTable(page);
  await expectFarMarkersClear(page, 'theirs only');
  await showMarkers(page, 'both');
  await openTable(page);
  const undocked = (await box(page.locator('.ptcgsim-app-bar'))).x;
  await openActivity(page);
  // The table, and its bar, move over beside the log.
  await expect
    .poll(async () => (await box(page.locator('.ptcgsim-app-bar'))).x)
    .toBeLessThan(undocked - 100);
  await expect
    .poll(async () => {
      const first = (await box(page.locator('.ptcgsim-app-bar'))).x;
      await page.waitForTimeout(150);
      return first === (await box(page.locator('.ptcgsim-app-bar'))).x;
    })
    .toBe(true);
  await expectFarMarkersClear(page, 'beside the docked log');
});

test.describe('the far markers on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('lie past the bar, by the far hand', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await showMarkers(page, 'both');
    await openTable(page);
    await expectFarMarkersClear(page, '390x844');
  });
});

test('in Arabic the empty table keeps the bar the same way round', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.language.v1',
      JSON.stringify({ language: 'ar' })
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?room-lobby=1');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible({ timeout: 30_000 });
  // The table is laid out in the world, as the room's is.
  await expect(page.locator('.board-spike-host')).toHaveAttribute('dir', 'ltr');
  const bar = page.locator('.ptcgsim-app-bar');
  await expect(bar).toBeVisible();
  const buttons = await bar.locator('button[id]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.id,
      x: node.getBoundingClientRect().x,
    }))
  );
  // Left to right as in English, the menu at the end.
  expect(buttons.at(-1)?.id).toBe('appMenuButton');
  const xs = buttons.map((button) => button.x);
  expect(xs).toEqual([...xs].sort((left, right) => left - right));
  // Each group's hairline at its start, in the gap before it.
  const lines = await bar
    .locator('.ptcgsim-app-bar__group + .ptcgsim-app-bar__group')
    .evaluateAll((groups) =>
      groups.map((group) => {
        const line = getComputedStyle(group, '::before');
        return { left: line.left, right: line.right };
      })
    );
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line.left).toBe('-2.5px');
});
