import {
  devices,
  expect,
  test,
  type CDPSession,
  type Page,
} from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';

/**
 * A finger on a crowded hand peeks at its cards (ADR-030 §9): the card it
 * presses rises into view, sliding along the hand raises each card under
 * the finger in turn, moving toward the table picks the raised card up, and
 * letting go taps it. A phone's twenty-card hand shows a few pixels of each
 * card; this is how a player finds and plays one.
 */

test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

interface Point {
  readonly x: number;
  readonly y: number;
}

const openSoloTable = async (
  page: Page,
  view: 'table' | 'flat' | 'auto'
): Promise<void> => {
  if (view !== 'auto')
    await page.addInitScript((mode) => {
      localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify({ mode }));
    }, view);
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

const handCount = (page: Page) =>
  page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'hand'
      )?.count ?? 0
  );

/** A random deck on the near seat, set up, and a hand of `size`. */
const dealBigHand = async (page: Page, size = 20): Promise<void> => {
  const plus = page.locator(
    '[data-load-deck-player][aria-label="Load a deck"]'
  );
  await plus.first().tap();
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
  await page.locator('#setupButton').tap();
  await expect.poll(() => handCount(page)).toBe(7);
  await idle(page);
  // The digit keys draw that many cards.
  for (let count = 7; count < size;) {
    const draw = Math.min(9, size - count);
    await page.keyboard.press(String(draw));
    count += draw;
    await expect.poll(() => handCount(page)).toBe(count);
  }
  await idle(page);
};

/** The near hand's cards left to right, where each is drawn. */
const handCards = (page: Page) =>
  page
    .locator('.ptcgsim-card[data-in-hand][data-card-side="local"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            id: node.getAttribute('data-card-id')!,
            label: node.getAttribute('aria-label')!,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          };
        })
        .sort((a, b) => a.x - b.x)
    );

const peeked = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-peek]')].map(
      (node) => node.dataset.cardId
    )
  );

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  at?: Point
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: at ? [{ x: at.x, y: at.y }] : [],
  });

/** Moves a finger already down from `from` to `to` in small steps. */
const slide = async (
  page: Page,
  cdp: CDPSession,
  from: Point,
  to: Point,
  steps: number,
  each?: () => Promise<void>
): Promise<void> => {
  for (let index = 1; index <= steps; index += 1) {
    await touch(cdp, 'touchMove', {
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
    });
    await page.waitForTimeout(16);
    await each?.();
  }
};

/** Less than half of each of the hand's cards shows. */
const crowded = async (page: Page): Promise<boolean> => {
  const cards = await handCards(page);
  const step = (cards.at(-1)!.x - cards[0]!.x) / Math.max(1, cards.length - 1);
  return step < Math.min(...cards.map((card) => card.width)) / 2;
};

/**
 * Slides along the hand from its first card to its last but one, checking
 * the raised card follows the finger, then plays the raised card onto the
 * staging area and taps another by letting go.
 */
