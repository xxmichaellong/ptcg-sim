import { expect, test, type Page } from '@playwright/test';

import { closeBoardView, openBoardView } from './support/board-view.js';

/**
 * The Board view panel: one place, opened from the table's controls, for how
 * the table is shown. A hidden half leaves the table entirely, the other
 * half grows to fill it, and the choices stay on this device.
 */

const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/cardback.png?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/cardback.png?${prefix}-energy`,
    ].join('\n')
  );

const openSoloTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.click('#deckImportButton');
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
  await page.click('#p1Button');
  const before = Number(
    await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
  );
  await page.click('#setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 2)
  );
  await idle(page);
};

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);

interface Painted {
  readonly sides: Record<string, number>;
  readonly frames: {
    readonly side: string;
    readonly hidden: boolean;
    readonly y: number;
    readonly height: number;
  }[];
  readonly localActiveHeight: number;
  readonly stadium: { readonly y: number; readonly height: number } | null;
}

/** What the scene holds and where, read from the published scene. */
const painted = (page: Page): Promise<Painted> =>
  page.evaluate(() => {
    const scene = (
      window as unknown as {
        readonly __PTCG_RENDERER_SPIKE__: {
          readonly scene: {
            readonly cards: readonly { readonly side: string }[];
            readonly zones: readonly {
              readonly kind: string;
              readonly side: string;
              readonly bounds: { readonly y: number; readonly height: number };
            }[];
            readonly layout: {
              readonly players: readonly {
                readonly side: string;
                readonly hidden?: boolean;
                readonly bounds: {
                  readonly y: number;
                  readonly height: number;
                };
              }[];
            };
          };
        };
      }
    ).__PTCG_RENDERER_SPIKE__.scene;
    const sides: Record<string, number> = {};
    for (const card of scene.cards)
      sides[card.side] = (sides[card.side] ?? 0) + 1;
    const stadium = scene.zones.find((zone) => zone.kind === 'stadium');
    return {
      sides,
      frames: scene.layout.players.map((frame) => ({
        side: frame.side,
        hidden: frame.hidden === true,
        y: frame.bounds.y,
        height: frame.bounds.height,
      })),
      localActiveHeight:
        scene.zones.find(
          (zone) => zone.kind === 'active' && zone.side === 'local'
        )?.bounds.height ?? 0,
      stadium: stadium
        ? { y: stadium.bounds.y, height: stadium.bounds.height }
        : null,
    };
  });

test('a half can be hidden, the other fills the table, and the choice is kept', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const both = await painted(page);
  expect(both.sides.local).toBeGreaterThan(0);
  expect(both.sides.opponent).toBeGreaterThan(0);
  // No drag handles: the split lives in the panel.
  await expect(page.locator('#selfResizer, #oppResizer')).toHaveCount(0);

  const button = page.locator('#boardViewButton');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await openBoardView(page);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#boardShowBoth')).toBeFocused();
  await testInfo.attach('board-view-panel.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });

  await page.locator('#boardShowMine').check();
  await expect(page.locator('#boardSplitRange')).toBeDisabled();
  await expect
    .poll(async () => (await painted(page)).sides.opponent ?? 0)
    .toBe(0);
  const mine = await painted(page);
  expect(mine.sides.local).toBe(both.sides.local);
  expect(mine.frames.find((frame) => frame.side === 'opponent')?.hidden).toBe(
    true
  );
  expect(mine.frames.find((frame) => frame.side === 'local')).toMatchObject({
    y: 0,
    height: 900,
  });
  expect(mine.localActiveHeight).toBeGreaterThan(both.localActiveHeight);
  // The Stadium and the table's controls stay on the table.
  expect(mine.stadium!.y).toBeGreaterThanOrEqual(0);
  const controls = (await page.locator('#boardButtonContainer').boundingBox())!;
  expect(controls.y).toBeGreaterThanOrEqual(0);
  await expect(
    page.locator('[data-player-frame-chrome][data-player-side="opponent"]')
  ).toHaveCount(0);
  await closeBoardView(page);
  await idle(page);
  await testInfo.attach('board-view-mine.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });

  await openBoardView(page);
  await page.locator('#boardShowTheirs').check();
  await expect.poll(async () => (await painted(page)).sides.local ?? 0).toBe(0);
  expect((await painted(page)).sides.opponent).toBe(both.sides.opponent);
  await closeBoardView(page);
  await idle(page);
  await testInfo.attach('board-view-theirs.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });

  // Kept on this device.
  await page.reload();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(
      async () =>
        (await painted(page)).frames.find((frame) => frame.side === 'local')
          ?.hidden
    )
    .toBe(true);

  await openBoardView(page);
  await page.locator('#boardShowBoth').check();
  await page.locator('#boardSplitRange').fill('60');
  await expect
    .poll(async () =>
      Math.round(
        (await painted(page)).frames.find((frame) => frame.side === 'local')
          ?.height ?? 0
      )
    )
    .toBe(540);
  await page.locator('#boardViewResetButton').click();
  await expect
    .poll(async () =>
      Math.round(
        (await painted(page)).frames.find((frame) => frame.side === 'local')
          ?.height ?? 0
      )
    )
    .toBe(450);
  expect(errors).toEqual([]);
});

test('the large hover preview is off until it is chosen', async ({ page }) => {
  test.setTimeout(120_000);
  await openSoloTable(page);
  const handCard = page.locator('[data-in-hand]').last();
  await handCard.hover();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-card-inspector]')).toHaveCount(0);

  await openBoardView(page);
  await page.locator('#hoverPreviewCheckbox').check();
  await closeBoardView(page);
  await page.mouse.move(10, 10);
  await handCard.hover();
  await expect(
    page.locator('[data-card-inspector][data-open="true"]')
  ).toBeVisible();
});

test('Settings opens the Board view and gets focus back when it closes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSoloTable(page);
  await page.locator('#settingsButton').click();
  const link = page.locator('#openBoardViewButton');
  await link.click();
  await expect(page.locator('#boardViewPanel')).toBeVisible();
  await expect(page.locator('#boardShowBoth')).toBeFocused();
  // Keys typed in the panel stay there: '2' would otherwise draw two cards.
  const revision = await page
    .locator('.ptcgsim-board-surface')
    .getAttribute('data-revision');
  await page.keyboard.press('2');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    revision!
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#boardViewPanel')).toHaveCount(0);
  await expect(link).toBeFocused();
  // A press on the table puts the panel away too.
  await link.click();
  await expect(page.locator('#boardViewPanel')).toBeVisible();
  await page.mouse.click(400, 450);
  await expect(page.locator('#boardViewPanel')).toHaveCount(0);
});
