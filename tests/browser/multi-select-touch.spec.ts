import {
  devices,
  expect,
  test,
  type CDPSession,
  type Page,
} from '@playwright/test';

import {
  card,
  clearNotices,
  idle,
  nextRevision,
  openNamedSolo,
  revision,
  selection,
  zoneBox,
  zoneCardIds,
  zoneCount,
} from './support/multi-select.js';

/**
 * Several cards by touch (ADR-042 §2): Select on a card's bar turns the
 * selection mode on, a tap then takes a card in or out, the group's bar
 * moves them all (Move…) and stays on the screen, a long press on a
 * selected card opens the group's menu, a finger drawing on the felt starts
 * the mode, a crowded hand's peek picks the card it raised, and a pile's
 * viewer ticks its cards, counts the copies a stacked tile gave ("2/5")
 * and selects them all.
 */

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

interface Point {
  readonly x: number;
  readonly y: number;
}

const SIZES = [
  { name: 'a phone held upright', width: 390, height: 844 },
  { name: 'a phone on its side', width: 844, height: 390 },
  { name: 'a tablet', width: 820, height: 1180 },
] as const;

/**
 * A finger's tap on a card where it shows: its left strip, which a hand's
 * next card leaves uncovered.
 */
const tapCard = async (page: Page, cardId: string) => {
  const box = (await card(page, cardId).boundingBox())!;
  await page.touchscreen.tap(
    box.x + Math.min(8, box.width / 4),
    box.y + box.height / 2
  );
};

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  at?: Point
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: at ? [{ x: at.x, y: at.y }] : [],
  });

const groupBar = (page: Page) => page.locator('[data-touch-group-bar]');

/** The bar lies wholly on the screen. */
const expectOnScreen = async (
  page: Page,
  box: { x: number; y: number; width: number; height: number } | null,
  size: { width: number; height: number }
) => {
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5);
  void page;
};

/** Select on the bar of the card tapped: the selection mode, with it. */
const startSelecting = async (page: Page, cardId: string) => {
  await tapCard(page, cardId);
  await page.locator('#touchSelectCardButton').tap();
  await expect(groupBar(page)).toBeVisible();
};

for (const size of SIZES)
  test.describe(size.name, () => {
    test.use({
      ...phone,
      viewport: { width: size.width, height: size.height },
    });

    test('Select on the bar, taps add, and Move… puts the group in the Lost Zone, its bar on the screen', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page, size);
      const hand = await zoneCardIds(page, 'local', 'hand');
      await startSelecting(page, hand[0]!);
      await tapCard(page, hand[2]!);
      await tapCard(page, hand[4]!);
      await expect
        .poll(async () => (await selection(page)).sort())
        .toEqual([hand[0]!, hand[2]!, hand[4]!].sort());
      await expect(page.locator('[data-touch-group-count]')).toHaveText('3');
      await expectOnScreen(page, await groupBar(page).boundingBox(), size);
      const before = await revision(page);
      await page.locator('#touchGroupMoveButton').tap();
      const menu = page.locator('[data-group-menu]');
      await expect(menu).toBeVisible();
      await expectOnScreen(page, await menu.boundingBox(), size);
      await menu.locator('[data-group-entry="send:lostZone"]').tap();
      await nextRevision(page, before);
      await idle(page);
      expect(await zoneCount(page, 'local', 'lostZone')).toBe(3);
      await expect(groupBar(page)).toHaveCount(0);
    });
  });

/** Thirty copies of one card, and thirty cards of their own. */
const TWINS_DECK = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Twin Energy,Energy,/v2/assets/table/coin-tails.webp?twin',
    ...Array.from(
      { length: 30 },
      (_, index) =>
        `1,Mon ${String(index + 1).padStart(2, '0')},Pokémon,/v2/assets/table/coin-heads.webp?mon-${String(index + 1)}`
    ),
  ].join('\n')
);

/** A hand's card under a finger: the left strip its neighbour leaves. */
const stripOf = async (page: Page, cardId: string): Promise<Point> => {
  const box = (await card(page, cardId).boundingBox())!;
  return {
    x: box.x + Math.min(6, box.width / 4),
    y: box.y + box.height * 0.6,
  };
};

