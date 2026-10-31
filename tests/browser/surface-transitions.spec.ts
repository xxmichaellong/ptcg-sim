import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  on,
  watchAnimations,
  type StartedAnimation,
} from './support/surface-animations.js';
import { closeDeck, openDeck, openSettings } from './support/table-shell.js';

/**
 * Every window, sheet, menu and popup comes and goes with a transition,
 * every time (ADR-027, decision 7): it fades in as it appears and out as
 * it leaves -- the board's windows through an inert copy of their last
 * frame -- and steps aside for a drag with a fade rather than vanishing
 * and popping back. Reduced motion keeps a brief fade.
 */

test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

interface SceneZone {
  readonly id: string;
  readonly kind: string;
  readonly side: string;
  readonly count: number;
}

const zone = (page: Page, kind: string) =>
  page.evaluate(
    (wanted) =>
      (
        window as unknown as {
          readonly __PTCG_RENDERER_SPIKE__: {
            readonly scene: { readonly zones: readonly SceneZone[] };
          };
        }
      ).__PTCG_RENDERER_SPIKE__.scene.zones.find(
        (entry) => entry.kind === wanted && entry.side === 'local'
      )!,
    kind
  );

const openRoom = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
};

/** A Solo table set up with a deck of plain Pokémon and Energy. */
const openSoloTable = async (page: Page): Promise<void> => {
  await openRoom(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        ...Array.from(
          { length: 50 },
          (_, index) =>
            `1,Mon ${String(index)},Pokémon,/v2/assets/cardback.png?mon-${String(index)}`
        ),
        ...Array.from(
          { length: 10 },
          (_, index) =>
            `1,Spark ${String(index)},Energy,/v2/assets/cardback.png?spark-${String(index)}`
        ),
      ].join('\n')
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await page.locator('#setupButton').click();
  await expect
    .poll(async () => (await zone(page, 'hand')).count, { timeout: 15_000 })
    .toBe(7);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle',
    { timeout: 15_000 }
  );
};

/** A fade: an opacity transition, or a keyframes animation of one. */
const fades = (
  animations: readonly StartedAnimation[],
  names: readonly string[] = []
): StartedAnimation[] =>
  animations.filter(
    (animation) =>
      (animation.type === 'CSSTransition' && animation.name === 'opacity') ||
      names.includes(animation.name)
  );

/** No exit copy is left once every exit has played. */
const nothingLeftBehind = (page: Page) =>
  expect(
    page.locator(
      '.is-leaving, .ptcgsim-overlay-ghost, [inert][aria-hidden="true"]:not([data-open])'
    )
  ).toHaveCount(0);

test("the pile viewer fades out of a drag's way and back in once the card lands, and out when closed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSoloTable(page);
  const animations = await watchAnimations(page);

  const deck = await zone(page, 'deck');
  await page.locator(`[data-zone-id="${deck.id}"]`).focus();
  await page.keyboard.press('Enter');
  const viewer = page.locator('[data-legacy-zone-browser]');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveCSS('opacity', '1');
  const opened = on(await animations.take(), 'ptcgsim-legacy-zone-browser');
  expect(
    fades(opened, ['ptcgsim-overlay-fade-in']).some(
      (animation) => animation.duration >= 150
    )
  ).toBe(true);

  // Carried out of it to the bench: it fades out of the way...
  const bench = await zone(page, 'bench');
  const from = (await viewer
    .locator('.ptcgsim-zone-card')
    .first()
    .boundingBox())!;
  const to = (await page
    .locator(`[data-zone-id="${bench.id}"]`)
    .boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 16; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 16,
      start.y + ((end.y - start.y) * step) / 16
    );
  }
  await expect(viewer).toHaveAttribute('data-zone-dragging-card', /./);
  const aside = fades(
    on(await animations.take(), 'ptcgsim-legacy-zone-browser')
  );
  expect(aside.length).toBeGreaterThan(0);
  expect(aside.every((animation) => animation.duration >= 100)).toBe(true);

  // ...and once the card has landed, back in as it first came, never
  // popping back.
  await page.mouse.up();
  await expect(viewer).not.toHaveAttribute('data-zone-dragging-card', /./, {
    timeout: 10_000,
  });
  await expect(viewer).toHaveCSS('opacity', '1');
  const back = fades(
    on(await animations.take(), 'ptcgsim-legacy-zone-browser')
  );
  expect(back.length).toBeGreaterThan(0);
  expect(back.every((animation) => animation.duration >= 150)).toBe(true);
  expect((await zone(page, 'bench')).count).toBe(1);

  // Closed, its last frame fades away.
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.ptcgsim-overlay-ghost')).toHaveCount(0);
  const closed = on(
    await animations.take(),
    'ptcgsim-legacy-zone-browser',
    'ptcgsim-overlay-ghost'
  );
  expect(closed.map((animation) => animation.name)).toContain(
    'ptcgsim-overlay-panel-out'
  );
  await nothingLeftBehind(page);
});

