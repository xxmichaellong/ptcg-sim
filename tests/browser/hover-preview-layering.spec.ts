import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  closeActivity,
  closeSheet,
  openActivity,
  openDeck,
  openSettings,
} from './support/table-shell.js';

const setUp = async (page: Page, rtl = false) => {
  await ownRoomBudget(page.context());
  await page.addInitScript((rtl) => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ hoverPreview: true })
    );
    if (rtl)
      localStorage.setItem(
        'ptcgsim.language.v1',
        JSON.stringify({ language: 'ar' })
      );
  }, rtl);
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'hover.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'QTY,Name,Type,URL\n60,Hover Pokémon,Pokémon,/v2/assets/cardback.png?hover'
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(page.locator('#setupButton')).toBeVisible();
  await page.locator('#setupButton').click();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );
  await expect(
    page.locator('[data-in-hand][data-card-side="local"]')
  ).toHaveCount(7);
};

/** Ask the browser what paints above the drawer without leaving the preview interactive. */
const paint = (page: Page, drawer: string) =>
  page.evaluate((selector) => {
    const inspector = document.querySelector<HTMLElement>(
      '[data-card-inspector]'
    )!;
    const card = inspector.querySelector('.card-inspector__card')!;
    const panel = document.querySelector(selector)!;
    const a = card.getBoundingClientRect(),
      b = panel.getBoundingClientRect();
    const left = Math.max(a.left, b.left),
      right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top),
      bottom = Math.min(a.bottom, b.bottom);
    if (left >= right || top >= bottom)
      return { overlap: false, previewAbove: false, inputReachesDrawer: false };
    const x = (left + right) / 2,
      y = (top + bottom) / 2;
    const inputReachesDrawer = panel.contains(document.elementFromPoint(x, y));
    const previous = inspector.style.pointerEvents;
    inspector.style.pointerEvents = 'auto';
    const stack = document.elementsFromPoint(x, y);
    const previewIndex = stack.findIndex((node) => inspector.contains(node));
    const drawerIndex = stack.findIndex((node) => panel.contains(node));
    inspector.style.pointerEvents = previous;
    return {
      overlap: true,
      previewAbove:
        previewIndex >= 0 && drawerIndex >= 0 && previewIndex < drawerIndex,
      inputReachesDrawer,
    };
  }, drawer);

const hover = async (page: Page, last = false) => {
  const cards = page.locator('[data-in-hand][data-card-side="local"]');
  // The first card is read where it shows: a hand fanned into a narrow
  // strip (a docked log) lays the next card over the first one's middle.
  if (last) await cards.last().hover();
  else {
    const box = await cards.first().boundingBox();
    await cards
      .first()
      .hover({ position: { x: 8, y: (box?.height ?? 80) / 2 } });
  }
  const inspector = page.locator('[data-card-inspector][data-open="true"]');
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveCSS('opacity', '1');
  return inspector;
};

