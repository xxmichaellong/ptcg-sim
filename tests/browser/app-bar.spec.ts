import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  openActivity,
  openDeck,
} from './support/table-shell.js';
import { ownRoomBudget } from './support/room-budget.js';

// Each test opens the table (twice in development's StrictMode): its own
// room budget, whatever ran before it (support/room-budget.ts).
test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

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

test('the turn stays past the Stadium beside the docked log, the coin lying on the table', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openTable(page);
  await setUpBoth(page);
  await openActivity(page);
  // Once the table has moved over beside the log.
  await expect
    .poll(async () => {
      const first = (await box(page.locator('.ptcgsim-app-bar'))).x;
      await page.waitForTimeout(150);
      const settled = (await box(page.locator('.ptcgsim-app-bar'))).x;
      return first === settled && settled < 1920 - 300;
    })
    .toBe(true);
  await expect(
    page.locator('#boardButtonContainer #flipCoinButton')
  ).toHaveCount(0);
  await expect(page.locator('#boardButtonContainer')).toHaveAttribute(
    'data-align',
    'end'
  );
  const turn = await box(page.locator('#boardButtonContainer #turnButton'));
  const stadium = await box(
    page.locator('.ptcgsim-zone[data-zone-kind="stadium"]')
  );
  expect(turn.x).toBeGreaterThan(stadium.x + stadium.width);
});

test('a toolbar button a click left focused hands the arrow keys on to the table', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);
  const focused = () => page.evaluate(() => document.activeElement?.id ?? '');
  // Clicked, the Log button keeps the focus (Chrome), but not the arrows.
  await page.locator('#activityButton').click();
  expect(await focused()).toBe('activityButton');
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('activityButton');
  // Reached by the keyboard, the arrows move along the bar.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('activityButton');
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('settingsButton');
});

test('the bar shows which button the keyboard is on by day as by night', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'ptcgsim.table.v1',
      JSON.stringify({ darkMode: false })
    )
  );
  await openTable(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.locator('#activityButton').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  // The bar's glass is dark in either theme: its ring is in the bar's own
  // light ink, not the day's navy accent.
  const ring = await page.locator('#activityButton').evaluate((button) => {
    const style = getComputedStyle(button);
    // The colour as painted, whatever space the style writes it in.
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = style.outlineColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return {
      width: style.outlineWidth,
      light: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
    };
  });
  expect(ring.width).toBe('2px');
  expect(ring.light).toBeGreaterThan(0.8);
});