test.describe('a phone, more', () => {
  test.use({ ...phone, viewport: { width: 390, height: 844 } });

  test('on a crowded hand, a peek let go in the selection mode takes the card it raised, and a second tap reads nothing', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await openNamedSolo(page, { width: 390, height: 844 });
    // Twenty cards in hand: each shows a sliver.
    for (const draw of ['9', '4']) {
      const before = await revision(page);
      await page.keyboard.press(draw);
      await nextRevision(page, before);
    }
    await idle(page);
    const hand = await zoneCardIds(page, 'local', 'hand');
    expect(hand).toHaveLength(20);
    await startSelecting(page, hand[0]!);
    // Pressed on the sixth, slid to the ninth, let go: the ninth joins.
    const cdp = await page.context().newCDPSession(page);
    const from = await stripOf(page, hand[5]!);
    const to = await stripOf(page, hand[8]!);
    await touch(cdp, 'touchStart', from);
    // A finger rests a moment before it slides.
    await page.waitForTimeout(100);
    for (let step = 1; step <= 10; step += 1)
      await touch(cdp, 'touchMove', {
        x: from.x + ((to.x - from.x) * step) / 10,
        y: from.y,
      });
    await touch(cdp, 'touchEnd');
    await expect
      .poll(async () => (await selection(page)).sort())
      .toEqual([hand[0]!, hand[8]!].sort());
    // A second tap takes it out again, and opens no preview.
    await page.waitForTimeout(300);
    const again = await stripOf(page, hand[8]!);
    await touch(cdp, 'touchStart', again);
    await page.waitForTimeout(80);
    await touch(cdp, 'touchEnd');
    await expect.poll(() => selection(page)).toEqual([hand[0]!]);
    await expect(page.locator('[data-preview-kind]')).toHaveCount(0);
  });

  test('a long press on a selected card opens the group menu', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openNamedSolo(page, { width: 390, height: 844 });
    const hand = await zoneCardIds(page, 'local', 'hand');
    await startSelecting(page, hand[0]!);
    await tapCard(page, hand[3]!);
    await expect.poll(async () => (await selection(page)).length).toBe(2);
    const cdp = await page.context().newCDPSession(page);
    const at = await stripOf(page, hand[3]!);
    await touch(cdp, 'touchStart', at);
    // Held still, a phone's browser says so with a context menu event.
    await page.waitForTimeout(600);
    await card(page, hand[3]!).dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
    });
    await touch(cdp, 'touchEnd');
    const menu = page.locator('[data-group-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-group-menu-header]')).toContainText('2');
  });

  test('a finger drawing on the felt takes the cards it crosses and starts the selection mode', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openNamedSolo(page, { width: 390, height: 844 });
    await clearNotices(page);
    const prizes = await zoneCardIds(page, 'local', 'prizes');
    expect(prizes.length).toBeGreaterThan(0);
    const box = await zoneBox(page, 'local', 'prizes');
    const cdp = await page.context().newCDPSession(page);
    const from = { x: box.x + box.width + 6, y: box.y - 6 };
    const to = { x: box.x + 4, y: box.y + box.height - 4 };
    await touch(cdp, 'touchStart', from);
    for (let step = 1; step <= 12; step += 1)
      await touch(cdp, 'touchMove', {
        x: from.x + ((to.x - from.x) * step) / 12,
        y: from.y + ((to.y - from.y) * step) / 12,
      });
    await touch(cdp, 'touchEnd');
    await expect
      .poll(async () => (await selection(page)).sort())
      .toEqual([...prizes].sort());
    await expect(groupBar(page)).toBeVisible();
    await expect(page.locator('[data-touch-group-count]')).toHaveText(
      String(prizes.length)
    );
  });

  test("a pile's viewer ticks its cards, gives a stacked tile's copies one by one, and selects them all", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await openNamedSolo(page, { width: 390, height: 844, deck: TWINS_DECK });
    await clearNotices(page);
    const hand = await zoneCardIds(page, 'local', 'hand');
    await startSelecting(page, hand[0]!);
    // The deck, open in its viewer, copies stacked. Upright, the group's
    // bar lies over the deck's left side: it is tapped on its right.
    const cover = await page.evaluate(
      () =>
        window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
          (candidate) =>
            candidate.side === 'local' &&
            candidate.parentId.endsWith(':deck') &&
            candidate.renderKey !== null
        )!.id
    );
    const deckBox = (await card(page, cover).boundingBox())!;
    await page.touchscreen.tap(
      deckBox.x + deckBox.width * 0.85,
      deckBox.y + deckBox.height * 0.3
    );
    const viewer = page.locator('[data-legacy-zone-browser]');
    await expect(viewer).toBeVisible();
    const stack = viewer.locator('[data-zone-action="stackCopies"]');
    if ((await stack.getAttribute('aria-pressed')) !== 'true')
      await stack.tap();
    const twins = viewer.locator('[data-copy-stack]').first();
    await expect(twins).toBeVisible();
    const copies = Number(await twins.getAttribute('data-copy-stack'));
    expect(copies).toBeGreaterThan(2);
    await twins.tap();
    await expect(twins.locator('[data-zone-select-badge]')).toHaveText(
      `1/${String(copies)}`
    );
    await twins.tap();
    await expect(twins.locator('[data-zone-select-badge]')).toHaveText(
      `2/${String(copies)}`
    );
    // Select all: every card of the pile, and Move N… for them.
    const all = viewer.locator('[data-card-action="select-all"]');
    await all.tap();
    await expect(all).toHaveText('Deselect all');
    const deck = await zoneCount(page, 'local', 'deck');
    await expect(
      viewer.locator('[data-card-actions-group] [data-selected-count]')
    ).toHaveAttribute('data-selected-count', String(deck + 1));
    await expect(
      viewer.locator('[data-card-action="move-group"]')
    ).toBeVisible();
  });
});