for (const panel of ['settings', 'chat'] as const)
  test(`hover reading stays above the desktop ${panel} drawer without blocking it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setUp(page);
    if (panel === 'settings') await openSettings(page);
    else await openActivity(page);
    await hover(page);
    expect(
      await paint(page, panel === 'settings' ? '#settings' : '#activitySheet')
    ).toEqual({ overlap: true, previewAbove: true, inputReachesDrawer: true });
    await page.screenshot({ path: `/tmp/ptcg-hover-${panel}-desktop.png` });
    if (panel === 'settings') await closeSheet(page);
    else await closeActivity(page);
    await page.mouse.move(5, 5);
    await expect(page.locator('[data-card-inspector]')).toHaveAttribute(
      'data-open',
      'false'
    );
  });

test('hover reading stays above the nonmodal chat sheet on a smaller window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await setUp(page);
  await openActivity(page);
  await expect(page.locator('#activitySheet')).toHaveAttribute(
    'data-variant',
    'side'
  );
  await hover(page);
  expect(await paint(page, '#activitySheet')).toEqual({
    overlap: true,
    previewAbove: true,
    inputReachesDrawer: true,
  });
  await page.screenshot({ path: '/tmp/ptcg-hover-chat-sheet.png' });
  await closeActivity(page);
});

test('a hover card stays inside the window beside an Arabic drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page, true);
  await openSettings(page);
  const inspector = await hover(page);
  const card = await inspector.locator('.card-inspector__card').boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(1440);
  expect(card!.y).toBeGreaterThanOrEqual(0);
  expect(card!.y + card!.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: '/tmp/ptcg-hover-settings-rtl.png' });
  await closeSheet(page);
});

test('opening a card menu immediately yields the hover preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page);
  await hover(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-legacy-card-context-menu]')) return;
      (window as unknown as { inspectorAtMenu: boolean }).inspectorAtMenu =
        document
          .querySelector('[data-card-inspector]')
          ?.getAttribute('data-open') === 'true';
      observer.disconnect();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
  await page
    .locator('[data-in-hand][data-card-side="local"]')
    .first()
    .click({ button: 'right' });
  await expect(page.locator('[data-legacy-card-context-menu]')).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { inspectorAtMenu: boolean }).inspectorAtMenu
    )
  ).toBe(false);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await expect(page.locator('[data-card-inspector]')).toHaveAttribute(
    'data-open',
    'false'
  );
});

test('hover reading follows drawer breakpoint changes without clipping or stale previews', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page);
  for (const width of [1440, 1024, 1025, 1000]) {
    await page.setViewportSize({ width, height: 800 });
    await openActivity(page);
    const inspector = await hover(page);
    const card = await inspector.locator('.card-inspector__card').boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(width);
    expect(await paint(page, '#activitySheet')).toEqual({
      overlap: true,
      previewAbove: true,
      inputReachesDrawer: true,
    });
    await closeActivity(page);
    await page.mouse.move(5, 5);
    await expect(inspector).toHaveCount(0);
  }
});

test('the deck screen takes over from a hovered card immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page);
  await hover(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.ptcgsim-deck-layer[data-open="true"]'))
        return;
      (window as unknown as { inspectorAtDeck: boolean }).inspectorAtDeck =
        document
          .querySelector('[data-card-inspector]')
          ?.getAttribute('data-open') === 'true';
      observer.disconnect();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
  await openDeck(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { inspectorAtDeck: boolean }).inspectorAtDeck
    )
  ).toBe(false);
});

test('hover reading never covers the pointer on a card beside an Arabic dock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page, true);
  await page.evaluate(() =>
    window.addEventListener('pointermove', (event) => {
      (
        window as unknown as { hoverPointer: { x: number; y: number } }
      ).hoverPointer = { x: event.clientX, y: event.clientY };
    })
  );
  await openSettings(page);
  for (const width of [1440, 1025]) {
    await page.setViewportSize({ width, height: 900 });
    const cards = page.locator('[data-in-hand][data-card-side="local"]');
    for (const card of await cards.all()) {
      await card.hover();
      await expect(
        page.locator('[data-card-inspector][data-open="true"]')
      ).toHaveCSS('opacity', '1');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const p = (
              window as unknown as { hoverPointer: { x: number; y: number } }
            ).hoverPointer;
            const r = document
              .querySelector('.card-inspector__card')!
              .getBoundingClientRect();
            return (
              p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom
            );
          })
        )
        .toBe(true);
    }
  }
});

for (const width of [1000, 820])
  test(`notifications do not cover hover reading at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await setUp(page);
    // A real, persistent notice makes this paint check independent of the
    // setup confirmation's expiry or a slow CI machine.
    await page.evaluate(async () => {
      const modulePath = '/src/ui/toast.ts';
      const { toast } = (await import(modulePath)) as {
        toast: (options: {
          id: string;
          title: string;
          timeout: number;
        }) => string;
      };
      toast({
        id: 'hover-reading-notice',
        title: 'Reading notification',
        timeout: 0,
      });
    });
    const notice = page
      .locator('.ptcgsim-ui-toast')
      .filter({ hasText: 'Reading notification' });
    await expect(notice).toBeVisible();
    await notice.evaluate((node) =>
      node.setAttribute('data-hover-reading-notice', '')
    );
    const inspector = await hover(page);
    expect(
      await paint(page, '.ptcgsim-ui-toast[data-hover-reading-notice]')
    ).toEqual({
      overlap: true,
      previewAbove: true,
      inputReachesDrawer: true,
    });
    await page.screenshot({ path: `/tmp/ptcg-hover-toast-${width}.png` });
    const readingLayer = await inspector.evaluate((node) =>
      Number(getComputedStyle(node).zIndex)
    );
    await page.mouse.move(5, 5);
    await expect(page.locator('[data-card-inspector]')).toHaveAttribute(
      'data-open',
      'false'
    );
    await expect
      .poll(() =>
        page
          .locator('.ptcgsim-ui-toast-viewport')
          .evaluate((node) => Number(getComputedStyle(node).zIndex))
      )
      .toBeGreaterThan(readingLayer);
    await notice.locator('.ptcgsim-ui-toast__close').click();
    await expect(notice).toHaveCount(0);
  });