test('the command palette fades in and out, with only a brief fade under reduced motion', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRoom(page);
  const animations = await watchAnimations(page);
  const palette = page.locator('[data-command-palette]');

  await page.keyboard.press('`');
  await expect(palette).toBeVisible();
  await expect(palette).toHaveCSS('opacity', '1');
  const opened = on(await animations.take(), 'ptcgsim-command-palette');
  expect(opened.map((animation) => animation.name).sort()).toEqual([
    'ptcgsim-command-fade',
    'ptcgsim-command-in',
  ]);
  expect(opened.every((animation) => animation.duration >= 150)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await nothingLeftBehind(page);
  const closed = on(await animations.take(), 'ptcgsim-command-palette');
  expect(closed.map((animation) => animation.name)).toEqual([
    'ptcgsim-command-out',
  ]);
  expect(closed[0]!.duration).toBeGreaterThanOrEqual(100);

  // Reduced motion: a fade alone, still there, and quick.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.keyboard.press('`');
  await expect(palette).toHaveCSS('opacity', '1');
  const reduced = on(await animations.take(), 'ptcgsim-command-palette');
  expect(reduced.map((animation) => animation.name)).toEqual([
    'ptcgsim-command-fade',
  ]);
  expect(reduced[0]!.duration).toBe(150);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await nothingLeftBehind(page);
  const reducedOut = on(await animations.take(), 'ptcgsim-command-palette');
  expect(reducedOut.map((animation) => animation.name)).toEqual([
    'ptcgsim-command-fade-out',
  ]);
  expect(reducedOut[0]!.duration).toBe(100);
});

test('the deck screen fades in, the first time too, and out', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRoom(page);
  const animations = await watchAnimations(page);
  for (const time of ['first', 'again']) {
    await openDeck(page);
    await expect(page.locator('.ptcgsim-deck-layer')).toHaveCSS('opacity', '1');
    const opened = fades(on(await animations.take(), 'ptcgsim-deck-layer'));
    expect(opened.length, time).toBe(1);
    expect(opened[0]!.duration, time).toBeGreaterThanOrEqual(150);
    await closeDeck(page);
    await expect(page.locator('.ptcgsim-deck-layer')).toBeHidden();
    const closed = fades(on(await animations.take(), 'ptcgsim-deck-layer'));
    expect(closed.length, time).toBe(1);
    expect(closed[0]!.duration, time).toBeGreaterThanOrEqual(100);
  }
});

test('the welcome card fades away from where it was as a sheet opens over it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoom(page);
  const welcome = page.locator('.table-welcome');
  await expect(welcome).toBeVisible();
  await expect(welcome).toHaveCSS('opacity', '1');
  const was = (await welcome.boundingBox())!;
  // Where the leaving copy is drawn as it appears.
  await page.evaluate(() => {
    const seen: { x: number; y: number }[] = [];
    (window as unknown as { __leavingAt: typeof seen }).__leavingAt = seen;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof HTMLElement &&
            node.classList.contains('is-leaving')
          ) {
            const box = node
              .querySelector('.table-welcome')
              ?.getBoundingClientRect();
            if (box) seen.push({ x: box.x, y: box.y });
          }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const animations = await watchAnimations(page);
  await openSettings(page);
  await expect(page.locator('[data-table-welcome]')).toHaveCount(0);
  const leftAt = await page.evaluate(
    () =>
      (window as unknown as { __leavingAt: { x: number; y: number }[] })
        .__leavingAt
  );
  expect(leftAt).toHaveLength(1);
  expect(Math.abs(leftAt[0]!.x - was.x)).toBeLessThan(2);
  expect(Math.abs(leftAt[0]!.y - was.y)).toBeLessThan(2);
  await nothingLeftBehind(page);
  const left = on(await animations.take(), 'table-welcome');
  expect(left.map((animation) => animation.name)).toContain(
    'ptcgsim-table-centre-out'
  );
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the card bar fades in by the tapped card and out when let go', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openSoloTable(page);
    const animations = await watchAnimations(page);
    const hand = await zone(page, 'hand');
    const card = page
      .locator(`[data-card-id]`)
      .filter({ has: page.locator('.ptcgsim-card__body') })
      .and(page.locator('[data-in-hand]'))
      .first();
    void hand;
    await card.tap();
    const bar = page.locator('[data-touch-card-bar]');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('opacity', '1');
    const shown = on(await animations.take(), 'touch-card-bar');
    expect(
      fades(shown, ['touch-card-bar-fade']).some(
        (animation) => animation.duration >= 150
      )
    ).toBe(true);
    await bar.getByRole('button', { name: 'Deselect' }).tap();
    await expect(bar).toHaveCount(0);
    await nothingLeftBehind(page);
    const gone = on(await animations.take(), 'touch-card-bar', 'is-leaving');
    expect(gone.map((animation) => animation.name)).toEqual([
      'touch-card-bar-out',
    ]);
  });
});