const peekAndPlay = async (page: Page, size = 20): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  const cards = await handCards(page);
  expect(cards).toHaveLength(size);
  expect(await crowded(page)).toBe(true);
  const viewport = page.viewportSize()!;
  // The finger stays in the part of the hand that shows on screen.
  const fingerY = Math.min(
    cards[0]!.y + Math.min(cards[0]!.height * 0.4, 40),
    viewport.height - 6
  );
  const start = { x: cards[0]!.x + 3, y: fingerY };
  const end = { x: cards.at(-2)!.x + 3, y: fingerY };
  await touch(cdp, 'touchStart', start);
  await expect.poll(() => peeked(page)).toEqual([cards[0]!.id]);
  // The raised card is whole, clear of the finger and above its
  // neighbours.
  const raised = page.locator('[data-peek] > .ptcgsim-card__body');
  await expect
    .poll(async () => {
      const box = (await raised.boundingBox())!;
      return box.y + box.height <= fingerY;
    })
    .toBe(true);
  const seen: string[] = [];
  await slide(page, cdp, start, end, 24, async () => {
    const now = (await peeked(page))[0];
    if (now && seen.at(-1) !== now) seen.push(now);
  });
  // Each card rose in turn, left to right, and nothing was dragged.
  expect(seen.length).toBeGreaterThanOrEqual(10);
  const order = cards.map((card) => card.id);
  expect([...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(
    seen
  );
  await expect(page.locator('.ptcgsim-card[data-held="drag"]')).toHaveCount(0);
  const picked = cards.find((card) => card.id === seen.at(-1))!;

  // Toward the table: the raised card is picked up and played onto the
  // staging area beside the Active.
  const board = await page.evaluate(() => {
    const zone = window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
      (candidate) => candidate.side === 'local' && candidate.kind === 'board'
    )!;
    return { id: zone.id };
  });
  const aim = await stagingAim(page, board.id);
  // The finger rests on the card it found, lifts it toward the table and
  // carries it there.
  await page.waitForTimeout(200);
  const lifted = { x: end.x, y: end.y - 40 };
  await slide(page, cdp, end, lifted, 5);
  await expect(page.locator('.ptcgsim-card[data-held="drag"]')).toHaveAttribute(
    'data-card-id',
    picked.id
  );
  await slide(page, cdp, lifted, aim, 14);
  await touch(cdp, 'touchEnd');
  await idle(page);
  await expect.poll(() => handCount(page)).toBe(size - 1);
  await expect
    .poll(() =>
      page.evaluate(
        (zoneId) =>
          window
            .__PTCG_RENDERER_SPIKE__!.scene.cards.filter(
              (card) => card.parentId === zoneId
            )
            .map((card) => card.label),
        board.id
      )
    )
    .toContain(picked.label);
  expect(await peeked(page)).toEqual([]);

  // Let go of in the hand, the card raised is tapped: it is selected and
  // offers Read and Actions.
  const after = await handCards(page);
  const from = { x: after[1]!.x + 3, y: fingerY };
  const to = { x: after[8]!.x + 3, y: fingerY };
  await touch(cdp, 'touchStart', from);
  const tapped: string[] = [];
  await slide(page, cdp, from, to, 10, async () => {
    const now = (await peeked(page))[0];
    if (now) tapped.push(now);
  });
  await touch(cdp, 'touchEnd');
  const chosen = tapped.at(-1)!;
  expect(chosen).not.toBe(after[1]!.id);
  await expect(
    page.locator(`.ptcgsim-card[data-card-id="${chosen}"]`)
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-touch-card-bar]')).toBeVisible();
  expect(await peeked(page)).toEqual([]);
};

/**
 * Where on screen to aim for the staging area: its centre as the table
 * draws it (through the tilt, when tilted).
 */
const stagingAim = (page: Page, zoneId: string): Promise<Point> =>
  page.evaluate((id) => {
    const box = document
      .querySelector<HTMLElement>(`[data-zone-id="${CSS.escape(id)}"]`)!
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, zoneId);

test.describe('an upright phone', () => {
  test.use(phone);

  for (const view of ['table', 'flat'] as const) {
    test(`peeks at, plays and taps cards of a big hand (${view})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openSoloTable(page, view);
      await dealBigHand(page);
      await peekAndPlay(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('a phone on its side', () => {
  test.use({ ...phone, viewport: { width: 844, height: 390 } });

  // Its wide hand shows half of each of twenty cards: thirty crowd it.
  test('peeks at, plays and taps cards of a big hand', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openSoloTable(page, 'auto');
    await dealBigHand(page, 30);
    await peekAndPlay(page, 30);
    expect(errors).toEqual([]);
  });
});

test.describe('a tablet', () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('peeks at, plays and taps cards of a big hand', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openSoloTable(page, 'auto');
    await dealBigHand(page);
    await peekAndPlay(page);
    expect(errors).toEqual([]);
  });
});
