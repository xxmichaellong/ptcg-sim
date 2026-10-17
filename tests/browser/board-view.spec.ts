import { expect, test, type Page } from '@playwright/test';

import { closeBoardView, openBoardView } from './support/board-view.js';
import {
  chooseMoreAction,
  openDeck,
  openSettings,
} from './support/table-shell.js';

/**
 * How the table is shown: the Table section of Settings (ADR-030; first a
 * Board view panel). A hidden half leaves the table entirely, the other
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
  // Both decks are installed (one revision each) before Set up both.
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '2'
  );
  const before = Number(
    await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
  );
  await chooseMoreAction(page, 'setupBothButton');
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
  // No drag handles, and no view controls on the table: the split lives
  // in Settings.
  await expect(page.locator('#selfResizer, #oppResizer')).toHaveCount(0);
  await expect(page.locator('#boardViewButton')).toHaveCount(0);

  await openBoardView(page);
  await expect(page.locator('#settingsTable')).toBeVisible();
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
  // The room shows before the table publishes its scene.
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { readonly __PTCG_RENDERER_SPIKE__?: object })
        .__PTCG_RENDERER_SPIKE__
    )
  );
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
  // Back to the default split: the near half takes 54% (PX-047).
  await expect
    .poll(async () =>
      Math.round(
        (await painted(page)).frames.find((frame) => frame.side === 'local')
          ?.height ?? 0
      )
    )
    .toBe(486);
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

test('Settings holds the table view, keeps its keys, and gives focus back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openSoloTable(page);
  // Settings is on the open toolbar.
  const settingsButton = page.locator('.ptcgsim-app-toolbar #settingsButton');
  await openSettings(page);
  await expect(page.locator('#settingsTable #boardShowBoth')).toBeAttached();
  await page.locator('#boardShowMine').focus();
  // Keys typed in Settings stay there: '2' would otherwise draw two cards.
  const revision = await page
    .locator('.ptcgsim-board-surface')
    .getAttribute('data-revision');
  await page.keyboard.press('2');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    revision!
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toHaveCount(0);
  // Focus goes back to the button that opened it, not lost on the page.
  await expect(settingsButton).toBeFocused();
  // A press outside puts Settings away too.
  await openSettings(page);
  await page.mouse.click(400, 450);
  await expect(page.locator('#settings')).toHaveCount(0);
});