test('the log, opened over the table on a tablet, leaves the bar in reach', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 768 });
  await openTable(page);
  await openActivity(page);
  const drawer = page.locator('.ptcgsim-sheet[data-variant="side"]');
  await expect(drawer).toBeVisible();
  // Settled where it slides to.
  await expect
    .poll(async () => {
      const first = (await box(drawer)).x;
      await page.waitForTimeout(150);
      return first === (await box(drawer)).x;
    })
    .toBe(true);
  const bar = await box(page.locator('.ptcgsim-app-bar'));
  expect(overlaps(bar, await box(drawer))).toBe(false);
  // The Log button that opened it closes it again.
  await page.locator('#activityButton').click();
  await expect(drawer).toHaveCount(0);
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

  for (const [width, height] of [
    [360, 760],
    [375, 667],
  ] as const) {
    test(`the welcome card leaves the bar clear at ${String(width)}x${String(height)}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(
        page.locator(
          '[data-app-route="remote-room"][data-session-phase="ready"]'
        )
      ).toBeVisible({ timeout: 30_000 });
      const welcome = page.locator('.table-welcome');
      await expect(welcome).toBeVisible();
      expect(
        overlaps(
          await box(welcome),
          await box(page.locator('.ptcgsim-app-bar'))
        )
      ).toBe(false);
      // The menu answers its own button, not the card's close.
      await page.locator('#appMenuButton').tap();
      await expect(
        page.locator('[role="menu"][aria-labelledby="appMenuButton"]')
      ).toBeVisible();
    });
  }
});

test('the welcome card moves clear of the bar when the log docks beside the table', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  const welcome = page.locator('.table-welcome');
  await expect(welcome).toBeVisible();
  // Arrived and still: its size settles before the log comes.
  await expect.poll(async () => (await box(welcome)).width).toBe(420);
  await page.waitForTimeout(300);
  await openActivity(page);
  // Once the log has slid in, the card and the bar are apart.
  await expect
    .poll(async () =>
      overlaps(await box(welcome), await box(page.locator('.ptcgsim-app-bar')))
    )
    .toBe(false);
  await page.waitForTimeout(600);
  expect(
    overlaps(await box(welcome), await box(page.locator('.ptcgsim-app-bar')))
  ).toBe(false);
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
        left: style.left,
        right: style.right,
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
  // Under it, and clear of the count badge in the pile's corner.
  expect(await label(deck)).toMatchObject({
    bottom: '6px',
    left: '16px',
    right: '16px',
    display: 'block',
  });
  // The far deck's badge is at its top: its name keeps the pile's width.
  await expect(page.locator('.board-spike-host')).toHaveAttribute(
    'data-load-deck-sides',
    /\bopponent\b/u
  );
  expect(
    await label(
      page.locator(
        '.ptcgsim-zone[data-zone-kind="deck"][data-zone-side="opponent"]'
      )
    )
  ).toMatchObject({
    bottom: '6px',
    left: '2px',
    right: '2px',
    display: 'block',
  });
  // The empty Lost Zone, shown: its hide chip takes its top corner, and
  // its name starts below it.
  await page.evaluate(() =>
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ lostZone: true })
    )
  );
  await openTable(page);
  await expect(page.locator('#hideLostZoneButton')).toBeVisible();
  expect(
    await label(
      page.locator(
        '.ptcgsim-zone[data-zone-kind="lostZone"][data-zone-side="local"]'
      )
    )
  ).toMatchObject({ top: '30px' });
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
const showMarkers = (page: Page, show: 'both' | 'theirs', split?: number) =>
  page.evaluate(
    ([choice, lowerShare]) => {
      localStorage.setItem(
        'ptcgsim.board-view.v1',
        JSON.stringify({
          show: choice,
          vstarMarker: true,
          gxMarker: true,
          ...(lowerShare === undefined ? {} : { split: lowerShare }),
        })
      );
    },
    [show, split] as const
  );

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

test('the rail keeps clear of the cards when one half shows on the tilted table', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ show: 'mine' })
    );
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'table' })
    );
  });
  await openTable(page);
  await idle(page);
  const zones = await page
    .locator(
      '.ptcgsim-zone[data-zone-side="local"]:is([data-zone-kind="active"], [data-zone-kind="prizes"])'
    )
    .all();
  expect(zones.length).toBeGreaterThan(0);
  for (const button of await page
    .locator('#boardButtonContainer button')
    .all()) {
    if (!(await button.isVisible())) continue;
    const rail = await box(button);
    for (const zone of zones) {
      const kind = await zone.getAttribute('data-zone-kind');
      expect(
        overlaps(rail, await box(zone)),
        `${String(await button.getAttribute('id'))} on the ${String(kind)}`
      ).toBe(false);
    }
  }
});

/** The far hand keeps room to hold its cards apart; markers on none of it. */
const expectFarHandRoomy = async (page: Page) => {
  const hand = await box(
    page.locator(
      '.ptcgsim-zone[data-zone-kind="hand"][data-zone-side="opponent"]'
    )
  );
  expect(hand.width).toBeGreaterThanOrEqual(128);
  const zones = await page
    .locator('.ptcgsim-zone[data-zone-side="opponent"]')
    .all();
  for (const marker of await farMarkers(page).all()) {
    const rect = await box(marker);
    for (const zone of zones) {
      expect(overlaps(rect, await box(zone))).toBe(false);
    }
  }
};

test.describe('the far markers on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('lie past the bar, by the far hand', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await showMarkers(page, 'both');
    await openTable(page);
    await expectFarMarkersClear(page, '390x844');
    await expectFarHandRoomy(page);
    await page.screenshot({
      path: test.info().outputPath('far-markers-390x844.png'),
    });
  });

  test('leave the far hand its room on a short phone, the table split toward the near half', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto('/');
    await showMarkers(page, 'both', 0.6);
    await openTable(page);
    await expectFarMarkersClear(page, '390x667 split 0.6');
    await expectFarHandRoomy(page);
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
